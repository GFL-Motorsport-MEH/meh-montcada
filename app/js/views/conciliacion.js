// Control > Conciliación bancaria: cuentas, importar extractos (CSV/Excel), conciliar con los gastos y revisar lo pendiente.
import { h, clear, cargando, toast, confirmar, fmtEUR2, fmtFecha, num, normalizar, leerHojaArchivo, descargarCSV } from '../ui.js';
import * as db from '../db.js';
import { vista, filtroFecha, pasaFecha, describirFecha, crearAviso, vincular as vincularCampo, FECHA_VACIA } from '../vista.js';
import { registrarSeccion } from './control.js';
import { parsearExtracto, ponerClaves, cuentaDeArchivo, conciliar, conciliarDevoluciones, gastosParaMov, movsParaGasto, asignadoMov, asignadoGasto, restanteMov, restanteGasto, esAbono, esDevolucion, bancoDeCuenta, esperadoRemesas, ingresadoRemesas, asignadoRemesasMov, sugerirRemesas, aprenderAlias, motivoGasto } from '../banco.js';
import { abrirGastoForm } from './gasto-form.js';
import { formatoIBAN, ibanValido } from './config.js';

const ESTADOS = [['pendiente', 'Pendientes'], ['conciliado', 'Conciliados'], ['ignorado', 'Ignorados'], ['', 'Todos']];

