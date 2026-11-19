// Pestaña Control: facturas pendientes (hoja FaltaFACT), conciliación bancaria y FactCheck.
import { h, clear, fmtEUR2, fmtFecha, num, normalizar, cargando, descargarCSV, toast } from '../ui.js';
import * as db from '../db.js';
import { agrupar } from '../deshacer.js';
import { botonSubirFactura } from '../factura-archivo.js';

const SECCIONES = [['faltafact', 'Facturas pendientes'], ['gestoria', 'Gestoría'], ['conciliacion', 'Conciliación bancaria'], ['factcheck', 'FactCheck'], ['notas', 'Notas']];
const LS = 'meh.control';
const leerPref = () => { try { return localStorage.getItem(LS) || 'faltafact'; } catch { return 'faltafact'; } };
const guardarPref = (v) => { try { localStorage.setItem(LS, v); } catch { /* sin almacenamiento */ } };
const extras = {}; // otras secciones registradas desde sus módulos
export function registrarSeccion(id, render) { extras[id] = render; }

// Gasto sin factura = sin enlace a la factura y sin marcar "sin factura" (como Mod_FaltaFacturas)
export const faltaFactura = (g) => !String(g.link_factura || '').trim() && !g.sin_factura && num(g.cantidad) !== 0;

const CLAVES = {
  curso: (x) => x.curso.nombre || '',
  fecha: (x) => x.g.fecha_factura || '',
  empresa: (x) => `${x.g.empresa || ''} ${x.g.concepto || ''}`.trim(),
  metodo: (x) => x.g.metodo_pago || '',
  importe: (x) => num(x.g.cantidad),
};

