// Control > Gestoría: paquete mensual para la gestoría (ZIP con listados, facturas, extractos y balance),
// extractos bancarios (PDF y N43) con el periodo que cubren, comprobación de que no falta nada,
// notas por mes y registro de envíos.
import { h, clear, cargando, toast, confirmar, fmtEUR2, fmtFecha, num, capitalizar, hoyISO } from '../ui.js';
import * as db from '../db.js';
import { registrarSeccion, faltaFactura } from './control.js';
import { crearZip, crearXlsx, descargarBlob } from '../zip.js';
import { parsearN43, cuentaN43, esN43 } from '../n43.js';
import { ponerClaves, resumenConciliacion, asignadoGasto, restanteGasto, esAbono } from '../banco.js';

const NOMBRES_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const rangoPeriodo = (p) => { const [y, m] = p.split('-').map(Number); const fin = new Date(Date.UTC(y, m, 0)).getUTCDate(); return [`${p}-01`, `${p}-${String(fin).padStart(2, '0')}`]; };
export const nombrePeriodo = (p) => { const [y, m] = p.split('-').map(Number); return `${capitalizar(NOMBRES_MES[m - 1])} ${y}`; };
const periodoAnterior = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const sumarDia = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const limpio = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
const fechaGasto = (g) => g.fecha_factura || g.fecha_pago || '';
const enviado = (g) => String(g.fiscontal) === 'True';

// ¿Cubren los intervalos [desde, hasta] todo el periodo? (pueden ser varios extractos seguidos)
export function cubre(intervalos, desde, hasta) {
  let hastaCubierto = sumarDia(desde, -1);
  for (const [d, h0] of [...intervalos].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (d > sumarDia(hastaCubierto, 1)) break;
    if (h0 > hastaCubierto) hastaCubierto = h0;
    if (hastaCubierto >= hasta) return true;
  }
  return hastaCubierto >= hasta;
}

// Datos de un periodo para la comprobación y el paquete
export function datosPeriodo({ periodo, gastos, facturacion, movimientos, extractos, cuentas, incluirAnteriores = true, enlaces = [] }) {
  const [desde, hasta] = rangoPeriodo(periodo);
  const enMes = (f) => f && f >= desde && f <= hasta;
  const gMes = gastos.filter((g) => enMes(fechaGasto(g)) && num(g.cantidad) !== 0);
  const gAnt = incluirAnteriores ? gastos.filter((g) => fechaGasto(g) && fechaGasto(g) < desde && !enviado(g) && !g.sin_factura && num(g.cantidad) !== 0 && fechaGasto(g) >= sumarDia(desde, -400)) : [];
  const lista = [...gMes, ...gAnt].sort((a, b) => fechaGasto(a).localeCompare(fechaGasto(b)));
  const ingresos = facturacion.filter((f) => enMes(f.fecha_operacion || f.fecha_pago)).sort((a, b) => String(a.num_factura || '').localeCompare(String(b.num_factura || ''), 'es', { numeric: true }));
  const movs = movimientos.filter((m) => enMes(m.fecha));
  const activas = cuentas.filter((c) => c.activo !== false);
  const porCuenta = activas.map((c) => {
    const ex = extractos.filter((e) => e.cuenta_id === c.id && e.fecha_hasta >= desde && e.fecha_desde <= hasta);
    return { cuenta: c, extractos: ex,
      pdf: cubre(ex.filter((e) => e.archivo_pdf).map((e) => [e.fecha_desde, e.fecha_hasta]), desde, hasta),
      n43: cubre(ex.filter((e) => e.archivo_n43).map((e) => [e.fecha_desde, e.fecha_hasta]), desde, hasta) };
  });
  const sinFra = lista.filter(faltaFactura);
  const soloEnlace = lista.filter((g) => /^https?:/i.test(String(g.link_factura || '').trim()));
  const enStorage = lista.filter((g) => String(g.link_factura || '').startsWith('storage:'));
  const porRevisar = lista.filter((g) => g.revisado === false);
  const movPend = movs.filter((m) => m.estado === 'pendiente');
  // movimientos sin factura que se explican con un comentario: ignorados, o dados por conciliados a mano (traspasos, pagos sin factura…)
  const conEnlace = new Set(enlaces.map((e) => e.movimiento_id));
  const ignorados = movs.filter((m) => m.estado === 'ignorado' || (m.estado === 'conciliado' && String(m.notas || '').trim() && !conEnlace.has(m.id)));
  const ignoradosSinComentario = ignorados.filter((m) => !String(m.notas || '').trim());
  // Conciliación: enlaces de los movimientos del mes y de las facturas del envío (un pago puede cubrir varias facturas y viceversa)
  const idsLista = new Set(lista.map((g) => g.id)), idsMovs = new Set(movs.map((m) => m.id));
  const enlacesPeriodo = enlaces.filter((e) => idsLista.has(e.gasto_id) || idsMovs.has(e.movimiento_id));
  const gIds = new Set(enlacesPeriodo.map((x) => x.gasto_id)), mIds = new Set(enlacesPeriodo.map((x) => x.movimiento_id));
  const conc = resumenConciliacion({ gastos, movimientos, enlaces: enlaces.filter((e) => gIds.has(e.gasto_id) || mIds.has(e.movimiento_id)) });
  const movsPorId = new Map(movimientos.map((m) => [m.id, m]));
  const abonos = lista.filter(esAbono), abonosSinCobro = abonos.filter((g) => restanteGasto(g, enlaces) > 0.009);
  const parciales = lista.filter((g) => !esAbono(g) && asignadoGasto(g, enlaces) > 0.009 && restanteGasto(g, enlaces) > 0.009);
  const checks = [
    ...(activas.length ? [] : [{ ok: false, critico: true, texto: 'No hay cuentas bancarias dadas de alta: créalas en Control > Conciliación bancaria (con su IBAN) para poder subir los extractos' }]),
    ...porCuenta.map((x) => ({ ok: x.pdf, critico: true, texto: `Extracto PDF de ${x.cuenta.nombre} que cubra todo el mes` })),
    ...porCuenta.map((x) => ({ ok: x.n43, critico: true, texto: `Extracto N43 de ${x.cuenta.nombre} que cubra todo el mes` })),
    { ok: lista.length > 0, critico: true, texto: `Gastos del mes (${lista.length})` },
    { ok: sinFra.length === 0, critico: true, texto: sinFra.length ? `${sinFra.length} gastos sin factura` : 'Todos los gastos tienen factura (o están marcados "sin factura")' },
    { ok: ingresos.length > 0, critico: true, texto: ingresos.length ? `Facturas de ingresos del mes (${ingresos.length})` : 'No hay facturas de ingresos del mes (¿falta importar la facturación?)' },
    { ok: porRevisar.length === 0, critico: false, texto: porRevisar.length ? `${porRevisar.length} gastos por revisar (los subió otra persona)` : 'Ningún gasto por revisar' },
    { ok: soloEnlace.length === 0, critico: false, texto: soloEnlace.length ? `${soloEnlace.length} facturas solo como enlace (Google Drive / OneDrive): van en el listado con su enlace, no dentro del ZIP` : 'Todas las facturas van dentro del ZIP' },
    { ok: abonosSinCobro.length === 0, critico: false, texto: abonosSinCobro.length ? `${abonosSinCobro.length} abonos / notas de crédito sin devolución enlazada en el banco (se indican en la hoja «Abonos»)` : (abonos.length ? `Abonos del envío (${abonos.length}) con su devolución enlazada` : 'Sin abonos en el envío') },
    { ok: ignoradosSinComentario.length === 0, critico: false, texto: ignoradosSinComentario.length ? `${ignoradosSinComentario.length} movimientos ignorados del banco sin comentario (explícale a la gestoría qué son)` : (ignorados.length ? `Movimientos del banco sin factura, con su comentario (${ignorados.length}, hoja «Sin factura»)` : 'Sin movimientos del banco sin factura') },
    { ok: parciales.length === 0, critico: false, texto: parciales.length ? `${parciales.length} facturas con el pago solo en parte conciliado (hoja «Conciliación»)` : 'Sin facturas con pago parcial' },
    { ok: movPend.length === 0, critico: false, texto: movPend.length ? `${movPend.length} movimientos del banco sin conciliar en el mes` : (movs.length ? 'Banco del mes conciliado' : 'No hay movimientos del banco importados en el mes') },
  ];
  return { periodo, desde, hasta, gMes, gAnt, lista, ingresos, movs, porCuenta, sinFra, soloEnlace, enStorage, porRevisar, movPend, ignorados, checks, enlaces, movsPorId, enlacesPeriodo, conc, abonos, abonosSinCobro, parciales };
}

