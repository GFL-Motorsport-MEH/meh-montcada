// Pestaña Control: facturas pendientes (hoja FaltaFACT), conciliación bancaria y FactCheck.
import { h, clear, fmtEUR2, fmtFecha, num, normalizar, cargando, descargarCSV, toast } from '../ui.js';
import * as db from '../db.js';

const SECCIONES = [['faltafact', 'Facturas pendientes'], ['conciliacion', 'Conciliación bancaria'], ['factcheck', 'FactCheck']];
const LS = 'meh.control';
const leerPref = () => { try { return localStorage.getItem(LS) || 'faltafact'; } catch { return 'faltafact'; } };
const guardarPref = (v) => { try { localStorage.setItem(LS, v); } catch { /* sin almacenamiento */ } };
const extras = {}; // otras secciones registradas desde sus módulos
export function registrarSeccion(id, render) { extras[id] = render; }

// Gasto sin factura = sin enlace a la factura y sin marcar "sin factura" (como Mod_FaltaFacturas)
export const faltaFactura = (g) => !String(g.link_factura || '').trim() && !g.sin_factura && num(g.cantidad) !== 0;

async function renderFaltaFact(cont, ctx) {
  clear(cont, cargando());
  const cursos = ctx.state.cursosVisibles;
  const porCurso = new Map();
  for (const c of cursos) porCurso.set(c.id, await ctx.gastos(c.id));
  const todos = cursos.flatMap((c) => porCurso.get(c.id).map((g) => ({ g, curso: c })));
  const f = { curso: '', metodo: '', q: '' };
  const metodos = [...new Set(todos.map((x) => x.g.metodo_pago).filter(Boolean))].sort();
  const fCurso = h('select', { 'aria-label': 'Curso', onchange: () => { f.curso = fCurso.value; pintar(); } },
    h('option', { value: '' }, 'Todos los cursos'), cursos.map((c) => h('option', { value: c.id }, c.nombre)));
  const fMet = h('select', { 'aria-label': 'Método de pago', onchange: () => { f.metodo = fMet.value; pintar(); } },
    h('option', { value: '' }, 'Todos los métodos'), metodos.map((m) => h('option', { value: m }, m)));
  const fQ = h('input', { type: 'search', placeholder: 'Buscar empresa o concepto…', 'aria-label': 'Buscar', oninput: () => { f.q = fQ.value; pintar(); } });
  const resumen = h('div', { class: 'chips' });
  const contador = h('div', { class: 'count' });
  const tbody = h('tbody');

  const pendientes = () => {
    const q = normalizar(f.q.trim());
    return todos.filter(({ g, curso }) => faltaFactura(g) && (!f.curso || curso.id === f.curso) && (!f.metodo || g.metodo_pago === f.metodo)
      && (!q || normalizar(`${g.empresa} ${g.concepto} ${g.factura_nr}`).includes(q)))
      .sort((a, b) => (b.g.fecha_factura || '').localeCompare(a.g.fecha_factura || ''));
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

  function fila(x) {
    const { g, curso } = x;
    const link = h('input', { type: 'text', class: 'input-link', placeholder: 'Pega el enlace o nombre del PDF', 'aria-label': `Enlace factura · ${g.empresa || ''} ${g.concepto || ''}` });
    const tr = h('tr', {},
      h('td', {}, curso.nombre),
      h('td', { class: 'mono' }, fmtFecha(g.fecha_factura)),
      h('td', {}, g.empresa || '—', h('span', { class: 'line2' }, [g.concepto, g.factura_nr ? `nº ${g.factura_nr}` : null].filter(Boolean).join(' · '))),
      h('td', {}, g.metodo_pago || '—'),
      h('td', { class: 'num' }, fmtEUR2(num(g.cantidad))),
      h('td', { class: 'acciones-falta' }, link,
        h('button', { class: 'btn small', onclick: () => { const v = link.value.trim(); if (v) guardar(x, { link_factura: v }, tr); else link.focus(); } }, 'Guardar'),
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
    clear(tbody, lista.length ? lista.slice(0, 300).map(fila) : h('tr', {}, h('td', { colspan: 6, class: 'empty' }, 'No falta ninguna factura con estos filtros.')));
  }
  function exportar() {
    descargarCSV('facturas_pendientes.csv', [['Curso', 'Fecha factura', 'Empresa', 'Concepto', 'Nº factura', 'Método', 'Importe'],
      ...pendientes().map(({ g, curso }) => [curso.nombre, fmtFecha(g.fecha_factura), g.empresa, g.concepto, g.factura_nr, g.metodo_pago, num(g.cantidad).toFixed(2).replace('.', ',')])]);
  }

  clear(cont,
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'Facturas pendientes'), contador),
      h('div', { class: 'section-actions' }, h('button', { class: 'btn', onclick: exportar }, 'Exportar CSV'))),
    h('p', { class: 'muted small' }, 'Gastos de todos los cursos sin enlace a la factura y sin marcar "sin factura" (hoja FaltaFACT). Pega el enlace o marca que no hay factura.'),
    h('div', { class: 'filters filters-3' }, h('div', { class: 'search' }, fQ), fCurso, fMet),
    resumen,
    h('div', { class: 'table-wrap' }, h('table', { class: 'data tabla-falta' },
      h('thead', {}, h('tr', {}, ['Curso', 'Fecha', 'Empresa / concepto', 'Método'].map((t) => h('th', { scope: 'col' }, t)), h('th', { scope: 'col', class: 'num' }, 'Importe'), h('th', { scope: 'col' }, 'Factura'))),
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
    else if (extras[sec]) await extras[sec](cuerpo, ctx);
    else clear(cuerpo, h('div', { class: 'card empty' }, 'Próximamente.'));
  }
  clear(view, h('div', { class: 'section-head no-print' }, seg), cuerpo);
  await pintar();
}
