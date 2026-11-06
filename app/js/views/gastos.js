import { h, clear, fmtEUR2, fmtFecha, num, MESES, capitalizar, tituloCategoria, normalizar, cargando, descargarCSV, mesDeFecha } from '../ui.js';
import { abrirGastoForm } from './gasto-form.js';
import { moverGastosACentro } from '../db.js';
import { generarGastosDelMes } from './plantillas.js';
import { toast } from '../ui.js';

const POR_PAGINA = 100;

export async function renderGastos(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const taxonomia = ctx.state.taxonomia;
  const catPorId = new Map(taxonomia.map((c) => [c.id, c]));
  const subPorId = new Map(taxonomia.flatMap((c) => c.subcategorias.map((s) => [s.id, s])));
  let gastos = await ctx.gastos(curso.id);
  ctx.cargarSugerencias(); // en segundo plano, para el formulario

  const f = { q: '', cat: '', sub: '', mes: '', estado: '' };
  let orden = { campo: 'fecha_factura', asc: false };
  let limite = POR_PAGINA;
  const varios = ctx.state.centros.length > 1;
  const nombreCentro = new Map(ctx.state.centros.map((c) => [c.id, ctx.tituloCentro(c.nombre)]));
  const seleccion = new Set();
  const barra = h('div', { class: 'barra-seleccion', hidden: true });
  const chkTodos = h('input', { type: 'checkbox', 'aria-label': 'Seleccionar todos los gastos filtrados', onchange: () => {
    const lista = filtrados();
    if (chkTodos.checked) lista.forEach((g) => seleccion.add(g.id)); else seleccion.clear();
    pintar();
  } });
  function pintarBarra() {
    barra.hidden = !seleccion.size;
    if (!seleccion.size) return;
    const destino = h('select', { 'aria-label': 'Centro de destino' }, ctx.state.centros.filter((c) => c.activo !== false).map((c) => h('option', { value: c.id }, ctx.tituloCentro(c.nombre))));
    const total = gastos.filter((g) => seleccion.has(g.id)).reduce((s, g) => s + num(g.cantidad), 0);
    clear(barra, h('strong', {}, `${seleccion.size} seleccionados`), h('span', { class: 'muted' }, ` · ${fmtEUR2(total)}`),
      varios ? h('span', { class: 'barra-accion' }, 'Mover a', destino, h('button', { class: 'btn small primary', onclick: async () => {
        try {
          const nuevos = await moverGastosACentro([...seleccion], destino.value);
          const porId = new Map(nuevos.map((x) => [x.id, x]));
          gastos = gastos.map((g) => porId.get(g.id) || g); ctx.setGastos(curso.id, gastos);
          toast(`${nuevos.length} gastos movidos a ${ctx.tituloCentro(nombreCentro.get(destino.value))}`);
          seleccion.clear(); pintar();
        } catch (ex) { toast('No se han movido: ' + ex.message, 'error'); }
      } }, 'Mover')) : null,
      h('button', { class: 'btn small', onclick: () => { seleccion.clear(); pintar(); } }, 'Quitar selección'));
  }

  // ---------- filtros ----------
  const fQ = h('input', { type: 'search', placeholder: 'Buscar empresa, concepto, nº factura…', 'aria-label': 'Buscar', oninput: () => { f.q = fQ.value; limite = POR_PAGINA; pintar(); } });
  const fCat = h('select', { 'aria-label': 'Categoría', onchange: () => { f.cat = fCat.value; f.sub = ''; pintarSubs(); limite = POR_PAGINA; pintar(); } },
    h('option', { value: '' }, 'Todas las categorías'),
    taxonomia.map((c) => h('option', { value: c.id }, tituloCategoria(c.nombre))));
  const fSub = h('select', { 'aria-label': 'Subcategoría', onchange: () => { f.sub = fSub.value; limite = POR_PAGINA; pintar(); } });
  function pintarSubs() {
    const cat = catPorId.get(f.cat);
    fSub.replaceChildren(h('option', { value: '' }, 'Todas las subcategorías'), ...(cat ? cat.subcategorias.map((s) => h('option', { value: s.id }, s.nombre)) : []));
    fSub.disabled = !cat;
  }
  pintarSubs();
  const fMes = h('select', { 'aria-label': 'Mes', onchange: () => { f.mes = fMes.value; limite = POR_PAGINA; pintar(); } },
    h('option', { value: '' }, 'Todos los meses'), MESES.map((m) => h('option', { value: m }, capitalizar(m))));
  const fEstado = h('select', { 'aria-label': 'Estado', onchange: () => { f.estado = fEstado.value; limite = POR_PAGINA; pintar(); } },
    h('option', { value: '' }, 'Cualquier estado'),
    h('option', { value: 'sin_banca' }, 'Sin comprobar en banco'),
    h('option', { value: 'sin_factura' }, 'Marcados sin factura'),
    h('option', { value: 'sin_link' }, 'Sin enlace a factura'));

  const titulo = h('div', { class: 'count' });
  const tbody = h('tbody');
  const pie = h('div', { class: 'table-foot' });
  const thOrden = (label, campo, cls = '') => {
    const flecha = h('span', { 'aria-hidden': 'true' });
    const th = h('th', { class: 'sortable ' + cls, scope: 'col', tabindex: '0', 'aria-sort': 'none' }, label, flecha);
    th.addEventListener('click', () => { orden = { campo, asc: orden.campo === campo ? !orden.asc : campo === 'empresa' }; pintar(); });
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); } });
    th._campo = campo; th._flecha = flecha;
    return th;
  };
  const ths = [h('th', { scope: 'col', class: 'col-check' }, chkTodos), thOrden('Fecha', 'fecha_factura'), h('th', { scope: 'col' }, 'Mes'), thOrden('Empresa / concepto', 'empresa'),
    h('th', { scope: 'col' }, 'Categoría'), h('th', { scope: 'col' }, 'Método'), thOrden('Importe', 'cantidad', 'num'), h('th', { scope: 'col' }, 'Control')];

  function filtrados() {
    const q = normalizar(f.q.trim());
    const enCentro = new Set(ctx.filtrarCentro(gastos));
    return gastos.filter((g) => {
      if (!enCentro.has(g)) return false;
      if (f.cat && g.categoria_id !== f.cat) return false;
      if (f.sub && g.subcategoria_id !== f.sub) return false;
      if (f.mes && (g.mes || mesDeFecha(g.fecha_pago || g.fecha_factura)) !== f.mes) return false;
      if (f.estado === 'sin_banca' && g.check_banca) return false;
      if (f.estado === 'sin_factura' && !g.sin_factura) return false;
      if (f.estado === 'sin_link' && (g.link_factura || g.sin_factura)) return false;
      if (q && !normalizar(`${g.empresa} ${g.concepto} ${g.factura_nr} ${g.comentarios} ${g.cantidad}`).includes(q)) return false;
      return true;
    }).sort((a, b) => {
      const { campo, asc } = orden;
      let va = a[campo], vb = b[campo];
      if (campo === 'cantidad') { va = num(va); vb = num(vb); } else { va = (va || '').toString().toLowerCase(); vb = (vb || '').toString().toLowerCase(); }
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return asc ? c : -c;
    });
  }

  function fila(g) {
    const cat = catPorId.get(g.categoria_id); const sub = subPorId.get(g.subcategoria_id);
    const control = [];
    control.push(g.check_banca ? h('span', { class: 'pill ok', title: 'Comprobado en el banco' }, '✓ banco') : h('span', { class: 'pill warn', title: 'Sin comprobar en el banco' }, 'banco'));
    if (g.sin_factura) control.push(' ', h('span', { class: 'pill off' }, 'sin factura'));
    else if (g.link_factura) {
      const url = /^https?:\/\//i.test(g.link_factura) ? g.link_factura : null;
      control.push(' ', url
        ? h('a', { class: 'pill ok', href: url, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation(), title: 'Abrir factura' }, 'factura ↗')
        : h('span', { class: 'pill ok', title: g.link_factura }, 'factura'));
    } else control.push(' ', h('span', { class: 'pill warn', title: 'Sin enlace a la factura' }, 'sin enlace'));
    const chk = h('input', { type: 'checkbox', checked: seleccion.has(g.id), 'aria-label': `Seleccionar ${g.empresa || ''} ${g.concepto || ''}`,
      onclick: (e) => e.stopPropagation(), onchange: () => { if (chk.checked) seleccion.add(g.id); else seleccion.delete(g.id); pintarBarra(); } });
    const tr = h('tr', { class: 'clickable', tabindex: '0', onclick: () => editar(g), onkeydown: (e) => { if (e.key === 'Enter' && e.target === tr) editar(g); } },
      h('td', { class: 'col-check' }, chk),
      h('td', { class: 'mono' }, fmtFecha(g.fecha_factura), varios && !ctx.state.centroId ? h('span', { class: 'line2' }, nombreCentro.get(g.centro_id) || '') : null),
      h('td', {}, capitalizar(g.mes || '')),
      h('td', {}, g.empresa || '—', h('span', { class: 'line2' }, [g.concepto, g.factura_nr ? `nº ${g.factura_nr}` : null].filter(Boolean).join(' · '))),
      h('td', {}, cat ? h('span', { class: 'badge' }, tituloCategoria(cat.nombre)) : h('span', { class: 'muted' }, g.categoria_texto || '—'),
        h('span', { class: 'line2' }, sub ? sub.nombre : (g.subcategoria_texto || ''))),
      h('td', {}, g.metodo_pago || '—'),
      h('td', { class: 'num' }, fmtEUR2(num(g.cantidad))),
      h('td', {}, control));
    return tr;
  }

  function pintar() {
    const lista = filtrados();
    const total = lista.reduce((s, g) => s + num(g.cantidad), 0);
    titulo.textContent = `${lista.length} de ${gastos.length} gastos · total ${fmtEUR2(total)}`;
    for (const th of ths) if (th._campo) {
      const activo = th._campo === orden.campo;
      th.setAttribute('aria-sort', activo ? (orden.asc ? 'ascending' : 'descending') : 'none');
      th._flecha.textContent = activo ? (orden.asc ? ' ▲' : ' ▼') : '';
    }
    if (!lista.length) {
      clear(tbody, h('tr', {}, h('td', { colspan: '8', class: 'empty' }, gastos.length ? 'Ningún gasto coincide con los filtros.' : `Todavía no hay gastos en ${curso.nombre}.`)));
    } else clear(tbody, lista.slice(0, limite).map(fila));
    chkTodos.checked = lista.length > 0 && lista.every((g) => seleccion.has(g.id));
    pintarBarra();
    clear(pie,
      h('span', {}, lista.length > limite ? `Mostrando ${limite} de ${lista.length}` : `${lista.length} gastos`),
      lista.length > limite ? h('button', { class: 'btn', onclick: () => { limite += POR_PAGINA * 3; pintar(); } }, 'Mostrar más') : null);
  }

  function editar(g) {
    abrirGastoForm({
      gasto: g, ctx,
      onGuardado: (nuevo) => { reemplazar(g, nuevo); },
      onBorrado: () => { gastos = gastos.filter((x) => x.id !== g.id); ctx.setGastos(curso.id, gastos); pintar(); },
      onDividido: (actualizado, creados) => { gastos = gastos.map((x) => (x.id === g.id ? actualizado : x)); gastos.unshift(...creados); ctx.setGastos(curso.id, gastos); pintar(); },
    });
  }
  function reemplazar(viejo, nuevo) {
    gastos = gastos.filter((x) => x.id !== (viejo && viejo.id));
    if (nuevo.curso_id === curso.id) gastos.unshift(nuevo);
    else ctx.invalidar(nuevo.curso_id);
    ctx.setGastos(curso.id, gastos);
    pintar();
  }
  function nuevoGasto() {
    abrirGastoForm({ gasto: null, ctx, onGuardado: (nuevo) => reemplazar(null, nuevo), onBorrado: () => {} });
  }
  function exportar() {
    const cols = ['fecha_factura', 'mes', 'tipo', 'empresa', 'factura_nr', 'concepto', 'fecha_pago', 'cantidad', 'categoria', 'subcategoria', 'periodicidad', 'metodo_pago', 'pago', 'check_banca', 'sin_factura', 'fiscontal', 'link_factura', 'nif', 'iban', 'swift', 'comentarios'];
    const filas = filtrados().map((g) => cols.map((c) => {
      if (c === 'categoria') return tituloCategoria(catPorId.get(g.categoria_id)?.nombre || g.categoria_texto || '');
      if (c === 'subcategoria') return subPorId.get(g.subcategoria_id)?.nombre || g.subcategoria_texto || '';
      if (c === 'cantidad') return num(g.cantidad).toFixed(2).replace('.', ',');
      if (c.startsWith('fecha')) return g[c] ? fmtFecha(g[c]) : '';
      if (typeof g[c] === 'boolean') return g[c] ? 'Sí' : 'No';
      return g[c] ?? '';
    }));
    descargarCSV(`gastos_${curso.nombre}.csv`, [cols, ...filas]);
  }

  clear(view,
    h('div', { class: 'banner' }, h('span', {}, h('strong', {}, 'Fase de pruebas: '), 'el Excel sigue siendo la referencia. Lo que añadas o cambies aquí no se copia al Excel.')),
    h('div', { class: 'section-head' },
      h('div', {}, h('h2', {}, `Gastos · ${curso.nombre}`), titulo),
      h('div', { class: 'section-actions' },
        h('button', { class: 'btn', onclick: exportar }, 'Exportar CSV'),
        h('button', { class: 'btn', onclick: () => generarGastosDelMes(ctx, { curso, gastos, onCreados: (creados) => { gastos.unshift(...creados); ctx.setGastos(curso.id, gastos); pintar(); } }) }, 'Generar gastos del mes'),
        h('button', { class: 'btn primary', onclick: nuevoGasto }, '+ Nuevo gasto'))),
    h('div', { class: 'filters' }, h('div', { class: 'search' }, fQ), fCat, fSub, fMes, fEstado),
    barra,
    h('div', { class: 'table-wrap' }, h('table', { class: 'data tabla-gastos' }, h('thead', {}, h('tr', {}, ths)), tbody)),
    pie);
  pintar();
}