async function renderConciliacion(cont, ctx) {
  clear(cont, cargando());
  const { state } = ctx;
  const admin = ctx.esAdmin();
  const [cuentas, movs, enlaces, movRem, envios] = await Promise.all([db.getCuentas(), state.movimientos ? Promise.resolve(state.movimientos) : db.getMovimientos(), state.movGastos ? Promise.resolve(state.movGastos) : db.getMovGastos(),
    state.movRemesas ? Promise.resolve(state.movRemesas) : db.getMovRemesas().catch(() => []), db.getRemesaEnvios().catch(() => [])]);
  state.movRemesas = movRem;   // ingresos de remesas enlazados (se modifica en el sitio)
  state.movimientos = movs; state.movGastos = enlaces;   // `enlaces` se modifica siempre en el sitio: lo comparten Conciliación y Gestoría
  const gastosPorCurso = new Map();
  for (const c of state.cursosVisibles) gastosPorCurso.set(c.id, await ctx.gastos(c.id));
  const todosGastos = () => [...gastosPorCurso.values()].flat();
  const gastoPorId = () => new Map(todosGastos().map((g) => [g.id, g]));
  const r2c = (n) => Math.round(n * 100) / 100;
  const asigRem = (m) => asignadoRemesasMov(m, movRem);
  const restTotal = (m) => r2c(restanteMov(m, enlaces) - asigRem(m));   // lo que falta por cubrir de un movimiento (facturas/abonos + remesas)
  const nombreCentro = (id) => ctx.tituloCentro(state.centros.find((c) => c.id === id)?.nombre || '');
  const nombreCuenta = (id) => cuentas.find((c) => c.id === id)?.nombre || '—';
  const f = vista('conciliacion.f', { cuenta: '', estado: 'pendiente', tipo: 'pagos', q: '', fecha: { ...FECHA_VACIA } });
  if (f.cuenta && !cuentas.some((c) => c.id === f.cuenta)) f.cuenta = '';
  let limite = 150;

  // ---- actualizar gastos en la caché de la app ----
  function refrescarGastos(actualizados) {
    for (const g of actualizados) {
      const lista = gastosPorCurso.get(g.curso_id);
      if (!lista) continue;
      const i = lista.findIndex((x) => x.id === g.id);
      if (i >= 0) lista[i] = g; else lista.unshift(g);
      ctx.setGastos(g.curso_id, lista);
    }
  }
  function refrescarMovs(actualizados) {
    const porId = new Map(actualizados.map((m) => [m.id, m]));
    for (let i = 0; i < movs.length; i++) if (porId.has(movs[i].id)) movs[i] = porId.get(movs[i].id);
  }

  // ---- enlaces movimiento <-> gasto: un pago puede cubrir varias facturas y una factura puede pagarse en varios pagos ----
  const fg = (g) => g.fecha_pago || g.fecha_factura;
  const textoGasto = (g) => `${fmtFecha(fg(g))} · ${g.empresa || '—'}${g.factura_nr ? ` · ${g.factura_nr}` : ''} · ${g.concepto || ''} · ${fmtEUR2(num(g.cantidad))}`;
  const textoMov = (m) => `${fmtFecha(m.fecha)} · ${m.concepto || '—'} · ${fmtEUR2(num(m.importe))}`;
  // Aplica un cambio de enlaces en la lista local: quita los de los movimientos/gastos indicados y añade los nuevos. Devuelve lo tocado.
  function aplicarLocal({ quitarMovs = [], quitarGastos = [], nuevos = [] }) {
    const tocM = new Set(quitarMovs), tocG = new Set(quitarGastos);
    for (let i = enlaces.length - 1; i >= 0; i--) {
      const e = enlaces[i];
      if (quitarMovs.includes(e.movimiento_id) || quitarGastos.includes(e.gasto_id)) { tocM.add(e.movimiento_id); tocG.add(e.gasto_id); enlaces.splice(i, 1); }
    }
    for (const n of nuevos) {
      const i = enlaces.findIndex((e) => e.movimiento_id === n.movimiento_id && e.gasto_id === n.gasto_id);
      if (i >= 0) enlaces[i] = { ...enlaces[i], ...n }; else enlaces.push(n);
      tocM.add(n.movimiento_id); tocG.add(n.gasto_id);
    }
    return { movIds: [...tocM], gastoIds: [...tocG] };
  }
  // Recalcula el estado de los movimientos (conciliado solo si sus enlaces suman su importe) y el "comprobado en banco" de los gastos
  async function recalcular({ movIds, gastoIds }) {
    const porEstado = new Map();
    for (const id of movIds) {
      const m = movs.find((x) => x.id === id); if (!m) continue;
      const mis = enlaces.filter((e) => e.movimiento_id === id);
      const conRem = movRem.some((x) => x.movimiento_id === id);
      const completo = (mis.length > 0 || conRem) && Math.abs(restTotal(m)) <= 0.01;
      const estado = completo ? 'conciliado' : (m.estado === 'ignorado' && !mis.length && !conRem ? 'ignorado' : 'pendiente');
      const gasto_id = mis[0]?.gasto_id || null;
      if (m.estado !== estado || (m.gasto_id || null) !== gasto_id) { const k = `${estado}|${gasto_id || ''}`; if (!porEstado.has(k)) porEstado.set(k, { estado, gasto_id, ids: [] }); porEstado.get(k).ids.push(id); }
    }
    for (const { estado, gasto_id, ids } of porEstado.values()) refrescarMovs(await db.actualizarMovimientos(ids, { estado, gasto_id }));
    const marcar = [], desmarcar = [];
    const porId = gastoPorId();
    for (const id of gastoIds) {
      const g = porId.get(id); if (!g) continue;
      const completo = asignadoGasto(g, enlaces) > 0.009 && Math.abs(restanteGasto(g, enlaces)) <= 0.01;
      if (completo && !g.check_banca) marcar.push(id); else if (!completo && g.check_banca) desmarcar.push(id);
    }
    if (marcar.length) refrescarGastos(await db.marcarGastosBanca(marcar, true));
    if (desmarcar.length) refrescarGastos(await db.marcarGastosBanca(desmarcar, false));
  }
  // Escribe en la base de datos y recalcula. alcance: { movimiento_id } o { gasto_id } (sustituye todos sus enlaces) o { nuevos } (solo añade)
  async function guardarEnlaces(alcance, filas) {
    if (alcance.movimiento_id || alcance.gasto_id) {
      const guardados = await db.reemplazarEnlaces(alcance, filas);
      return recalcular(aplicarLocal({ quitarMovs: alcance.movimiento_id ? [alcance.movimiento_id] : [], quitarGastos: alcance.gasto_id ? [alcance.gasto_id] : [], nuevos: guardados }));
    }
    return recalcular(aplicarLocal({ nuevos: await db.insertarEnlaces(filas) }));
  }
  async function quitarEnlacesDe(movId) {
    await db.quitarEnlacesMov([movId]);
    if (movRem.some((x) => x.movimiento_id === movId)) { await db.quitarMovRemesasMov([movId]); for (let i = movRem.length - 1; i >= 0; i--) if (movRem[i].movimiento_id === movId) movRem.splice(i, 1); }
    return recalcular(aplicarLocal({ quitarMovs: [movId] }));
  }

  // Ventana para elegir uno o varios elementos que cubren un importe (facturas para un pago, pagos para una factura, ingresos para un abono).
  // ancla = importe que hay que cubrir; previos = Map id -> importe ya enlazado (se pueden cambiar); buscar(q) -> [{ id, texto, restante }]
  async function elegirEnlaces({ titulo, cabecera, ancla, previos, buscar, ayuda, opciones = [] }) {
    const op = {};
    const sel = new Map([...previos].map(([id, imp]) => [id, imp]));
    const conocidos = new Map();   // id -> { id, texto, restante } (incluye los ya enlazados)
    const q = h('input', { type: 'search', placeholder: 'Buscar por empresa, concepto, nº de factura o importe…', 'aria-label': 'Buscar' });
    const lista = h('div', { class: 'candidatos' });
    const total = h('div', { class: 'small', role: 'status' });
    const r2 = (n) => Math.round(n * 100) / 100;
    function pintarTotal() {
      const suma = r2([...sel.values()].reduce((a, b) => a + (Number(b) || 0), 0)), dif = r2(ancla - suma);
      total.className = `small ${Math.abs(dif) <= 0.01 ? '' : dif < 0 ? 'critical' : 'muted'}`;
      total.textContent = `Asignado ${fmtEUR2(suma)} de ${fmtEUR2(ancla)}` + (Math.abs(dif) <= 0.01 ? ' ✓' : dif > 0 ? ` · falta ${fmtEUR2(dif)} (queda como parcial)` : ` · sobran ${fmtEUR2(-dif)}: baja algún importe`);
    }
    function pintarLista() {
      const items = new Map();
      for (const id of sel.keys()) if (conocidos.has(id)) items.set(id, conocidos.get(id));
      for (const c of buscar(q.value, op)) { conocidos.set(c.id, c); if (!items.has(c.id)) items.set(c.id, c); }
      const pendiente = () => r2(ancla - [...sel.values()].reduce((a, b) => a + (Number(b) || 0), 0));
      clear(lista, items.size ? [...items.values()].map((c) => {
        const activo = sel.has(c.id);
        const imp = h('input', { type: 'text', inputmode: 'decimal', 'data-punto': '1', autocomplete: 'off', step: '0.01', min: '0.01', class: 'input-corto', 'aria-label': `Importe de ${c.texto}`, value: activo ? sel.get(c.id) : '', disabled: !activo,
          oninput: () => { sel.set(c.id, imp.value === '' ? '' : Number(imp.value)); pintarTotal(); } });
        const chk = h('input', { type: 'checkbox', checked: activo, onchange: () => {
          if (chk.checked) { const v = r2(Math.min(c.restante, Math.max(pendiente(), 0)) || c.restante); sel.set(c.id, v); imp.value = v; imp.disabled = false; } else { sel.delete(c.id); imp.value = ''; imp.disabled = true; }
          pintarTotal();
        } });
        return h('label', { class: 'check small cand' }, chk, h('span', {}, c.texto, c.restante !== undefined && c.parcial ? h('span', { class: 'muted' }, ` (por cubrir ${fmtEUR2(c.restante)})`) : null, c.motivo ? h('span', { class: 'line2' }, c.motivo) : null), imp);
      }) : h('p', { class: 'muted small' }, opciones.length ? 'No hay candidatos claros (mismo importe o empresa reconocida). Escribe en el buscador o marca «parecidos» / «otros centros».' : 'No hay nada que encaje. Prueba con otra búsqueda.'));
      pintarTotal();
    }
    q.addEventListener('input', pintarLista);
    pintarLista();
    const checks = opciones.length ? h('div', { class: 'filters' }, opciones.map(([clave, label]) => h('label', { class: 'check small' }, h('input', { type: 'checkbox', onchange: (e) => { op[clave] = e.target.checked; pintarLista(); } }), label))) : null;
    const cont = h('div', { class: 'enlazar' }, h('p', {}, cabecera), ayuda ? h('p', { class: 'muted small' }, ayuda) : null, q, checks, lista, total);
    for (;;) {
      const ok = await confirmar({ titulo, ok: 'Guardar enlaces', texto: cont });
      if (!ok) return null;
      const filas = [...sel].map(([id, importe]) => ({ id, importe: Number(importe) }));
      const suma = r2(filas.reduce((a, f) => a + f.importe, 0));
      if (filas.some((f) => !(f.importe > 0))) { toast('Pon un importe mayor que 0 en cada elemento marcado.', 'error'); continue; }
      const pasa = filas.find((f) => conocidos.get(f.id) && f.importe > conocidos.get(f.id).restante + 0.01);
      if (pasa) { toast(`«${conocidos.get(pasa.id).texto}» solo tiene ${fmtEUR2(conocidos.get(pasa.id).restante)} por cubrir.`, 'error'); continue; }
      if (suma > ancla + 0.01) { toast(`Lo asignado (${fmtEUR2(suma)}) supera el importe a cubrir (${fmtEUR2(ancla)}).`, 'error'); continue; }
      return filas;
    }
  }

  // ---- ingresos de remesas: solo se comprueba que el total ingresado coincide con el total esperado (Sabadell no ingresa por remesas) ----
  const NOMBRE_BANCO = { SABADELL: 'Sabadell', BBVA: 'BBVA' };
  const cursoNombre = (id) => state.cursos.find((c) => c.id === id)?.nombre || '';
  const etiquetaEnvio = (e) => `${e.mes.charAt(0).toUpperCase() + e.mes.slice(1)} · ${cursoNombre(e.curso_id)}`;
  const enviosOrden = () => [...envios].sort((a, b) => (b.enviado_el || '').localeCompare(a.enviado_el || ''));
  const enGrupo = (k) => movRem.filter((x) => x.curso_id === k.curso_id && x.mes === k.mes && x.banco === k.banco);
  const sumaDias = (iso, d) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
  // Ventana para elegir los ingresos del banco que corresponden a las remesas de un mes y banco. Permite cambiar de envío y banco.
  async function vincularRemesas({ env, banco, movPre = null }) {
    let grupo = { curso_id: env.curso_id, mes: env.mes, banco };
    const sel = new Map();   // movimiento_id -> remesa_nombre ('' = total del banco)
    const prevMap = new Map();
    const cargarGrupo = () => {
      sel.clear(); prevMap.clear();
      for (const x of enGrupo(grupo)) { sel.set(x.movimiento_id, x.remesa_nombre || ''); prevMap.set(x.movimiento_id, num(x.importe)); }
      if (movPre && !sel.has(movPre.id)) sel.set(movPre.id, '');
    };
    cargarGrupo();
    const envActual = () => envios.find((e) => e.curso_id === grupo.curso_id && e.mes === grupo.mes) || env;
    const disp = (m) => r2c(restTotal(m) + (prevMap.get(m.id) || 0));
    const selEnv = h('select', { 'aria-label': 'Remesas de' }, enviosOrden().map((e) => h('option', { value: `${e.curso_id}|${e.mes}`, selected: e.curso_id === grupo.curso_id && e.mes === grupo.mes }, etiquetaEnvio(e))));
    const selBanco = h('select', { 'aria-label': 'Banco de las remesas' }, [['SABADELL', 'Sabadell'], ['BBVA', 'BBVA']].map(([v, t]) => h('option', { value: v, selected: v === banco }, t)));
    const desde = h('input', { type: 'date', 'aria-label': 'Ingresos desde' }), hasta = h('input', { type: 'date', 'aria-label': 'Ingresos hasta' });
    const selCuenta = h('select', { 'aria-label': 'Cuenta' }, h('option', { value: '' }, 'Todas las cuentas'), cuentas.map((c) => h('option', { value: c.id }, c.nombre)));
    const q = h('input', { type: 'search', placeholder: 'Buscar concepto o importe…', 'aria-label': 'Buscar ingreso' });
    const lista = h('div', { class: 'candidatos' }); const total = h('div', { class: 'small', role: 'status' });
    const ponerFiltros = () => {
      const e = envActual(); const f0 = (e.enviado_el || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
      desde.value = sumaDias(f0, -7); hasta.value = sumaDias(f0, 75);
      selCuenta.value = cuentas.find((c) => bancoDeCuenta(c) === grupo.banco)?.id || '';
    };
    ponerFiltros();
    const visibles = () => {
      const nq = normalizar(q.value.trim());
      const esDevRec = (m) => num(m.importe) < 0 && /devol|impag|rechaz|retroc/.test(normalizar(m.concepto || ''));
      const l = movs.filter((m) => num(m.importe) !== 0 && (num(m.importe) > 0 || sel.has(m.id) || esDevRec(m) || !!nq) && (sel.has(m.id) || (m.estado !== 'ignorado' && disp(m) > 0.009))
        && (sel.has(m.id) || ((!selCuenta.value || m.cuenta_id === selCuenta.value) && (!desde.value || m.fecha >= desde.value) && (!hasta.value || m.fecha <= hasta.value)))
        && (!nq || sel.has(m.id) || normalizar(`${m.concepto} ${num(m.importe).toFixed(2).replace('.', ',')} ${m.importe}`).includes(nq)));
      return l.sort((a, b) => Number(sel.has(b.id)) - Number(sel.has(a.id)) || a.fecha.localeCompare(b.fecha)).slice(0, 300);
    };
    function pintarTotal() {
      const e = envActual(); const esp = esperadoRemesas(e, grupo.banco);
      const suma = r2c([...sel.keys()].reduce((s, id) => { const m = movs.find((x) => x.id === id); return s + (m ? Math.sign(num(m.importe)) * disp(m) : 0); }, 0)); const dif = r2c(esp - suma);
      total.className = `small ${Math.abs(dif) <= 0.01 ? '' : dif < 0 ? 'critical' : 'muted'}`;
      total.textContent = esp <= 0 ? `Este envío no tiene remesas de ${NOMBRE_BANCO[grupo.banco]}.` : `Ingresos (menos devoluciones) marcados ${fmtEUR2(suma)} de ${fmtEUR2(esp)} esperados` + (Math.abs(dif) <= 0.01 ? ' ✓ cuadra' : dif > 0 ? ` · faltan ${fmtEUR2(dif)}` : ` · sobran ${fmtEUR2(-dif)}`);
    }
    function pintarLista() {
      const e = envActual(); const nombres = (e.resumen || []).filter((x) => x.banco === 'BBVA').map((x) => x.remesa_nombre);
      const vis = visibles();
      clear(lista, vis.length ? vis.map((m) => {
        const chk = h('input', { type: 'checkbox', checked: sel.has(m.id), onchange: () => { if (chk.checked) sel.set(m.id, ''); else sel.delete(m.id); pintarTotal(); pintarLista(); } });
        const rem = grupo.banco === 'BBVA' && sel.has(m.id) ? h('select', { class: 'select-celda', 'aria-label': 'Remesa de este ingreso', onchange: (ev) => sel.set(m.id, ev.target.value) },
          h('option', { value: '' }, 'Total BBVA'), nombres.map((n) => h('option', { value: n, selected: n === sel.get(m.id) }, n))) : null;
        return h('label', { class: 'check small cand' }, chk, h('span', {}, `${fmtFecha(m.fecha)} · ${m.concepto || '—'} · ${nombreCuenta(m.cuenta_id)} · `, num(m.importe) < 0 ? h('span', { class: 'pill warn' }, 'devolución') : null, ' ', h('strong', {}, (num(m.importe) < 0 ? '−' : '') + fmtEUR2(disp(m)))), rem);
      }) : h('p', { class: 'muted small' }, 'No hay ingresos con estos filtros. Amplía las fechas o cambia de cuenta.'));
      pintarTotal();
    }
    const cambiarGrupo = () => { const [c, mes] = selEnv.value.split('|'); grupo = { curso_id: c, mes, banco: selBanco.value }; cargarGrupo(); ponerFiltros(); pintarLista(); };
    selEnv.addEventListener('change', cambiarGrupo); selBanco.addEventListener('change', cambiarGrupo);
    for (const el of [desde, hasta, selCuenta]) el.addEventListener('change', pintarLista);
    q.addEventListener('input', pintarLista);
    const marcar = (v) => h('button', { class: 'btn small', type: 'button', onclick: () => { for (const m of visibles()) { if (v) sel.set(m.id, sel.get(m.id) || ''); else sel.delete(m.id); } pintarLista(); } }, v ? 'Marcar todos los visibles' : 'Desmarcar');
    pintarLista();
    const cont = h('div', { class: 'enlazar' },
      h('div', { class: 'filters', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px' }, h('label', { class: 'small' }, 'Remesas de ', selEnv), selBanco),
      h('p', { class: 'muted small' }, 'Marca los ingresos del banco que corresponden a estas remesas. Solo se compara el total: no hace falta emparejar cada recibo.'),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px' }, selCuenta, h('label', { class: 'small' }, 'Del ', desde), h('label', { class: 'small' }, 'al ', hasta), q, marcar(true), marcar(false)), lista, total);
    const ok = await confirmar({ titulo: 'Ingresos de remesas', ok: 'Guardar', texto: cont });
    if (!ok) return;
    try {
      const filas = [...sel].map(([id, remesa]) => { const m = movs.find((x) => x.id === id); return { movimiento_id: id, ...grupo, remesa_nombre: remesa || null, importe: Math.sign(num(m.importe)) * disp(m) }; }).filter((f) => f.importe !== 0);
      const antes = enGrupo(grupo).map((x) => x.movimiento_id);
      const guardados = await db.reemplazarMovRemesas(grupo, filas);
      for (let i = movRem.length - 1; i >= 0; i--) if (movRem[i].curso_id === grupo.curso_id && movRem[i].mes === grupo.mes && movRem[i].banco === grupo.banco) movRem.splice(i, 1);
      movRem.push(...guardados);
      await recalcular({ movIds: [...new Set([...antes, ...guardados.map((x) => x.movimiento_id)])], gastoIds: [] });
      toast(filas.length ? 'Ingresos de remesas guardados' : 'Enlaces de remesas quitados'); pintarCuentas(); pintar();
    } catch (ex) { toast(ex.message, 'error'); }
  }
  // Desde un ingreso: abre la ventana con el envío y el banco que mejor encajan con su importe
  function remesasDeMov(m) {
    if (!envios.length) { toast('Todavía no hay remesas enviadas guardadas (pestaña Remesas → REMESAS ENVIADAS).', 'error'); return; }
    const bc = bancoDeCuenta(cuentas.find((c) => c.id === m.cuenta_id)); const imp = Math.abs(num(m.importe));
    let mejor = null;
    for (const e of enviosOrden()) for (const b of ['SABADELL', 'BBVA']) {
      if (esperadoRemesas(e, b) <= 0) continue;
      const pts = (Math.abs(esperadoRemesas(e, b) - imp) <= 0.01 ? 4 : 0) + (b === bc ? 2 : 0) + ((e.enviado_el || '').slice(0, 10) <= m.fecha ? 1 : 0);
      if (!mejor || pts > mejor.pts) mejor = { e, b, pts };
    }
    vincularRemesas({ env: mejor?.e || enviosOrden()[0], banco: mejor?.b || bc || 'SABADELL', movPre: m });
  }
  const remesasEl = h('div', {});
  function pintarRemesas() {
    const lista = enviosOrden().slice(0, 8);
    if (!lista.length) { clear(remesasEl); return; }
    const filas = [];
    let hayPend = false;
    for (const e of lista) for (const b of ['SABADELL', 'BBVA']) {
      const esp = esperadoRemesas(e, b); if (esp <= 0) continue;
      const ing = ingresadoRemesas(movRem, e, b); const dif = r2c(esp - ing);
      const estado = ing === 0 ? ['warn', 'Sin ingreso'] : Math.abs(dif) <= 0.01 ? ['ok', 'Cuadra'] : dif > 0 ? ['warn', `Falta ${fmtEUR2(dif)}`] : ['warn', `Sobra ${fmtEUR2(-dif)}`];
      if (estado[1] !== 'Cuadra') hayPend = true;
      filas.push(h('tr', {}, h('td', {}, etiquetaEnvio(e)), h('td', {}, NOMBRE_BANCO[b]), h('td', { class: 'num' }, fmtEUR2(esp)), h('td', { class: 'num' }, fmtEUR2(ing), movRem.some((x) => x.curso_id === e.curso_id && x.mes === e.mes && x.banco === b && num(x.importe) < 0) ? h('div', { class: 'muted small' }, `(incl. − ${fmtEUR2(-movRem.filter((x) => x.curso_id === e.curso_id && x.mes === e.mes && x.banco === b && num(x.importe) < 0).reduce((t, x) => t + num(x.importe), 0))} devueltos)`) : null), h('td', { class: `num ${Math.abs(dif) > 0.01 ? 'critical' : ''}` }, fmtEUR2(dif)),
        h('td', {}, h('span', { class: `pill ${estado[0]}` }, estado[1])), h('td', {}, h('button', { class: 'btn small', onclick: () => vincularRemesas({ env: e, banco: b }) }, ing ? 'Editar ingresos' : 'Vincular ingresos'))));
      if (b === 'BBVA' && movRem.some((x) => x.curso_id === e.curso_id && x.mes === e.mes && x.banco === 'BBVA' && x.remesa_nombre)) {
        for (const r of e.resumen.filter((x) => x.banco === 'BBVA').sort((x, y) => x.orden - y.orden)) {
          const ri = ingresadoRemesas(movRem, e, 'BBVA', r.remesa_nombre); const rd = r2c(num(r.total) - ri);
          filas.push(h('tr', { class: 'muted small' }, h('td', {}, ''), h('td', {}, `· ${r.remesa_nombre}`), h('td', { class: 'num' }, fmtEUR2(num(r.total))), h('td', { class: 'num' }, fmtEUR2(ri)), h('td', { class: 'num' }, fmtEUR2(rd)), h('td', {}, ''), h('td', {}, '')));
        }
      }
    }
    clear(remesasEl, h('details', { class: 'card abonos-pend', open: hayPend }, h('summary', {}, `Remesas: esperado frente a ingresado en el banco${hayPend ? ' (hay diferencias o sin ingreso)' : ' ✓'}`),
      h('p', { class: 'muted small' }, 'Lo esperado es lo guardado con «REMESAS ENVIADAS» en la pestaña Remesas. Se comparan solo los totales por mes y banco. Si el banco devolvió recibos (impagados), enlaza ese movimiento negativo con «Devolución de remesa» y se resta del ingresado.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data', 'data-no-ordenar': '' }, h('thead', {}, h('tr', {}, ['Remesas de', 'Banco', 'Esperado', 'Ingresado', 'Diferencia', 'Estado', ''].map((t, i) => h('th', { scope: 'col', class: [2, 3, 4].includes(i) ? 'num' : '' }, t)))), h('tbody', {}, filas)))));
  }

  // ---- cuentas ----
  const cuentasEl = h('div', { class: 'cuentas-grid' });
  function pintarCuentas() {
    clear(cuentasEl, cuentas.map((c) => {
      const ms = movs.filter((m) => m.cuenta_id === c.id);
      const pend = ms.filter((m) => m.estado === 'pendiente' && num(m.importe) < 0).length;
      const ult = ms.reduce((a, m) => (m.fecha > a ? m.fecha : a), '');
      const campo = (k, label, attrs = {}) => {
        if (!admin) return h('div', { class: 'small' }, `${label}: ${c[k] || '—'}`);
        const i = h('input', { type: 'text', value: c[k] || '', placeholder: label, 'aria-label': `${label} · ${c.nombre}`, class: 'input-cuenta', ...attrs });
        i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
        i.addEventListener('blur', async () => {
          let v = i.value.trim();
          if (k === 'iban') { if (v && !ibanValido(v)) { toast('El IBAN no es válido.', 'error'); i.value = c.iban || ''; return; } v = v ? formatoIBAN(v) : ''; }
          if (v === (c[k] || '') || (k === 'nombre' && !v)) { i.value = c[k] || ''; return; }
          try { Object.assign(c, await db.actualizarCuenta(c.id, { [k]: v || null })); i.value = c[k] || ''; toast('Cuenta guardada'); pintarFiltros(); if (k === 'nombre') pintarCuentas(); } catch (ex) { toast(ex.message, 'error'); }
        });
        return i;
      };
      const cen = state.centros.length > 1 && admin ? h('select', { 'aria-label': `Centro · ${c.nombre}`, onchange: async (e) => {
        try { Object.assign(c, await db.actualizarCuenta(c.id, { centro_id: e.target.value || null })); toast('Cuenta guardada'); } catch (ex) { toast(ex.message, 'error'); }
      } }, h('option', { value: '' }, 'Centro: principal'), state.centros.map((x) => h('option', { value: x.id, selected: x.id === c.centro_id }, `Centro: ${ctx.tituloCentro(x.nombre)}`))) : null;
      return h('div', { class: 'card cuenta' }, campo('nombre', 'Nombre'), campo('iban', 'IBAN', { class: 'input-cuenta mono' }),
        campo('referencia', 'Referencia en el extracto', { title: 'Un texto que aparezca en los extractos de esta cuenta (nº de cuenta, alias...) para reconocerlos al importar' }),
        cen, h('div', { class: 'muted small' }, `${c.banco || 'Banco sin detectar'} · ${ms.length} movimientos${ult ? ` · hasta ${fmtFecha(ult)}` : ''} · ${pend} pagos pendientes`),
        admin ? h('button', { class: 'btn-eliminar-cuenta', title: 'Eliminar esta cuenta', onclick: async () => {
          if (ms.length) { toast(`«${c.nombre}» tiene ${ms.length} movimientos importados y no se puede eliminar.`, 'error'); return; }
          if (!confirm(`¿Eliminar la cuenta «${c.nombre}»? No se puede deshacer.`)) return;
          try { await db.borrarCuenta(c.id); cuentas.splice(cuentas.indexOf(c), 1); toast('Cuenta eliminada'); pintarCuentas(); pintarFiltros(); } catch (ex) { toast(ex.message, 'error'); }
        } }, 'eliminar') : null);
    }), admin ? h('button', { class: 'card cuenta nueva', onclick: async () => {
      try { cuentas.push(await db.crearCuenta({ nombre: `Cuenta ${cuentas.length + 1}`, orden: cuentas.length })); pintarCuentas(); pintarFiltros(); } catch (ex) { toast(ex.message, 'error'); }
    } }, '+ Añadir cuenta bancaria') : null);
  }

  // ---- importar ----
  const archivo = h('input', { type: 'file', accept: '.xlsx,.xls,.csv,.txt', hidden: true, 'aria-label': 'Extracto bancario', onchange: () => importar(archivo.files[0]) });
  async function importar(file) {
    archivo.value = '';
    if (!file) return;
    if (!cuentas.length) { toast('Primero añade la cuenta bancaria.', 'error'); return; }
    let filas;
    try { filas = await leerHojaArchivo(file); } catch (ex) { toast('No se ha podido leer el archivo: ' + ex.message, 'error'); return; }
    const ext = parsearExtracto(filas);
    if (!ext.movimientos.length) { toast(ext.errores[0] || 'No hay movimientos en el archivo.', 'error'); return; }
    const detectada = cuentaDeArchivo(`${file.name} ${ext.cabecera}`, cuentas);
    const sel = h('select', { 'aria-label': 'Cuenta del extracto' }, cuentas.map((c) => h('option', { value: c.id, selected: c === (detectada || cuentas[0]) }, c.nombre)));
    const fechas = ext.movimientos.map((m) => m.fecha).sort();
    const pagos = ext.movimientos.filter((m) => m.importe < 0), cobros = ext.movimientos.filter((m) => m.importe > 0);
    const resumen = h('ul', {},
      h('li', {}, `${ext.movimientos.length} movimientos del ${fmtFecha(fechas[0])} al ${fmtFecha(fechas.at(-1))}`),
      h('li', {}, `${pagos.length} pagos (${fmtEUR2(pagos.reduce((s, m) => s + m.importe, 0))}) y ${cobros.length} cobros (${fmtEUR2(cobros.reduce((s, m) => s + m.importe, 0))})`),
      ext.banco ? h('li', {}, `Formato ${ext.banco}`) : null,
      ext.errores.length ? h('li', { class: 'critical' }, `${ext.errores.length} filas no se han podido leer`) : null);
    const ok = await confirmar({ titulo: 'Importar extracto bancario', ok: 'Importar',
      texto: h('div', {}, h('p', {}, file.name), resumen, h('label', { class: 'check small' }, 'Cuenta:', sel),
        h('p', { class: 'muted small' }, detectada ? 'Cuenta reconocida por el IBAN o la referencia del archivo.' : 'No he reconocido la cuenta en el archivo: elígela (y pon su IBAN o una referencia en la cuenta para la próxima vez).'),
        h('p', { class: 'muted small' }, 'Los movimientos ya importados antes no se duplican.')) });
    if (!ok) return;
    const cuenta = cuentas.find((c) => c.id === sel.value);
    const filasNuevas = ponerClaves(ext.movimientos).map((m) => ({ ...m, cuenta_id: cuenta.id, centro_id: cuenta.centro_id || null, archivo: file.name, estado: 'pendiente' }));
    try {
      const insertados = await db.insertarMovimientos(filasNuevas);
      movs.unshift(...insertados);
      if (!cuenta.banco && ext.banco) Object.assign(cuenta, await db.actualizarCuenta(cuenta.id, { banco: ext.banco }).catch(() => cuenta));
      toast(`${insertados.length} movimientos nuevos importados en ${cuenta.nombre} (${filasNuevas.length - insertados.length} ya estaban).`);
      pintarCuentas(); pintar();
    } catch (ex) { toast('Error al importar: ' + ex.message, 'error'); }
  }

  // ---- conciliar automáticamente ----
  async function autoConciliar() {
    const principal = ctx.centroPrincipal()?.id || null, alias = aprenderAlias(enlaces, movs, todosGastos());
    const pagos = conciliar(todosGastos(), movs, { enlaces, principal, alias });
    const devs = conciliarDevoluciones(todosGastos(), movs, { enlaces, principal, alias });
    const pares = [...pagos, ...devs];
    const rems = sugerirRemesas(envios, movs, { movRemesas: movRem, enlaces, cuentas });
    if (!pares.length && !rems.length) { toast('No he encontrado nuevas coincidencias entre gastos y movimientos.'); return; }
    const masDeUno = pagos.filter((p) => p.movs.length > 1 || p.gastos.length > 1).length;
    const linea = (p) => `${p.otroCentro ? '[otro centro] ' : ''}${fmtFecha(p.gasto.fecha_pago || p.gasto.fecha_factura)} · ${p.gastos.map((g) => `${g.empresa} ${fmtEUR2(g.cantidad)}`).join(' + ')} ↔ ${p.movs.map((m) => `${fmtFecha(m.fecha)} ${fmtEUR2(m.importe)}`).join(' + ')}`;
    const ok = await confirmar({ titulo: 'Conciliar automáticamente', ok: `Conciliar ${pares.length + rems.length}`,
      texto: h('div', {}, pares.length ? h('p', {}, `He encontrado ${pagos.length} pagos con su movimiento en el banco (mismo importe, ±20 días)${masDeUno ? `; ${masDeUno} con varios pagos o varias facturas` : ''}${devs.length ? ` y ${devs.length} devoluciones (concepto «DEVOLUCIÓN») que cuadran con un abono` : ''}.`) : null,
        rems.length ? h('div', {}, h('p', {}, `Ingresos de remesas (${rems.length}):`), h('ul', { class: 'lista-pares' }, rems.map((r) => h('li', {}, `${r.mes} · ${NOMBRE_BANCO[r.banco]} · ${fmtEUR2(r.total)} ← ${r.movs.map((x) => `${fmtFecha(x.fecha)} ${fmtEUR2(x.importe)}`).join(' + ')}`)))) : null,
        h('ul', { class: 'lista-pares' }, pares.slice(0, 14).map((p) => h('li', {}, p.movs[0] && num(p.movs[0].importe) > 0 ? h('strong', {}, 'Devolución · ') : null, linea(p)))),
        pares.length > 14 ? h('p', { class: 'muted small' }, `…y ${pares.length - 14} más.`) : null,
        h('p', { class: 'muted small' }, 'Se marcará "Comprobado en el banco" en los gastos que queden cubiertos del todo.')) });
    if (!ok) return;
    try {
      const filas = pares.flatMap((p) => p.asignaciones.map((x) => ({ movimiento_id: x.mov.id, gasto_id: (x.gasto || p.gasto).id, importe: x.importe })));
      if (filas.length) await guardarEnlaces({}, filas);
      if (rems.length) {
        const nuevas = await db.insertarMovRemesas(rems.flatMap((r) => r.asignaciones.map((x) => ({ movimiento_id: x.mov.id, curso_id: r.curso_id, mes: r.mes, banco: r.banco, remesa_nombre: x.remesa_nombre, importe: x.importe }))));
        movRem.push(...nuevas); await recalcular({ movIds: [...new Set(nuevas.map((x) => x.movimiento_id))], gastoIds: [] });
      }
      toast(`${pares.length + rems.length} conciliaciones guardadas`);
      pintarCuentas(); pintar();
    } catch (ex) { toast('Error al conciliar: ' + ex.message, 'error'); }
  }

  // ---- acciones por movimiento ----
  // Enlazar un movimiento con una o varias facturas (pago) o con los abonos (devolución / ingreso). Se puede repetir para editar.
  async function vincular(m) {
    const pago = num(m.importe) < 0;
    const previos = new Map(enlaces.filter((e) => e.movimiento_id === m.id).map((e) => [e.gasto_id, num(e.importe)]));
    const previoDe = (g) => previos.get(g.id) || 0;
    const principal = ctx.centroPrincipal()?.id || null, alias = aprenderAlias(enlaces, movs, todosGastos());
    const info = (g) => ({ id: g.id, texto: textoGasto(g), motivo: pago ? motivoGasto(g, m, enlaces, alias) : '', restante: Math.round((restanteGasto(g, enlaces) + previoDe(g)) * 100) / 100, parcial: asignadoGasto(g, enlaces) - previoDe(g) > 0.009 });
    const elegidos = await elegirEnlaces({
      titulo: pago ? 'Enlazar pago con facturas' : 'Enlazar ingreso con abonos / notas de crédito', ancla: Math.abs(num(m.importe)) - asigRem(m), previos,
      cabecera: textoMov(m),
      ayuda: pago ? 'Solo salen las facturas de este centro con el mismo importe o con la empresa en el concepto. Marca todas las que paga este movimiento (puede ser 1 o varias). Si una factura se paga en 2 o más pagos, enlaza cada pago por separado con el importe que cubre.'
        : 'Marca el abono o nota de crédito que devuelve este ingreso. Busca por empresa o importe.',
      opciones: [['parecidos', 'Incluir importes parecidos (±5 %)'], ['otrosCentros', 'Incluir otros centros']],
      buscar: (q, op) => { const l = gastosParaMov(m, todosGastos(), enlaces, q, { principal, alias, parecidos: !!op.parecidos, otrosCentros: !!op.otrosCentros }); for (const id of previos.keys()) { const g = gastoPorId().get(id); if (g && !l.includes(g)) l.unshift(g); } return l.map(info); },
    });
    if (!elegidos) return;
    try {
      await guardarEnlaces({ movimiento_id: m.id }, elegidos.map((e) => ({ movimiento_id: m.id, gasto_id: e.id, importe: e.importe })));
      toast(elegidos.length ? 'Movimiento enlazado' : 'Enlaces quitados'); pintarCuentas(); pintar();
    } catch (ex) { toast(ex.message, 'error'); }
  }
  // Desde un abono: buscar el ingreso del banco que lo devuelve
  async function buscarIngresoDeAbono(g) {
    const previos = new Map(enlaces.filter((e) => e.gasto_id === g.id).map((e) => [e.movimiento_id, num(e.importe)]));
    const info = (m) => ({ id: m.id, texto: textoMov(m), restante: Math.round((restanteMov(m, enlaces) + (previos.get(m.id) || 0)) * 100) / 100, parcial: asignadoMov(m, enlaces) - (previos.get(m.id) || 0) > 0.009 });
    const elegidos = await elegirEnlaces({
      titulo: 'Buscar el ingreso de un abono', ancla: Math.abs(num(g.cantidad)), previos, cabecera: textoGasto(g),
      ayuda: 'Ingresos del banco que pueden ser la devolución de este abono. Los que dicen «DEVOLUCIÓN» salen primero.',
      buscar: (q) => { const l = movsParaGasto(g, movs, enlaces, q); for (const id of previos.keys()) { const m = movs.find((x) => x.id === id); if (m && !l.includes(m)) l.unshift(m); } return l.map(info); },
    });
    if (!elegidos) return;
    try {
      await guardarEnlaces({ gasto_id: g.id }, elegidos.map((e) => ({ movimiento_id: e.id, gasto_id: g.id, importe: e.importe })));
      toast(elegidos.length ? 'Abono enlazado con el ingreso' : 'Enlaces quitados'); pintarCuentas(); pintar();
    } catch (ex) { toast(ex.message, 'error'); }
  }
  // Pide el comentario que verá la gestoría (p. ej. «Traspaso de la cuenta de Montcada a la de Alcantarilla»)
  async function pedirComentario(m, { titulo, actual = '' }) {
    const t = h('textarea', { rows: '3', class: 'input-comentario', placeholder: 'Ej.: Traspaso de la cuenta de Montcada a la de Alcantarilla · Pago sin factura de…', 'aria-label': 'Comentario para la gestoría', style: 'width:100%' });
    t.value = actual;
    const ok = await confirmar({ titulo, ok: 'Guardar', texto: h('div', {}, h('p', {}, textoMov(m)), h('p', { class: 'muted small' }, 'Este comentario aparecerá en el resumen que se envía a la gestoría.'), t) });
    return ok ? t.value.trim() : null;
  }
  async function ignorar(m) {
    const c = await pedirComentario(m, { titulo: 'Ignorar movimiento', actual: m.notas || '' });
    if (c === null) return;
    return cambiarEstado(m, 'ignorado', c);
  }
  async function editarComentario(m) {
    const c = await pedirComentario(m, { titulo: 'Comentario del movimiento ignorado', actual: m.notas || '' });
    if (c === null) return;
    try { refrescarMovs(await db.actualizarMovimientos([m.id], { notas: c || null })); toast('Comentario guardado'); pintar(); } catch (ex) { toast(ex.message, 'error'); }
  }
  async function cambiarEstado(m, estado, comentario) {
    try {
      if (enlaces.some((e) => e.movimiento_id === m.id) || movRem.some((x) => x.movimiento_id === m.id)) await quitarEnlacesDe(m.id);   // quita los enlaces y recalcula las facturas afectadas
      const mm = movs.find((x) => x.id === m.id) || m;
      const cambios = { estado, gasto_id: null };
      if (estado === 'ignorado') cambios.notas = comentario || null; else if (mm.estado === 'ignorado') cambios.notas = null;   // el comentario es el motivo de ignorarlo
      if (mm.estado !== estado || mm.gasto_id || 'notas' in cambios && (mm.notas || null) !== cambios.notas) refrescarMovs(await db.actualizarMovimientos([m.id], cambios));
      pintarCuentas(); pintar();
    } catch (ex) { toast(ex.message, 'error'); }
  }
  function crearGasto(m) {
    const curso = state.cursos.find((c) => c.fecha_inicio <= m.fecha && m.fecha <= c.fecha_fin) || ctx.cursoActual();
    abrirGastoForm({ ctx, gasto: null, inicial: { curso_id: curso.id, fecha_factura: m.fecha, fecha_pago: m.fecha, cantidad: Math.abs(num(m.importe)), concepto: m.concepto || '', centro_id: m.centro_id || null, check_banca: true },
      onGuardado: async (g) => {
        refrescarGastos([g]);
        try { await guardarEnlaces({ movimiento_id: m.id }, [{ movimiento_id: m.id, gasto_id: g.id, importe: Math.min(Math.abs(num(m.importe)), Math.abs(num(g.cantidad))) }]); } catch (ex) { toast(ex.message, 'error'); }
        pintarCuentas(); pintar();
      }, onBorrado: () => {} });
  }
  async function moverCentro(m, centro_id) {
    try { refrescarMovs(await db.actualizarMovimientos([m.id], { centro_id: centro_id || null })); toast('Movimiento movido de centro'); } catch (ex) { toast(ex.message, 'error'); }
  }

  // ---- filtros y lista ----
  const filtrosEl = h('div', { class: 'filters filters-conc' });
  const fQ = h('input', { type: 'search', placeholder: 'Buscar concepto o importe…', 'aria-label': 'Buscar movimiento', oninput: () => { f.q = fQ.value; pintar(); } });
  fQ.value = f.q;
  const fFecha = filtroFecha(f.fecha, (d) => { f.fecha = d; pintar(); }, { etiqueta: 'Fecha del movimiento' });
  vincularCampo(f, 'fecha', fFecha);
  const aviso = crearAviso({
    obtener: () => [['Búsqueda', f.q.trim() ? `«${f.q.trim()}»` : ''], ['Cuenta', f.cuenta ? nombreCuenta(f.cuenta) : ''], ['Estado', f.estado ? ESTADOS.find(([v]) => v === f.estado)?.[1] : ''],
      ['Tipo', f.tipo ? (f.tipo === 'pagos' ? 'Pagos (gastos)' : 'Cobros (ingresos)') : ''], ['Fecha', describirFecha(f.fecha)]],
    limpiar: () => { f.q = ''; fQ.value = ''; f.cuenta = ''; f.estado = ''; f.tipo = ''; f.fecha = { ...FECHA_VACIA }; pintarFiltros(); pintar(); },
  });
  function pintarFiltros() {
    clear(filtrosEl, h('div', { class: 'search' }, fQ),
      h('select', { 'aria-label': 'Cuenta', onchange: (e) => { f.cuenta = e.target.value; pintar(); } }, h('option', { value: '' }, 'Todas las cuentas'), cuentas.map((c) => h('option', { value: c.id, selected: c.id === f.cuenta }, c.nombre))),
      h('select', { 'aria-label': 'Estado', onchange: (e) => { f.estado = e.target.value; pintar(); } }, ESTADOS.map(([v, t]) => h('option', { value: v, selected: v === f.estado }, t))),
      h('select', { 'aria-label': 'Tipo de movimiento', onchange: (e) => { f.tipo = e.target.value; pintar(); } },
        [['pagos', 'Pagos (gastos)'], ['cobros', 'Cobros (ingresos)'], ['', 'Pagos y cobros']].map(([v, t]) => h('option', { value: v, selected: v === f.tipo }, t))),
      fFecha);
  }
  const contador = h('div', { class: 'count' });
  const tbody = h('tbody');
  const pie = h('div', { class: 'table-foot' });
  const resumenGastos = h('div', { class: 'chips' });
  const abonosEl = h('div', {});
  function filtrados() {
    const q = normalizar(f.q.trim());
    return movs.filter((m) => (!f.cuenta || m.cuenta_id === f.cuenta) && (!f.estado || m.estado === f.estado)
      && (!f.tipo || (f.tipo === 'pagos' ? num(m.importe) < 0 : num(m.importe) > 0))
      && (!state.centroId || (m.centro_id || ctx.centroPrincipal()?.id) === state.centroId)
      && pasaFecha(m.fecha, f.fecha)
      && (!q || normalizar(`${m.concepto} ${num(m.importe).toFixed(2).replace('.', ',')} ${m.importe}`).includes(q)))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }
  function pintar() {
    aviso.actualizar();
    pintarRemesas();
    const lista = filtrados();
    const porId = gastoPorId();
    contador.textContent = `${lista.length} movimientos · ${fmtEUR2(lista.reduce((s, m) => s + num(m.importe), 0))}`;
    const sinBanco = todosGastos().filter((g) => !g.check_banca && num(g.cantidad) > 0);
    const abonosPend = todosGastos().filter((g) => esAbono(g) && restanteGasto(g, enlaces) > 0.009).sort((a, b) => (fg(b) || '').localeCompare(fg(a) || ''));
    const devPend = movs.filter((m) => m.estado === 'pendiente' && num(m.importe) > 0 && esDevolucion(m) && restanteMov(m, enlaces) > 0.009);
    clear(resumenGastos, h('span', { class: 'chip' }, `Gastos sin confirmar en el banco: ${sinBanco.length} · ${fmtEUR2(sinBanco.reduce((s, g) => s + num(g.cantidad), 0))}`),
      h('span', { class: 'chip' }, `Pagos del banco sin gasto: ${movs.filter((m) => m.estado === 'pendiente' && num(m.importe) < 0).length}`),
      h('span', { class: 'chip' }, `Abonos sin ingreso en el banco: ${abonosPend.length} · ${fmtEUR2(abonosPend.reduce((s, g) => s + restanteGasto(g, enlaces), 0))}`),
      devPend.length ? h('span', { class: 'chip' }, `Devoluciones del banco sin abono: ${devPend.length}`) : null);
    clear(abonosEl, abonosPend.length ? h('details', { class: 'card abonos-pend' }, h('summary', {}, `Abonos / notas de crédito pendientes de cobrar (${abonosPend.length})`),
      h('ul', { class: 'lista-pares' }, abonosPend.slice(0, 30).map((g) => h('li', {}, `${textoGasto(g)}${asignadoGasto(g, enlaces) > 0.009 ? ` · cobrado ${fmtEUR2(asignadoGasto(g, enlaces))}` : ''} `,
        h('button', { class: 'btn small', onclick: () => buscarIngresoDeAbono(g) }, 'Buscar en ingresos del banco'))))) : null);
    clear(tbody, lista.length ? lista.slice(0, limite).map((m) => {
      const mis = enlaces.filter((e) => e.movimiento_id === m.id);
      const pago = num(m.importe) < 0;
      const misRem = movRem.filter((x) => x.movimiento_id === m.id);
      const parcial = m.estado === 'pendiente' && (mis.length > 0 || misRem.length > 0);
      const acciones = m.estado === 'pendiente'
        ? [misRem.length ? h('button', { class: 'btn small', onclick: () => remesasDeMov(m) }, 'Editar remesas') : null,
          !misRem.length || mis.length ? h('button', { class: 'btn small', onclick: () => vincular(m) }, pago ? (parcial ? 'Editar enlaces' : 'Vincular') : (mis.length ? 'Editar abono' : 'Vincular abono')) : null,
          !misRem.length && (!pago || /devol|impag|rechaz|retroc/.test(normalizar(m.concepto || ''))) ? h('button', { class: 'btn small', onclick: () => remesasDeMov(m) }, pago ? 'Devolución de remesa' : 'Remesas') : null,
          pago && !parcial ? h('button', { class: 'btn small', onclick: () => crearGasto(m) }, 'Crear gasto') : null,
          parcial ? h('button', { class: 'btn small ghost', onclick: () => cambiarEstado(m, 'pendiente') }, 'Quitar enlaces') : h('button', { class: 'btn small ghost', onclick: () => ignorar(m) }, 'Ignorar')]
        : [m.estado === 'conciliado' ? h('button', { class: 'btn small', onclick: () => (misRem.length ? remesasDeMov(m) : vincular(m)) }, 'Editar') : null, h('button', { class: 'btn small ghost', onclick: () => cambiarEstado(m, 'pendiente') }, 'Deshacer')];
      if (m.estado === 'ignorado') acciones.unshift(h('button', { class: 'btn small', onclick: () => editarComentario(m) }, m.notas ? 'Comentario' : 'Añadir comentario'));
      const enlacesTxt = mis.map((e) => { const g = porId.get(e.gasto_id); return g ? `↔ ${g.empresa}${g.factura_nr ? ' ' + g.factura_nr : ''} · ${g.concepto || ''} (${fmtEUR2(num(e.importe))}${Math.abs(num(g.cantidad)) - num(e.importe) > 0.01 ? ` de ${fmtEUR2(Math.abs(num(g.cantidad)))}` : ''})` : null; }).filter(Boolean);
      for (const x of misRem) enlacesTxt.push(`↔ Remesas ${x.mes} ${NOMBRE_BANCO[x.banco]}${x.remesa_nombre ? ' ' + x.remesa_nombre : ''} (${fmtEUR2(num(x.importe))})`);
      const cen = state.centros.length > 1 ? h('select', { class: 'select-celda', 'aria-label': `Centro del movimiento ${m.concepto || ''}`, onchange: (e) => moverCentro(m, e.target.value) },
        h('option', { value: '' }, ctx.tituloCentro(ctx.centroPrincipal()?.nombre)), state.centros.filter((c) => !c.principal).map((c) => h('option', { value: c.id, selected: c.id === m.centro_id }, ctx.tituloCentro(c.nombre)))) : null;
      return h('tr', { class: `mov-${m.estado}` },
        h('td', { class: 'mono' }, fmtFecha(m.fecha)),
        h('td', {}, m.concepto || '—', !pago && esDevolucion(m) ? h('span', { class: 'pill ok' }, 'Devolución') : null, h('span', { class: 'line2' }, [nombreCuenta(m.cuenta_id), ...enlacesTxt].filter(Boolean).join(' · ')), m.estado === 'ignorado' ? h('span', { class: 'line2' }, m.notas ? `📝 ${m.notas}` : 'Sin comentario para la gestoría') : null),
        h('td', { class: `num ${pago ? '' : 'pos'}` }, fmtEUR2(num(m.importe))),
        cen ? h('td', {}, cen) : null,
        h('td', {}, h('span', { class: `pill ${m.estado === 'conciliado' ? 'ok' : m.estado === 'ignorado' ? 'off' : 'warn'}` }, parcial ? `parcial ${fmtEUR2(asignadoMov(m, enlaces) + asigRem(m))} de ${fmtEUR2(Math.abs(num(m.importe)))}` : m.estado)),
        h('td', { class: 'acciones-mov' }, acciones));
    }) : h('tr', {}, h('td', { colspan: 6, class: 'empty' }, movs.length ? 'Ningún movimiento con estos filtros.' : 'Aún no hay extractos importados. Añade la cuenta e importa un CSV o Excel del banco.')));
    clear(pie, h('span', {}, lista.length > limite ? `Mostrando ${limite} de ${lista.length}` : ''), lista.length > limite ? h('button', { class: 'btn', onclick: () => { limite += 300; pintar(); } }, 'Mostrar más') : null);
  }
  function exportar() {
    descargarCSV('movimientos_banco.csv', [['Fecha', 'Cuenta', 'Concepto', 'Importe', 'Estado', 'Gasto vinculado', 'Centro'],
      ...filtrados().map((m) => { const por = gastoPorId(); const vinc = enlaces.filter((e) => e.movimiento_id === m.id).map((e) => { const g = por.get(e.gasto_id); return g ? `${g.empresa} ${g.factura_nr || ''} · ${g.concepto || ''} (${num(e.importe).toFixed(2).replace('.', ',')})` : ''; }).filter(Boolean).join(' + '); return [fmtFecha(m.fecha), nombreCuenta(m.cuenta_id), m.concepto, num(m.importe).toFixed(2).replace('.', ','), m.estado, vinc, nombreCentro(m.centro_id) || ctx.tituloCentro(ctx.centroPrincipal()?.nombre)]; })]);
  }

  clear(cont,
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'Conciliación bancaria'), contador),
      h('div', { class: 'section-actions' }, archivo,
        h('button', { class: 'btn', onclick: exportar }, 'Exportar CSV'),
        h('button', { class: 'btn', onclick: () => archivo.click() }, 'Importar extracto'),
        h('button', { class: 'btn primary', onclick: autoConciliar }, 'Conciliar automáticamente'))),
    cuentasEl, resumenGastos, abonosEl, remesasEl, filtrosEl, aviso,
    h('div', { class: 'table-wrap' }, h('table', { class: 'data tabla-movs' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Fecha'), h('th', { scope: 'col' }, 'Concepto'), h('th', { scope: 'col', class: 'num' }, 'Importe'),
        state.centros.length > 1 ? h('th', { scope: 'col' }, 'Centro') : null, h('th', { scope: 'col' }, 'Estado'), h('th', { scope: 'col' }, ''))),
      tbody)), pie);
  pintarCuentas(); pintarFiltros(); pintar();
}

registrarSeccion('conciliacion', renderConciliacion);