// Texto de cómo está cubierta una factura o abono en el banco: «Pagada en 2 pagos: 12/10 300,00 + 15/10 200,00», «Parcial…», «Sin conciliar»
const f2 = (n) => num(n).toFixed(2).replace('.', ',');
const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
export function estadoBanco(g, d) {
  const mios = d.enlaces.filter((e) => e.gasto_id === g.id);
  if (!mios.length) return g.check_banca ? 'Comprobado en banco (sin detalle de movimientos)' : 'Sin conciliar';
  const movs = mios.map((e) => ({ e, m: d.movsPorId.get(e.movimiento_id) })).filter((x) => x.m);
  const det = movs.map((x) => `${ddmm(x.m.fecha)} ${f2(x.e.importe)}${d.enlaces.filter((z) => z.movimiento_id === x.e.movimiento_id).length > 1 ? ` (pago de ${d.enlaces.filter((z) => z.movimiento_id === x.e.movimiento_id).length} facturas, total ${f2(Math.abs(num(x.m.importe)))})` : ''}`).join(' + ');
  const pend = restanteGasto(g, d.enlaces);
  const etiqueta = esAbono(g) ? 'Devolución recibida' : movs.length > 1 ? `Pagada en ${movs.length} pagos` : 'Pagada';
  return pend > 0.009 ? `PARCIAL (falta ${f2(pend)}): ${det}` : `${etiqueta}: ${det}`;
}

