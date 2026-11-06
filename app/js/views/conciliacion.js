// Control > Conciliación bancaria: cuentas, importar extractos (CSV/Excel), conciliar con los gastos y revisar lo pendiente.
import { h, clear, cargando, toast, confirmar, fmtEUR2, fmtFecha, num, normalizar, leerHojaArchivo, descargarCSV } from '../ui.js';
import * as db from '../db.js';
import { registrarSeccion } from './control.js';
import { parsearExtracto, ponerClaves, cuentaDeArchivo, conciliar, candidatosGasto } from '../banco.js';
import { abrirGastoForm } from './gasto-form.js';
import { formatoIBAN, ibanValido } from './config.js';

const ESTADOS = [['pendiente', 'Pendientes'], ['conciliado', 'Conciliados'], ['ignorado', 'Ignorados'], ['', 'Todos']];

async function renderConciliacion(cont, ctx) {
  clear(cont, cargando());
  const { state } = ctx;
  const admin = ctx.esAdmin();
  const [cuentas, movs] = await Promise.all([db.getCuentas(), state.movimientos ? Promise.resolve(state.movimientos) : db.getMovimientos()]);
  state.movimientos = movs;
  const gastosPorCurso = new Map();
  for (const c of state.cursosVisibles) gastosPorCurso.set(c.id, await ctx.gastos(c.id));
  const todosGastos = () => [...gastosPorCurso.values()].flat();
  const gastoPorId = () => new Map(todosGastos().map((g) => [g.id, g]));
  const nombreCentro = (id) => ctx.tituloCentro(state.centros.find((c) => c.id === id)?.nombre || '');
  const nombreCuenta = (id) => cuentas.find((c) => c.id === id)?.nombre || '—';
  const f = { cuenta: '', estado: 'pendiente', tipo: 'pagos', q: '' };
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
        cen, h('div', { class: 'muted small' }, `${c.banco || 'Banco sin detectar'} · ${ms.length} movimientos${ult ? ` · hasta ${fmtFecha(ult)}` : ''} · ${pend} pagos pendientes`));
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
    const pares = conciliar(todosGastos(), movs);
    if (!pares.length) { toast('No he encontrado nuevas coincidencias entre gastos y movimientos.'); return; }
    const multi = pares.filter((p) => p.movs.length > 1).length;
    const ok = await confirmar({ titulo: 'Conciliar automáticamente', ok: `Conciliar ${pares.length} gastos`,
      texto: h('div', {}, h('p', {}, `He encontrado ${pares.length} gastos con su pago en el banco (mismo importe, ±20 días)${multi ? `; ${multi} de ellos pagados en 2 o 3 movimientos` : ''}.`),
        h('ul', { class: 'lista-pares' }, pares.slice(0, 12).map((p) => h('li', {}, `${fmtFecha(p.gasto.fecha_pago || p.gasto.fecha_factura)} · ${p.gasto.empresa} · ${fmtEUR2(p.gasto.cantidad)} ↔ ${p.movs.map((m) => `${fmtFecha(m.fecha)} ${fmtEUR2(m.importe)}`).join(' + ')}`))),
        pares.length > 12 ? h('p', { class: 'muted small' }, `…y ${pares.length - 12} más.`) : null,
        h('p', { class: 'muted small' }, 'Se marcará "Comprobado en el banco" en esos gastos.')) });
    if (!ok) return;
    try {
      const gastosAct = await db.marcarGastosBanca(pares.map((p) => p.gasto.id), true);
      refrescarGastos(gastosAct);
      for (const p of pares) refrescarMovs(await db.actualizarMovimientos(p.movs.map((m) => m.id), { estado: 'conciliado', gasto_id: p.gasto.id }));
      toast(`${pares.length} gastos conciliados con el banco`);
      pintarCuentas(); pintar();
    } catch (ex) { toast('Error al conciliar: ' + ex.message, 'error'); }
  }

  // ---- acciones por movimiento ----
  async function vincular(m) {
    const cands = candidatosGasto(m, todosGastos());
    const opciones = cands.map((g, i) => h('label', { class: 'check small cand' }, h('input', { type: 'radio', name: 'cand', value: g.id, checked: i === 0 }),
      `${fmtFecha(g.fecha_pago || g.fecha_factura)} · ${g.empresa} · ${g.concepto || ''} · ${fmtEUR2(g.cantidad)}`));
    const ok = await confirmar({ titulo: 'Vincular con un gasto', ok: 'Vincular',
      texto: h('div', {}, h('p', {}, `${fmtFecha(m.fecha)} · ${m.concepto || ''} · ${fmtEUR2(m.importe)}`),
        cands.length ? h('div', { class: 'candidatos' }, opciones) : h('p', { class: 'muted' }, 'No hay gastos pendientes con un importe parecido. Puedes crear el gasto desde el movimiento.')) });
    if (!ok || !cands.length) return;
    const gid = opciones.map((o) => o.querySelector('input')).find((i) => i.checked)?.value;
    if (!gid) return;
    try {
      refrescarGastos(await db.marcarGastosBanca([gid], true));
      refrescarMovs(await db.actualizarMovimientos([m.id], { estado: 'conciliado', gasto_id: gid }));
      toast('Movimiento conciliado'); pintarCuentas(); pintar();
    } catch (ex) { toast(ex.message, 'error'); }
  }
  async function cambiarEstado(m, estado) {
    try {
      if (m.estado === 'conciliado' && m.gasto_id && estado !== 'conciliado') {
        const otros = movs.filter((x) => x.gasto_id === m.gasto_id && x.id !== m.id && x.estado === 'conciliado');
        if (!otros.length) refrescarGastos(await db.marcarGastosBanca([m.gasto_id], false));
      }
      refrescarMovs(await db.actualizarMovimientos([m.id], { estado, gasto_id: estado === 'conciliado' ? m.gasto_id : null }));
      pintarCuentas(); pintar();
    } catch (ex) { toast(ex.message, 'error'); }
  }
  function crearGasto(m) {
    const curso = state.cursos.find((c) => c.fecha_inicio <= m.fecha && m.fecha <= c.fecha_fin) || ctx.cursoActual();
    abrirGastoForm({ ctx, gasto: null, inicial: { curso_id: curso.id, fecha_factura: m.fecha, fecha_pago: m.fecha, cantidad: Math.abs(num(m.importe)), concepto: m.concepto || '', centro_id: m.centro_id || null, check_banca: true },
      onGuardado: async (g) => {
        refrescarGastos([g]);
        try { refrescarMovs(await db.actualizarMovimientos([m.id], { estado: 'conciliado', gasto_id: g.id })); } catch (ex) { toast(ex.message, 'error'); }
        pintarCuentas(); pintar();
      }, onBorrado: () => {} });
  }
  async function moverCentro(m, centro_id) {
    try { refrescarMovs(await db.actualizarMovimientos([m.id], { centro_id: centro_id || null })); toast('Movimiento movido de centro'); } catch (ex) { toast(ex.message, 'error'); }
  }

  // ---- filtros y lista ----
  const filtrosEl = h('div', { class: 'filters filters-conc' });
  const fQ = h('input', { type: 'search', placeholder: 'Buscar concepto o importe…', 'aria-label': 'Buscar movimiento', oninput: () => { f.q = fQ.value; pintar(); } });
  function pintarFiltros() {
    clear(filtrosEl, h('div', { class: 'search' }, fQ),
      h('select', { 'aria-label': 'Cuenta', onchange: (e) => { f.cuenta = e.target.value; pintar(); } }, h('option', { value: '' }, 'Todas las cuentas'), cuentas.map((c) => h('option', { value: c.id, selected: c.id === f.cuenta }, c.nombre))),
      h('select', { 'aria-label': 'Estado', onchange: (e) => { f.estado = e.target.value; pintar(); } }, ESTADOS.map(([v, t]) => h('option', { value: v, selected: v === f.estado }, t))),
      h('select', { 'aria-label': 'Tipo de movimiento', onchange: (e) => { f.tipo = e.target.value; pintar(); } },
        [['pagos', 'Pagos (gastos)'], ['cobros', 'Cobros (ingresos)'], ['', 'Pagos y cobros']].map(([v, t]) => h('option', { value: v, selected: v === f.tipo }, t))));
  }
  const contador = h('div', { class: 'count' });
  const tbody = h('tbody');
  const pie = h('div', { class: 'table-foot' });
  const resumenGastos = h('div', { class: 'chips' });
  function filtrados() {
    const q = normalizar(f.q.trim());
    return movs.filter((m) => (!f.cuenta || m.cuenta_id === f.cuenta) && (!f.estado || m.estado === f.estado)
      && (!f.tipo || (f.tipo === 'pagos' ? num(m.importe) < 0 : num(m.importe) > 0))
      && (!state.centroId || (m.centro_id || ctx.centroPrincipal()?.id) === state.centroId)
      && (!q || normalizar(`${m.concepto} ${num(m.importe).toFixed(2).replace('.', ',')} ${m.importe}`).includes(q)))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }
  function pintar() {
    const lista = filtrados();
    const porId = gastoPorId();
    contador.textContent = `${lista.length} movimientos · ${fmtEUR2(lista.reduce((s, m) => s + num(m.importe), 0))}`;
    const sinBanco = todosGastos().filter((g) => !g.check_banca && num(g.cantidad) > 0);
    clear(resumenGastos, h('span', { class: 'chip' }, `Gastos sin confirmar en el banco: ${sinBanco.length} · ${fmtEUR2(sinBanco.reduce((s, g) => s + num(g.cantidad), 0))}`),
      h('span', { class: 'chip' }, `Pagos del banco sin gasto: ${movs.filter((m) => m.estado === 'pendiente' && num(m.importe) < 0).length}`));
    clear(tbody, lista.length ? lista.slice(0, limite).map((m) => {
      const g = m.gasto_id ? porId.get(m.gasto_id) : null;
      const pago = num(m.importe) < 0;
      const acciones = m.estado === 'pendiente'
        ? [pago ? h('button', { class: 'btn small', onclick: () => vincular(m) }, 'Vincular') : null, pago ? h('button', { class: 'btn small', onclick: () => crearGasto(m) }, 'Crear gasto') : null,
          h('button', { class: 'btn small ghost', onclick: () => cambiarEstado(m, 'ignorado') }, 'Ignorar')]
        : [h('button', { class: 'btn small ghost', onclick: () => cambiarEstado(m, 'pendiente') }, 'Deshacer')];
      const cen = state.centros.length > 1 ? h('select', { class: 'select-celda', 'aria-label': `Centro del movimiento ${m.concepto || ''}`, onchange: (e) => moverCentro(m, e.target.value) },
        h('option', { value: '' }, ctx.tituloCentro(ctx.centroPrincipal()?.nombre)), state.centros.filter((c) => !c.principal).map((c) => h('option', { value: c.id, selected: c.id === m.centro_id }, ctx.tituloCentro(c.nombre)))) : null;
      return h('tr', { class: `mov-${m.estado}` },
        h('td', { class: 'mono' }, fmtFecha(m.fecha)),
        h('td', {}, m.concepto || '—', h('span', { class: 'line2' }, [nombreCuenta(m.cuenta_id), g ? `↔ ${g.empresa} · ${g.concepto || ''}` : null].filter(Boolean).join(' · '))),
        h('td', { class: `num ${pago ? '' : 'pos'}` }, fmtEUR2(num(m.importe))),
        cen ? h('td', {}, cen) : null,
        h('td', {}, h('span', { class: `pill ${m.estado === 'conciliado' ? 'ok' : m.estado === 'ignorado' ? 'off' : 'warn'}` }, m.estado)),
        h('td', { class: 'acciones-mov' }, acciones));
    }) : h('tr', {}, h('td', { colspan: 6, class: 'empty' }, movs.length ? 'Ningún movimiento con estos filtros.' : 'Aún no hay extractos importados. Añade la cuenta e importa un CSV o Excel del banco.')));
    clear(pie, h('span', {}, lista.length > limite ? `Mostrando ${limite} de ${lista.length}` : ''), lista.length > limite ? h('button', { class: 'btn', onclick: () => { limite += 300; pintar(); } }, 'Mostrar más') : null);
  }
  function exportar() {
    descargarCSV('movimientos_banco.csv', [['Fecha', 'Cuenta', 'Concepto', 'Importe', 'Estado', 'Gasto vinculado', 'Centro'],
      ...filtrados().map((m) => { const g = m.gasto_id ? gastoPorId().get(m.gasto_id) : null; return [fmtFecha(m.fecha), nombreCuenta(m.cuenta_id), m.concepto, num(m.importe).toFixed(2).replace('.', ','), m.estado, g ? `${g.empresa} · ${g.concepto || ''}` : '', nombreCentro(m.centro_id) || ctx.tituloCentro(ctx.centroPrincipal()?.nombre)]; })]);
  }

  clear(cont,
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'Conciliación bancaria'), contador),
      h('div', { class: 'section-actions' }, archivo,
        h('button', { class: 'btn', onclick: exportar }, 'Exportar CSV'),
        h('button', { class: 'btn', onclick: () => archivo.click() }, 'Importar extracto'),
        h('button', { class: 'btn primary', onclick: autoConciliar }, 'Conciliar automáticamente'))),
    cuentasEl, resumenGastos, filtrosEl,
    h('div', { class: 'table-wrap' }, h('table', { class: 'data tabla-movs' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Fecha'), h('th', { scope: 'col' }, 'Concepto'), h('th', { scope: 'col', class: 'num' }, 'Importe'),
        state.centros.length > 1 ? h('th', { scope: 'col' }, 'Centro') : null, h('th', { scope: 'col' }, 'Estado'), h('th', { scope: 'col' }, ''))),
      tbody)), pie);
  pintarCuentas(); pintarFiltros(); pintar();
}

registrarSeccion('conciliacion', renderConciliacion);