async function renderFaltaFact(cont, ctx) {
  clear(cont, cargando());
  const cursos = ctx.state.cursosVisibles;
  const porCurso = new Map();
  for (const c of cursos) porCurso.set(c.id, await ctx.gastos(c.id));
  const todos = cursos.flatMap((c) => porCurso.get(c.id).map((g) => ({ g, curso: c })));
  const f = { curso: '', metodo: '', q: '' };
  let orden = { campo: 'fecha', asc: false };
  const sel = new Set(); // ids de gastos seleccionados
  const metodos = [...new Set(todos.map((x) => x.g.metodo_pago).filter(Boolean))].sort();
  const fCurso = h('select', { 'aria-label': 'Curso', onchange: () => { f.curso = fCurso.value; pintar(); } },
    h('option', { value: '' }, 'Todos los cursos'), cursos.map((c) => h('option', { value: c.id }, c.nombre)));
  const fMet = h('select', { 'aria-label': 'Método de pago', onchange: () => { f.metodo = fMet.value; pintar(); } },
    h('option', { value: '' }, 'Todos los métodos'), metodos.map((m) => h('option', { value: m }, m)));
  const fQ = h('input', { type: 'search', placeholder: 'Buscar empresa o concepto…', 'aria-label': 'Buscar', oninput: () => { f.q = fQ.value; pintar(); } });
  const resumen = h('div', { class: 'chips' });
  const contador = h('div', { class: 'count' });
  const tbody = h('tbody');
  const btnMasivo = h('button', { class: 'btn', hidden: true, onclick: marcarSeleccion });
  const chkTodos = h('input', { type: 'checkbox', 'aria-label': 'Seleccionar todos los visibles', onclick: () => {
    const visibles = pendientes().slice(0, 300);
    if (chkTodos.checked) visibles.forEach((x) => sel.add(x.g.id)); else visibles.forEach((x) => sel.delete(x.g.id));
    pintar();
  } });
  const COLS = [['curso', 'Curso', ''], ['fecha', 'Fecha', ''], ['empresa', 'Empresa / concepto', ''], ['metodo', 'Método', ''], ['importe', 'Importe', 'num']];
  const ths = [...COLS.map(([campo, label, cls]) => {
    const flecha = h('span', { 'aria-hidden': 'true', class: 'flecha' });
    const t = h('th', { scope: 'col', class: `sortable ${cls}`.trim(), title: 'Clic para ordenar', tabindex: '0', 'aria-sort': 'none' }, label, flecha);
    t.addEventListener('click', () => { orden = { campo, asc: orden.campo === campo ? !orden.asc : !['fecha', 'importe'].includes(campo) }; pintar(); });
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t.click(); } });
    t._campo = campo; t._flecha = flecha;
    return t;
  }), h('th', { scope: 'col' }, 'Factura')];

  const pendientes = () => {
    const q = normalizar(f.q.trim());
    return todos.filter(({ g, curso }) => faltaFactura(g) && (!f.curso || curso.id === f.curso) && (!f.metodo || g.metodo_pago === f.metodo)
      && (!q || normalizar(`${g.empresa} ${g.concepto} ${g.factura_nr}`).includes(q)))
      .sort((a, b) => {
        const k = CLAVES[orden.campo];
        const va = k(a), vb = k(b);
        const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' });
        return (orden.asc ? c : -c) || (b.g.fecha_factura || '').localeCompare(a.g.fecha_factura || '');
      });
  };

  async function guardar(x, cambios, tr) {
    tr.classList.add('saving');
    try {
      const nuevo = await db.actualizarGasto(x.g.id, cambios);
      const lista = porCurso.get(x.curso.id);
      const i = lista.findIndex((g) => g.id === x.g.id);
      lista[i] = nuevo; x.g = nuevo; ctx.setGastos(x.curso.id, lista);
      toast(cambios.sin_factura ? 'Marcado como sin factura' : 'Enlace a la factura guardado');
      pintar();
    } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); tr.classList.remove('saving'); }
  }

  // marca varios gastos como "sin factura" de una vez (un solo paso de deshacer)
  async function marcarSeleccion() {
    const elegidos = pendientes().filter((x) => sel.has(x.g.id));
    if (!elegidos.length) return;
    if (!confirm(`¿Marcar ${elegidos.length} gastos como "sin factura"?`)) return;
    btnMasivo.disabled = true;
    let ok = 0;
    try {
      await agrupar(`${elegidos.length} gastos marcados sin factura`, async () => {
        for (const x of elegidos) {
          const nuevo = await db.actualizarGasto(x.g.id, { sin_factura: true });
          const lista = porCurso.get(x.curso.id);
          const i = lista.findIndex((g) => g.id === x.g.id);
          lista[i] = nuevo; x.g = nuevo; ctx.setGastos(x.curso.id, lista);
          sel.delete(x.g.id); ok++;
        }
      });
      toast(`${ok} gastos marcados como sin factura`);
    } catch (ex) { toast(`Se han marcado ${ok} de ${elegidos.length}. Error: ${ex.message}`, 'error'); }
    pintar();
  }

  function fila(x) {
    const { g, curso } = x;
    const link = h('input', { type: 'text', class: 'input-link', placeholder: 'Pega el enlace o nombre del PDF', 'aria-label': `Enlace factura · ${g.empresa || ''} ${g.concepto || ''}` });
    const chk = h('input', { type: 'checkbox', 'aria-label': `Seleccionar · ${g.empresa || ''} ${g.concepto || ''}`, checked: sel.has(g.id),
      onclick: (e) => { e.stopPropagation(); if (chk.checked) sel.add(g.id); else sel.delete(g.id); actualizarSeleccion(); } });
    chk.checked = sel.has(g.id);
    const tr = h('tr', {},
      h('td', { class: 'c-chk' }, chk),
      h('td', {}, curso.nombre),
      h('td', { class: 'mono' }, fmtFecha(g.fecha_factura)),
      h('td', {}, g.empresa || '—', h('span', { class: 'line2' }, [g.concepto, g.factura_nr ? `nº ${g.factura_nr}` : null].filter(Boolean).join(' · '))),
      h('td', {}, g.metodo_pago || '—'),
      h('td', { class: 'num' }, fmtEUR2(num(g.cantidad))),
      h('td', { class: 'acciones-falta' }, link,
        h('button', { class: 'btn small', onclick: () => { const v = link.value.trim(); if (v) guardar(x, { link_factura: v }, tr); else link.focus(); } }, 'Guardar'),
        botonSubirFactura({ carpeta: () => curso.nombre, onSubido: (l) => guardar(x, { link_factura: l }, tr) }),
        h('button', { class: 'btn small', onclick: () => guardar(x, { sin_factura: true }, tr) }, 'Sin factura')));
    link.addEventListener('keydown', (e) => { if (e.key === 'Enter' && link.value.trim()) guardar(x, { link_factura: link.value.trim() }, tr); });
    return tr;
  }

  function pintar() {
    const lista = pendientes();
    const total = lista.reduce((s, x) => s + num(x.g.cantidad), 0);
    contador.textContent = `${lista.length} gastos sin factura · ${fmtEUR2(total)}`;
    const porMet = new Map();
    for (const x of lista) porMet.set(x.g.metodo_pago || 'Sin método', (porMet.get(x.g.metodo_pago || 'Sin método') || 0) + num(x.g.cantidad));
    clear(resumen, [...porMet.entries()].sort((a, b) => b[1] - a[1]).map(([m, v]) => h('span', { class: 'chip' }, `${m}: ${fmtEUR2(v)}`)));
    const visibles = new Set(lista.map((x) => x.g.id));
    for (const id of [...sel]) if (!visibles.has(id)) sel.delete(id); // la selección solo vale para lo que se ve
    for (const t of ths) {
      const activo = t._campo === orden.campo;
      t.setAttribute('aria-sort', activo ? (orden.asc ? 'ascending' : 'descending') : 'none');
      t._flecha.textContent = activo ? (orden.asc ? ' ▲' : ' ▼') : '';
    }
    clear(tbody, lista.length ? lista.slice(0, 300).map(fila) : h('tr', {}, h('td', { colspan: 7, class: 'empty' }, 'No falta ninguna factura con estos filtros.')));
    actualizarSeleccion();
  }
  function actualizarSeleccion() {
    const visibles = pendientes().slice(0, 300);
    const n = sel.size;
    btnMasivo.hidden = n === 0;
    btnMasivo.disabled = false;
    btnMasivo.textContent = `Marcar ${n} como sin factura`;
    chkTodos.checked = n > 0 && visibles.length > 0 && visibles.every((x) => sel.has(x.g.id));
    chkTodos.indeterminate = n > 0 && !chkTodos.checked;
  }
  function exportar() {
    descargarCSV('facturas_pendientes.csv', [['Curso', 'Fecha factura', 'Empresa', 'Concepto', 'Nº factura', 'Método', 'Importe'],
      ...pendientes().map(({ g, curso }) => [curso.nombre, fmtFecha(g.fecha_factura), g.empresa, g.concepto, g.factura_nr, g.metodo_pago, num(g.cantidad).toFixed(2).replace('.', ',')])]);
  }

  clear(cont,
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'Facturas pendientes'), contador),
      h('div', { class: 'section-actions' }, btnMasivo, h('button', { class: 'btn', onclick: exportar }, 'Exportar CSV'))),
    h('p', { class: 'muted small' }, 'Gastos de todos los cursos sin enlace a la factura y sin marcar "sin factura" (hoja FaltaFACT). Pega el enlace o marca que no hay factura.'),
    h('div', { class: 'filters filters-3' }, h('div', { class: 'search' }, fQ), fCurso, fMet),
    resumen,
    h('div', { class: 'table-wrap' }, h('table', { class: 'data tabla-falta' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'c-chk' }, chkTodos), ths)),
      tbody)));
  pintar();
}

export async function renderControl(view, ctx) {
  let sec = leerPref();
  if (!SECCIONES.some(([id]) => id === sec)) sec = 'faltafact';
  const seg = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Sección de control' });
  const cuerpo = h('div', { class: 'control-cuerpo' });
  async function pintar() {
    clear(seg, SECCIONES.map(([id, label]) => h('button', { class: 'seg-btn', role: 'tab', 'aria-selected': String(id === sec), onclick: () => { sec = id; guardarPref(id); pintar(); } }, label)));
    if (sec === 'faltafact') await renderFaltaFact(cuerpo, ctx);
    else if (extras[sec]) {
      try { await extras[sec](cuerpo, ctx); } catch (ex) { console.error(ex); clear(cuerpo, h('div', { class: 'banner error', role: 'alert' }, 'No se ha podido cargar esta sección: ', ex.message)); }
    }
    else clear(cuerpo, h('div', { class: 'card empty' }, 'Próximamente.'));
  }
  clear(view, h('div', { class: 'section-head no-print' }, seg), cuerpo);
  await pintar();
}