// Hojas del paquete
export function hojasPaquete(d, ctx) {
  const cat = (g) => ctx.state.taxonomia.find((c) => c.id === g.categoria_id);
  const sub = (g) => cat(g)?.subcategorias.find((s) => s.id === g.subcategoria_id);
  const centro = (id) => ctx.tituloCentro?.(ctx.state.centros.find((c) => c.id === id)?.nombre || '') || '';
  const gastos = [['Fecha factura', 'Fecha pago', 'Empresa', 'NIF', 'Nº factura', 'Concepto', 'Importe', 'Categoría', 'Subcategoría', 'Método de pago', 'Pagado', 'Centro', 'Factura', 'Mes anterior sin enviar', 'Comentarios', 'Tipo', 'Banco'],
    ...d.lista.map((g) => [g.fecha_factura || '', g.fecha_pago || '', g.empresa || '', g.nif || '', g.factura_nr || '', g.concepto || '', num(g.cantidad),
      cat(g)?.nombre || g.categoria_texto || '', sub(g)?.nombre || g.subcategoria_texto || '', g.metodo_pago || '', g.pago || '', centro(g.centro_id),
      g.sin_factura ? 'Sin factura' : String(g.link_factura || '').startsWith('storage:') ? 'En el ZIP' : (g.link_factura || 'FALTA'), d.gAnt.includes(g) ? 'Sí' : '', g.comentarios || '', esAbono(g) ? 'ABONO / NOTA DE CRÉDITO (importe negativo)' : 'Factura', estadoBanco(g, d)])];
  gastos.push([], ['', '', '', '', '', 'TOTAL', d.lista.reduce((s, g) => s + num(g.cantidad), 0)]);
  const ingresos = [['Nº factura', 'Nº recibo', 'Fecha operación', 'Fecha pago', 'Alumno', 'Centro', 'Descripción', 'Método de pago', 'Base', 'IVA', 'Total'],
    ...d.ingresos.map((f) => [f.num_factura || '', f.num_recibo || '', f.fecha_operacion || '', f.fecha_pago || '', f.alumno || '', f.centro || '', f.descripcion || '', f.metodo_pago || '', num(f.importe), num(f.iva), num(f.total)])];
  ingresos.push([], ['', '', '', '', '', '', '', 'TOTAL', d.ingresos.reduce((s, f) => s + num(f.importe), 0), d.ingresos.reduce((s, f) => s + num(f.iva), 0), d.ingresos.reduce((s, f) => s + num(f.total), 0)]);
  const r2 = (n) => Math.round(n * 100) / 100;
  const cobrado = r2(d.ingresos.filter((f) => f.fecha_pago).reduce((s, f) => s + num(f.total), 0));
  const bancoIn = r2(d.movs.filter((m) => num(m.importe) > 0).reduce((s, m) => s + num(m.importe), 0));
  const pagadoGastos = r2(d.gMes.filter((g) => g.fecha_pago && g.fecha_pago >= d.desde && g.fecha_pago <= d.hasta).reduce((s, g) => s + num(g.cantidad), 0));
  const bancoOut = r2(-d.movs.filter((m) => num(m.importe) < 0).reduce((s, m) => s + num(m.importe), 0));
  const facturasGasto = r2(d.gMes.reduce((s, g) => s + num(g.cantidad), 0));
  const balance = [['Concepto', 'Importe', 'Nota'],
    ['Cobrado según facturación (total de recibos pagados del mes)', cobrado, ''],
    ['Entradas en los bancos del mes', bancoIn, 'Movimientos importados en Conciliación'],
    ['Diferencia cobrado - banco', r2(cobrado - bancoIn), 'Efectivo, TPV que entra otro mes, etc.'],
    [],
    ['Gastos pagados en el mes (según gastos)', pagadoGastos, ''],
    ['Salidas en los bancos del mes', bancoOut, ''],
    ['Diferencia gastos - banco', r2(pagadoGastos - bancoOut), 'Pagos en efectivo, cargos sin factura, etc.'],
    [],
    ['Facturas de gasto del mes (por fecha de factura)', facturasGasto, `${d.gMes.length} facturas`],
    ['Facturas de ingresos del mes (total)', r2(d.ingresos.reduce((s, f) => s + num(f.total), 0)), `${d.ingresos.length} facturas`],
    ['Resultado (ingresos - gastos)', r2(d.ingresos.reduce((s, f) => s + num(f.total), 0) - facturasGasto), ''],
    [],
    ['Cuenta', 'Saldo inicial', 'Saldo final', 'Extractos (desde - hasta)'],
    ...d.porCuenta.map((x) => [x.cuenta.nombre, x.extractos[0]?.saldo_inicial ?? '', x.extractos[0]?.saldo_final ?? '', x.extractos.map((e) => `${e.fecha_desde} a ${e.fecha_hasta}${e.archivo_pdf ? ' PDF' : ''}${e.archivo_n43 ? ' N43' : ''}`).join(' · ') || 'FALTA'])];
  const nomCuenta = (m) => d.porCuenta.find((x) => x.cuenta.id === m.cuenta_id)?.cuenta.nombre || '';
  const banco = [['Fecha', 'Cuenta', 'Concepto', 'Importe', 'Estado', 'Comentario'], ...d.movs.map((m) => [m.fecha, nomCuenta(m), m.concepto || '', num(m.importe), m.estado || '', m.notas || ''])];
  // movimientos del banco que no se enlazan con ninguna factura (traspasos entre cuentas, pagos sin factura…) con la explicación escrita en Conciliación
  const ignorados = [['Fecha', 'Cuenta', 'Concepto del banco', 'Importe', 'Situación', 'Comentario'], ...d.ignorados.slice().sort((a, b) => a.fecha.localeCompare(b.fecha)).map((m) => [m.fecha, nomCuenta(m), m.concepto || '', num(m.importe), m.estado === 'ignorado' ? 'Ignorado (no cuenta)' : 'Conciliado sin factura', m.notas || '(sin comentario)'])];
  if (!d.ignorados.length) ignorados.push(['Sin movimientos sin factura en este periodo']);
  const empresaG = (g) => `${g.empresa || ''}${g.factura_nr ? ` ${g.factura_nr}` : ''}`;
  const cab = ['Situación', 'Fecha movimiento', 'Cuenta', 'Concepto del banco', 'Importe del movimiento', 'Empresa / nº factura', 'Concepto del gasto', 'Importe de la factura', 'Importe cubierto por este movimiento', 'Pendiente de la factura', 'Pendiente del movimiento'];
  const fila = (x) => [x.situacion, x.m.fecha, d.porCuenta.find((c) => c.cuenta.id === x.m.cuenta_id)?.cuenta.nombre || '', x.m.concepto || '', num(x.m.importe), empresaG(x.g), x.g.concepto || '', num(x.g.cantidad), x.importe, x.pendienteGasto, x.pendienteMov];
  const orden = (a, b) => a[1].localeCompare(b[1]);
  const conciliacion = [cab, ...d.conc.filas.map(fila).sort(orden)];
  if (!d.conc.filas.length) conciliacion.push(['Sin movimientos enlazados en este periodo']);
  const abonos = [['Fecha', 'Empresa / nº factura', 'Concepto', 'Importe (negativo)', 'Devolución cobrada', 'Pendiente de cobrar', 'Movimientos del banco'],
    ...d.abonos.map((g) => [fechaGasto(g), empresaG(g), g.concepto || '', num(g.cantidad), asignadoGasto(g, d.enlaces), restanteGasto(g, d.enlaces), estadoBanco(g, d)])];
  if (!d.abonos.length) abonos.push(['Sin abonos ni notas de crédito en este envío']);
  const variosPagos = [cab, ...d.conc.variosPagos.map(fila).sort(orden)], variosFacturas = [cab, ...d.conc.variosFacturas.map(fila).sort(orden)];
  return { gastos, ingresos, balance, banco, ignorados, conciliacion, abonos, variosPagos, variosFacturas };
}

async function renderGestoria(cont, ctx) {
  clear(cont, cargando());
  const editar = ctx.puedeEditar ? ctx.puedeEditar() : true;
  const [cuentas, extractos, envios, notas, facturacion] = await Promise.all([db.getCuentas(), db.getExtractos(), db.getEnvios(), db.getGestoriaNotas(), ctx.state.facturacion ? Promise.resolve(ctx.state.facturacion) : db.getFacturacion()]);
  ctx.state.facturacion = facturacion;
  if (!ctx.state.movimientos) ctx.state.movimientos = await db.getMovimientos();
  if (!ctx.state.movGastos) ctx.state.movGastos = await db.getMovGastos();
  const gastosPorCurso = new Map();
  for (const c of ctx.state.cursosVisibles) gastosPorCurso.set(c.id, await ctx.gastos(c.id));
  const todosGastos = () => [...gastosPorCurso.values()].flat();
  let periodo = ctx.state.gestoriaPeriodo || periodoAnterior();
  let incluirAnteriores = true;

  const selPeriodo = h('input', { type: 'month', value: periodo, 'aria-label': 'Mes del envío', onchange: () => { if (selPeriodo.value) { periodo = selPeriodo.value; ctx.state.gestoriaPeriodo = periodo; pintar(); } } });
  const chkAnt = h('input', { type: 'checkbox', checked: true, onchange: () => { incluirAnteriores = chkAnt.checked; pintar(); } });
  const cuerpo = h('div', { class: 'gestoria' });
  const nombreCuenta = (id) => cuentas.find((c) => c.id === id)?.nombre || '—';

  const datos = () => datosPeriodo({ periodo, gastos: todosGastos(), facturacion, movimientos: ctx.state.movimientos, extractos, cuentas, incluirAnteriores, enlaces: ctx.state.movGastos || [] });

  function pintar() {
    const d = datos();
    const env = envios.find((e) => e.periodo === periodo);
    const faltan = d.checks.filter((c) => !c.ok);
    const criticos = faltan.filter((c) => c.critico);
    clear(cuerpo,
      h('div', { class: 'gestoria-grid' },
        // ----- comprobación y paquete -----
        h('section', { class: 'card' },
          h('div', { class: 'section-head' }, h('div', {}, h('h3', {}, `Envío de ${nombrePeriodo(periodo)}`),
            h('div', { class: 'count' }, env?.estado === 'enviado' ? h('span', { class: `pill ${env.incompleto ? 'warn' : 'ok'}` }, `Enviado el ${fmtFecha(env.fecha_envio)}${env.incompleto ? ' (incompleto)' : ''}`) : h('span', { class: 'pill off' }, 'Pendiente de enviar')))),
          h('ul', { class: 'checklist' }, d.checks.map((c) => h('li', { class: c.ok ? 'ok' : c.critico ? 'falta' : 'aviso' }, h('span', { class: 'chk-ico', 'aria-hidden': 'true' }, c.ok ? '✓' : c.critico ? '✗' : '!'), c.texto))),
          h('div', { class: 'muted small' }, `${d.gMes.length} gastos del mes${d.gAnt.length ? ` + ${d.gAnt.length} de meses anteriores aún sin enviar` : ''} · ${fmtEUR2(d.lista.reduce((s, g) => s + num(g.cantidad), 0))} · ${d.ingresos.length} facturas de ingresos · ${d.enStorage.length} PDFs de facturas`),
          h('label', { class: 'check small' }, chkAnt, 'Incluir gastos de meses anteriores que aún no se han enviado'),
          h('label', { class: 'small campo-bloque' }, 'Notas del envío (van en el ZIP)', notasEnvio(env)),
          h('div', { class: 'acciones' },
            h('button', { class: 'btn primary', onclick: () => descargarPaquete(d, criticos, faltan) }, 'Descargar paquete (ZIP)'),
            editar ? h('button', { class: 'btn', onclick: () => marcarEnviado(d, faltan, env) }, env?.estado === 'enviado' ? 'Volver a marcar como enviado' : 'Marcar como enviado') : null)),
        // ----- notas del mes -----
        seccionNotas()),
      seccionExtractos(d),
      seccionHistorial());
  }

  function notasEnvio(env) {
    const t = h('textarea', { rows: 2, 'aria-label': 'Notas del envío', placeholder: 'p.ej. "Falta la factura de X, la mando la semana que viene"', disabled: !editar }, env?.notas || '');
    t.addEventListener('blur', async () => {
      if ((t.value.trim() || null) === (env?.notas || null)) return;
      try { const e = await db.guardarEnvio(periodo, { notas: t.value.trim() || null }); const i = envios.findIndex((x) => x.periodo === periodo); if (i >= 0) envios[i] = e; else envios.unshift(e); toast('Nota guardada'); } catch (ex) { toast(ex.message, 'error'); }
    });
    return t;
  }

  function seccionNotas() {
    const lista = notas.filter((n) => n.periodo === periodo);
    const nueva = h('input', { type: 'text', placeholder: 'Añadir nota para la gestoría…', 'aria-label': 'Nueva nota', disabled: !editar });
    const anadir = async () => {
      const texto = nueva.value.trim(); if (!texto) return;
      try { notas.push(await db.crearGestoriaNota({ periodo, texto })); pintar(); } catch (ex) { toast(ex.message, 'error'); }
    };
    nueva.addEventListener('keydown', (e) => { if (e.key === 'Enter') anadir(); });
    return h('section', { class: 'card' },
      h('h3', {}, `Notas de ${nombrePeriodo(periodo)}`),
      lista.length ? h('ul', { class: 'notas-gestoria' }, lista.map((n) => h('li', { class: n.hecho ? 'hecha' : '' },
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: n.hecho, disabled: !editar, onchange: async (e) => { try { Object.assign(n, await db.actualizarGestoriaNota(n.id, { hecho: e.target.checked })); pintar(); } catch (ex) { toast(ex.message, 'error'); } } }), n.texto)))) : h('p', { class: 'muted small' }, 'Sin notas este mes.'),
      editar ? h('div', { class: 'fila-nota' }, nueva, h('button', { class: 'btn small', onclick: anadir }, 'Añadir')) : null,
      notas.some((n) => n.periodo !== periodo && !n.hecho) ? h('p', { class: 'muted small' }, 'Notas pendientes de otros meses: ',
        ...[...new Set(notas.filter((n) => n.periodo !== periodo && !n.hecho).map((n) => n.periodo))].map((p) => h('button', { class: 'btn-link', onclick: () => { periodo = p; selPeriodo.value = p; pintar(); } }, nombrePeriodo(p)))) : null);
  }

  function seccionExtractos(d) {
    const filas = [...extractos].sort((a, b) => b.fecha_hasta.localeCompare(a.fecha_hasta) || nombreCuenta(a.cuenta_id).localeCompare(nombreCuenta(b.cuenta_id)));
    const abrir = async (ruta) => { const w = window.open('', '_blank'); try { const u = await db.urlArchivo('gestoria', ruta); if (w) { w.opener = null; w.location.href = u; } } catch (ex) { w?.close(); toast(ex.message, 'error'); } };
    const enPeriodo = (e) => e.fecha_hasta >= d.desde && e.fecha_desde <= d.hasta;
    return h('section', { class: 'card lista-card' },
      h('div', { class: 'section-head' }, h('div', {}, h('h3', {}, 'Extractos bancarios'),
        h('div', { class: 'count' }, 'La gestoría los pide en PDF y en N43. Cada extracto queda apuntado con las fechas que cubre (pueden no coincidir con el mes).')),
        editar ? h('button', { class: 'btn small primary', onclick: () => subirExtracto() }, '+ Subir extracto') : null),
      h('div', { class: 'cuentas-estado' }, d.porCuenta.map((x) => h('span', { class: `pill ${x.pdf && x.n43 ? 'ok' : 'warn'}` }, `${x.cuenta.nombre}: ${x.pdf ? 'PDF ✓' : 'PDF ✗'} · ${x.n43 ? 'N43 ✓' : 'N43 ✗'}`))),
      filas.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data tabla-extractos' },
        h('thead', {}, h('tr', {}, ['Cuenta', 'Desde', 'Hasta', 'PDF', 'N43', 'Saldo inicial', 'Saldo final', 'Movs.', 'Notas', ''].map((t, i) => h('th', { scope: 'col', class: i >= 5 && i <= 7 ? 'num' : '' }, t)))),
        h('tbody', {}, filas.map((e) => h('tr', { class: enPeriodo(e) ? 'en-periodo' : '' },
          h('td', {}, nombreCuenta(e.cuenta_id)), h('td', { class: 'mono' }, fmtFecha(e.fecha_desde)), h('td', { class: 'mono' }, fmtFecha(e.fecha_hasta)),
          h('td', {}, e.archivo_pdf ? h('button', { class: 'btn-link', onclick: () => abrir(e.archivo_pdf), title: e.nombre_pdf }, 'Ver PDF') : h('span', { class: 'pill warn' }, 'falta')),
          h('td', {}, e.archivo_n43 ? h('button', { class: 'btn-link', onclick: () => abrir(e.archivo_n43), title: e.nombre_n43 }, 'N43') : h('span', { class: 'pill warn' }, 'falta')),
          h('td', { class: 'num' }, e.saldo_inicial == null ? '' : fmtEUR2(e.saldo_inicial)), h('td', { class: 'num' }, e.saldo_final == null ? '' : fmtEUR2(e.saldo_final)),
          h('td', { class: 'num' }, e.movimientos ?? ''), h('td', { class: 'small' }, e.notas || ''),
          h('td', {}, editar ? h('button', { class: 'btn small', onclick: () => subirExtracto(e) }, e.archivo_pdf && e.archivo_n43 ? 'Editar' : 'Completar') : null)))))) : h('p', { class: 'muted small' }, 'Aún no hay extractos. Descárgalos del banco (PDF y N43) y súbelos aquí.'));
  }

  function seccionHistorial() {
    if (!envios.length) return null;
    return h('section', { class: 'card' }, h('h3', {}, 'Envíos anteriores'),
      h('ul', { class: 'envios' }, envios.map((e) => h('li', {}, h('button', { class: 'btn-link', onclick: () => { periodo = e.periodo; selPeriodo.value = e.periodo; pintar(); } }, nombrePeriodo(e.periodo)),
        ' · ', e.estado === 'enviado' ? `enviado el ${fmtFecha(e.fecha_envio)}` : 'pendiente', e.incompleto ? h('span', { class: 'pill warn' }, `faltaba: ${e.faltaba || '—'}`) : null, e.notas ? h('span', { class: 'muted small' }, ` · ${e.notas}`) : null))));
  }

  // ----- subir / completar un extracto -----
  async function subirExtracto(ext = null) {
    if (!cuentas.length) { toast('Primero da de alta las cuentas bancarias (con su IBAN) en Control > Conciliación bancaria.', 'error'); return; }
    const selCuenta = h('select', { 'aria-label': 'Cuenta' }, cuentas.filter((c) => c.activo !== false || c.id === ext?.cuenta_id).map((c) => h('option', { value: c.id, selected: c.id === ext?.cuenta_id }, c.nombre)));
    const fPdf = h('input', { type: 'file', accept: '.pdf,application/pdf', 'aria-label': 'Extracto en PDF' });
    const fN43 = h('input', { type: 'file', accept: '.n43,.txt,.aeb,.csb,.q43,text/plain', 'aria-label': 'Extracto N43' });
    const [d0, h0] = rangoPeriodo(periodo);
    const iDesde = h('input', { type: 'date', value: ext?.fecha_desde || d0, 'aria-label': 'Desde' });
    const iHasta = h('input', { type: 'date', value: ext?.fecha_hasta || h0, 'aria-label': 'Hasta' });
    const iNotas = h('input', { type: 'text', value: ext?.notas || '', placeholder: 'Opcional', 'aria-label': 'Notas del extracto' });
    const chkMovs = h('input', { type: 'checkbox', checked: true });
    const info = h('div', { class: 'muted small' }, ext ? `Ya tiene: ${ext.archivo_pdf ? 'PDF' : ''}${ext.archivo_pdf && ext.archivo_n43 ? ' y ' : ''}${ext.archivo_n43 ? 'N43' : ''}. Lo que subas sustituye al archivo de ese tipo.` : 'Si subes el N43, las fechas, la cuenta y los saldos se rellenan solos.');
    let n43 = null;
    fN43.addEventListener('change', async () => {
      n43 = null;
      const f = fN43.files[0]; if (!f) return;
      const texto = await f.text();
      if (!esN43(texto)) { info.textContent = 'Ese archivo no parece un N43 (Norma 43). Revísalo.'; info.classList.add('error-texto'); return; }
      const cs = parsearN43(texto);
      n43 = cs[0];
      const c = cuentaN43(n43, cuentas);
      if (c) selCuenta.value = c.id;
      iDesde.value = n43.desde; iHasta.value = n43.hasta;
      info.classList.remove('error-texto');
      info.textContent = `N43: ${c ? c.nombre : 'cuenta …' + n43.cuenta.slice(-4) + ' (elígela abajo)'} · del ${fmtFecha(n43.desde)} al ${fmtFecha(n43.hasta)} · ${n43.movimientos.length} movimientos · saldo ${fmtEUR2(n43.saldo_inicial)} → ${fmtEUR2(n43.saldo_final)}${cs.length > 1 ? ` · el archivo trae ${cs.length} cuentas: se usa la primera` : ''}`;
    });
    const ok = await confirmar({ titulo: ext ? 'Completar extracto' : 'Subir extracto bancario', ok: 'Guardar',
      texto: h('div', { class: 'form-extracto' }, info,
        h('label', {}, 'Cuenta', selCuenta), h('label', {}, 'PDF', fPdf), h('label', {}, 'N43', fN43),
        h('div', { class: 'fila-2' }, h('label', {}, 'Desde', iDesde), h('label', {}, 'Hasta', iHasta)),
        h('label', {}, 'Notas', iNotas),
        h('label', { class: 'check small' }, chkMovs, 'Importar también los movimientos del N43 a Conciliación bancaria (los repetidos se ignoran)')) });
    if (!ok) return;
    if (!iDesde.value || !iHasta.value || iHasta.value < iDesde.value) { toast('Revisa las fechas del extracto.', 'error'); return; }
    if (!ext && !fPdf.files[0] && !fN43.files[0]) { toast('No has elegido ningún archivo.', 'error'); return; }
    const cuenta = cuentas.find((c) => c.id === selCuenta.value);
    const carpeta = `extractos/${limpio(cuenta.nombre)}`;
    try {
      const cambios = { cuenta_id: cuenta.id, fecha_desde: iDesde.value, fecha_hasta: iHasta.value, notas: iNotas.value.trim() || null };
      if (fPdf.files[0]) Object.assign(cambios, { archivo_pdf: await db.subirArchivoGestoria(fPdf.files[0], carpeta), nombre_pdf: fPdf.files[0].name });
      if (fN43.files[0]) Object.assign(cambios, { archivo_n43: await db.subirArchivoGestoria(fN43.files[0], carpeta), nombre_n43: fN43.files[0].name });
      if (n43) Object.assign(cambios, { saldo_inicial: n43.saldo_inicial, saldo_final: n43.saldo_final, movimientos: n43.movimientos.length });
      // ¿Ya hay un extracto de esa cuenta con las mismas fechas? Se completa en lugar de duplicarlo
      const mismo = ext || extractos.find((e) => e.cuenta_id === cuenta.id && e.fecha_desde === cambios.fecha_desde && e.fecha_hasta === cambios.fecha_hasta);
      if (mismo) Object.assign(mismo, await db.actualizarExtracto(mismo.id, cambios));
      else extractos.unshift(await db.crearExtracto(cambios));
      let importados = 0;
      if (n43 && chkMovs.checked && n43.movimientos.length) {
        const filas = ponerClaves(n43.movimientos.map((m) => ({ fecha: m.fecha, fecha_valor: m.fecha_valor, concepto: m.concepto || null, importe: Math.round(m.importe * 100) / 100, saldo: null })))
          .map((m) => ({ ...m, cuenta_id: cuenta.id, centro_id: cuenta.centro_id || null, archivo: fN43.files[0].name, estado: 'pendiente' }));
        const nuevos = await db.insertarMovimientos(filas);
        importados = nuevos.length;
        ctx.state.movimientos = [...nuevos, ...ctx.state.movimientos];
      }
      toast(`Extracto guardado (${nombreCuenta(cuenta.id)}, ${fmtFecha(cambios.fecha_desde)} – ${fmtFecha(cambios.fecha_hasta)})${importados ? ` · ${importados} movimientos nuevos en Conciliación` : ''}`);
      pintar();
    } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
  }

  // ----- paquete ZIP -----
  async function descargarPaquete(d, criticos, faltan) {
    if (criticos.length) {
      const seguir = await confirmar({ titulo: 'Falta documentación', ok: 'Descargar igualmente', peligro: true,
        texto: h('div', {}, h('p', {}, `Para ${nombrePeriodo(periodo)} falta:`), h('ul', {}, criticos.map((c) => h('li', {}, c.texto))), h('p', { class: 'muted small' }, 'Lo mejor es subirlo todo antes de mandarlo a la gestoría.')) });
      if (!seguir) return;
    }
    toast('Preparando el paquete…');
    const base = `Gestoria ${periodo}`;
    const archivos = [];
    const hojas = hojasPaquete(d, ctx);
    archivos.push({ nombre: `${base}/Gastos ${periodo}.xlsx`, datos: await crearXlsx([{ nombre: 'Gastos', filas: hojas.gastos }]).arrayBuffer() });
    archivos.push({ nombre: `${base}/Ingresos ${periodo}.xlsx`, datos: await crearXlsx([{ nombre: 'Facturas emitidas', filas: hojas.ingresos }]).arrayBuffer() });
    archivos.push({ nombre: `${base}/Conciliacion bancaria ${periodo}.xlsx`, datos: await crearXlsx([{ nombre: 'Conciliación', filas: hojas.conciliacion }, { nombre: 'Abonos', filas: hojas.abonos },
      { nombre: 'Factura en varios pagos', filas: hojas.variosPagos }, { nombre: 'Pago de varias facturas', filas: hojas.variosFacturas }, { nombre: 'Sin factura', filas: hojas.ignorados }]).arrayBuffer() });
    archivos.push({ nombre: `${base}/Balance ${periodo}.xlsx`, datos: await crearXlsx([{ nombre: 'Balance', filas: hojas.balance }, { nombre: 'Movimientos banco', filas: hojas.banco }]).arrayBuffer() });
    const errores = [];
    for (const g of d.enStorage) {
      const ruta = g.link_factura.slice(8);
      const ext = (ruta.match(/\.(\w{2,5})$/) || [, 'pdf'])[1].toLowerCase();
      try { archivos.push({ nombre: `${base}/Facturas gastos/${limpio(`${fechaGasto(g)} ${g.empresa} ${g.factura_nr || ''} ${num(g.cantidad).toFixed(2)}`)}.${ext}`, datos: await (await db.descargarArchivo('facturas', ruta)).arrayBuffer() }); }
      catch (ex) { errores.push(`${g.empresa} ${g.factura_nr || ''}: ${ex.message}`); }
    }
    for (const x of d.porCuenta) for (const e of x.extractos) {
      for (const [k, n, tipo] of [['archivo_pdf', 'nombre_pdf', 'pdf'], ['archivo_n43', 'nombre_n43', 'n43']]) {
        if (!e[k]) continue;
        const ext = tipo === 'pdf' ? 'pdf' : ((e[n] || '').match(/\.(\w{2,4})$/) || [, 'n43'])[1];
        try { archivos.push({ nombre: `${base}/Extractos/${limpio(x.cuenta.nombre)} ${e.fecha_desde} a ${e.fecha_hasta}.${ext}`, datos: await (await db.descargarArchivo('gestoria', e[k])).arrayBuffer() }); }
        catch (ex) { errores.push(`Extracto ${x.cuenta.nombre}: ${ex.message}`); }
      }
    }
    const env = envios.find((e) => e.periodo === periodo);
    const lineas = [`Envío a la gestoría · ${nombrePeriodo(periodo)}`, `Preparado el ${fmtFecha(hoyISO())}`, ''];
    if (env?.notas) lineas.push('NOTAS DEL ENVÍO', env.notas, '');
    const nm = notas.filter((n) => n.periodo === periodo);
    if (nm.length) lineas.push('NOTAS DEL MES', ...nm.map((n) => `- ${n.texto}${n.hecho ? ' (hecho)' : ''}`), '');
    lineas.push('CONCILIACIÓN BANCARIA Y ABONOS',
      '- Importe NEGATIVO en "Gastos" = abono / nota de crédito del proveedor (p. ej. por una devolución). Se resta del gasto; su devolución llega al banco como un ingreso.',
      '- Una factura puede pagarse con 2 o más movimientos del banco, y un único movimiento puede pagar 2 o más facturas. Cada pareja movimiento-factura con el importe que cubre está en "Conciliacion bancaria ' + periodo + '.xlsx" (hoja "Conciliación").',
      `- Facturas pagadas en varios pagos: ${new Set(d.conc.variosPagos.map((f) => f.g.id)).size} · Pagos que cubren varias facturas: ${new Set(d.conc.variosFacturas.map((f) => f.m.id)).size} (hojas "Factura en varios pagos" y "Pago de varias facturas").`,
      `- Abonos / notas de crédito del envío: ${d.abonos.length}${d.abonosSinCobro.length ? ` (${d.abonosSinCobro.length} todavía sin devolución cobrada en el banco)` : ''} (hoja "Abonos"). La columna "Banco" de "Gastos" indica cómo está cubierto cada gasto.`,
      `- Movimientos del banco sin factura (traspasos entre cuentas, pagos sin factura…) o ignorados: ${d.ignorados.length}. Cada uno lleva el comentario escrito en Conciliación (hoja "Sin factura" de "Conciliacion bancaria ${periodo}.xlsx" y columna "Comentario" de "Movimientos banco" en el Balance).`,
      ...d.ignorados.map((m) => `  · ${m.fecha} ${fmtEUR2(m.importe)} ${m.concepto || ''}: ${m.notas || '(sin comentario)'}`),
      ...d.parciales.map((g) => `- PARCIAL: ${fechaGasto(g)} ${g.empresa} ${g.factura_nr || ''} ${fmtEUR2(g.cantidad)}: ${estadoBanco(g, d)}`), '');
    if (faltan.length) lineas.push('PENDIENTE / AVISOS', ...faltan.map((c) => `- ${c.texto}`), '');
    if (d.soloEnlace.length) lineas.push('FACTURAS COMO ENLACE (no van en el ZIP)', ...d.soloEnlace.map((g) => `- ${fechaGasto(g)} ${g.empresa} ${g.factura_nr || ''} ${fmtEUR2(g.cantidad)}: ${g.link_factura}`), '');
    if (errores.length) lineas.push('NO SE HAN PODIDO AÑADIR', ...errores.map((e) => `- ${e}`), '');
    archivos.push({ nombre: `${base}/LEEME.txt`, datos: lineas.join('\r\n') });
    descargarBlob(crearZip(archivos), `${base}.zip`);
    toast(errores.length ? `Paquete descargado, pero ${errores.length} archivos no se han podido añadir (mira LEEME.txt)` : 'Paquete descargado', errores.length ? 'error' : 'ok');
  }

  async function marcarEnviado(d, faltan, env) {
    const pend = d.lista.filter((g) => !enviado(g));
    const ok = await confirmar({ titulo: `Marcar ${nombrePeriodo(periodo)} como enviado`, ok: faltan.some((c) => c.critico) ? 'Marcar enviado aunque falten cosas' : 'Marcar enviado', peligro: faltan.some((c) => c.critico),
      texto: h('div', {}, faltan.length ? h('div', {}, h('p', {}, 'Ojo, todavía hay avisos:'), h('ul', {}, faltan.map((c) => h('li', { class: c.critico ? 'falta' : '' }, c.texto)))) : h('p', {}, 'Está todo completo.'),
        h('p', {}, `Se marcarán ${pend.length} gastos como "enviados a gestoría" con fecha de hoy.`)) });
    if (!ok) return;
    try {
      const hoy = hoyISO();
      const criticos = faltan.filter((c) => c.critico);
      const e = await db.guardarEnvio(periodo, { estado: 'enviado', fecha_envio: hoy, incompleto: criticos.length > 0, faltaba: criticos.map((c) => c.texto).join('; ') || null });
      const i = envios.findIndex((x) => x.periodo === periodo); if (i >= 0) envios[i] = e; else envios.unshift(e);
      if (pend.length) {
        const act = await db.marcarGastosGestoria(pend.map((g) => g.id), hoy);
        for (const g of act) { const l = gastosPorCurso.get(g.curso_id); if (!l) continue; const j = l.findIndex((x) => x.id === g.id); if (j >= 0) l[j] = g; ctx.setGastos?.(g.curso_id, l); }
      }
      ctx.refrescarResumen?.();
      toast(`${nombrePeriodo(periodo)} marcado como enviado`);
      pintar();
    } catch (ex) { toast(ex.message, 'error'); }
  }

  clear(cont, h('div', { class: 'gestoria-filtros' }, h('label', { class: 'check small' }, 'Mes del envío', selPeriodo)), cuerpo);
  pintar();
}
registrarSeccion('gestoria', renderGestoria);
