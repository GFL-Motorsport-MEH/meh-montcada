// Pestaña Gastos: tabla tipo hoja de cálculo, una línea por gasto y editable en la propia fila
// (desplegables para las listas, casillas para Pago / Banco / Gestoría). La ficha completa sigue en el botón ⋯.
import { h, clear, fmtEUR2, fmtFecha, fmtFechaCorta, num, MESES, MESES_CORTO, capitalizar, tituloCategoria, normalizar, cargando, descargarCSV, mesDeFecha, hoyISO, toast, confirmar } from '../ui.js';
import { abrirGastoForm } from './gasto-form.js';
import { moverGastosACentro, actualizarGasto, getListas } from '../db.js';
import { generarGastosDelMes } from './plantillas.js';
import { abrirFactura, esArchivoSubido, botonSubirFactura } from '../factura-archivo.js';
import { abrirEscaner } from './escaner.js';

const POR_PAGINA = 100;
const esVerdad = (v) => /^(true|1|x|verdadero|s[ií])$/i.test(String(v ?? '').trim());

// iconos en línea (sin dependencias)
const svg = (d, t) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 16 16'); el.setAttribute('width', '14'); el.setAttribute('height', '14'); el.setAttribute('aria-hidden', 'true'); el.classList.add('ico');
  el.innerHTML = d; // trazos fijos, no datos
  if (t) el.dataset.t = t;
  return el;
};
const ICO = {
  doc: '<path d="M4 1.5h5l3 3v10H4z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M9 1.5v3h3M6 8h4M6 10.5h4" stroke="currentColor" stroke-width="1.1" fill="none"/>',
  subir: '<path d="M8 11V3M5 6l3-3 3 3M3 13h10" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  coment: '<path d="M2 3h12v8H7l-3 2.5V11H2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  comentLleno: '<path d="M2 3h12v8H7l-3 2.5V11H2z" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  mas: '<circle cx="3.5" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="12.5" cy="8" r="1.3" fill="currentColor"/>',
};

// "15/3/26", "15/03/2026", "15-3-2026" o "2026-03-15" -> ISO
export function parsearFecha(txt) {
  const s = String(txt || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y, mo, d;
  if (m) [, y, mo, d] = m.map(Number);
  else {
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
    if (!m) return null;
    [, d, mo, y] = m.map(Number);
    if (y < 100) y += 2000;
  }
  const f = new Date(Date.UTC(y, mo - 1, d));
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== mo - 1 || f.getUTCDate() !== d) return null;
  return f.toISOString().slice(0, 10);
}

export async function renderGastos(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const { state } = ctx;
  const taxonomia = state.taxonomia;
  const catPorId = new Map(taxonomia.map((c) => [c.id, c]));
  const subPorId = new Map(taxonomia.flatMap((c) => c.subcategorias.map((s) => [s.id, s])));
  let gastos = await ctx.gastos(curso.id);
  if (!state.listas) { try { state.listas = await getListas(); } catch { state.listas = []; } }
  ctx.cargarSugerencias(); // empresas y valores más usados, en segundo plano

  const f = { q: '', cat: '', sub: '', mes: '', estado: '' };
  let orden = { campo: 'fecha_factura', asc: false };
  let limite = POR_PAGINA;
  const varios = state.centros.length > 1;
  const conCentro = varios && !state.centroId;
  const nombreCentro = new Map(state.centros.map((c) => [c.id, ctx.tituloCentro(c.nombre)]));
  const y0 = Number((curso.fecha_inicio || curso.nombre).slice(0, 4));
  const etiquetaContable = (mes) => { const i = MESES.indexOf(mes); return i < 0 ? '—' : `${MESES_CORTO[i]} ${String(i <= 3 ? y0 : y0 + 1).slice(2)}`; };
  const valoresLista = (lista, campo) => {
    const v = (state.listas || []).filter((x) => x.lista === lista).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)).map((x) => x.valor);
    const usados = gastos.map((g) => g[campo]).filter(Boolean);
    return [...new Set([...v, ...usados])];
  };
  const LISTAS = { tipo: valoresLista('tipo', 'tipo'), periodicidad: valoresLista('periodicidad', 'periodicidad'), metodo_pago: valoresLista('metodo_pago', 'metodo_pago') };

  // ---------- selección y acciones en bloque ----------
  const seleccion = new Set();
  const barra = h('div', { class: 'barra-seleccion', hidden: true });
  const chkTodos = h('input', { type: 'checkbox', 'aria-label': 'Seleccionar todos los gastos filtrados', onchange: () => {
    const lista = filtrados();
    if (chkTodos.checked) lista.forEach((g) => seleccion.add(g.id)); else seleccion.clear();
    pintar();
  } });
  async function enBloque(cambiosDe, texto) {
    const ids = [...seleccion];
    let n = 0;
    try {
      for (const id of ids) {
        const g = gastos.find((x) => x.id === id);
        const cambios = cambiosDe(g);
        if (!cambios) continue;
        Object.assign(g, await actualizarGasto(id, cambios)); n++;
      }
      toast(`${n} gastos ${texto}`);
      seleccion.clear(); pintar();
    } catch (ex) { toast(`No se han guardado todos (${n} de ${ids.length}): ${ex.message}`, 'error'); pintar(); }
  }
  function pintarBarra() {
    barra.hidden = !seleccion.size;
    if (!seleccion.size) return;
    const destino = h('select', { 'aria-label': 'Centro de destino' }, state.centros.filter((c) => c.activo !== false).map((c) => h('option', { value: c.id }, ctx.tituloCentro(c.nombre))));
    const total = gastos.filter((g) => seleccion.has(g.id)).reduce((s, g) => s + num(g.cantidad), 0);
    clear(barra, h('strong', {}, `${seleccion.size} seleccionados`), h('span', { class: 'muted' }, ` · ${fmtEUR2(total)}`),
      h('button', { class: 'btn small', onclick: () => enBloque((g) => (esVerdad(g.fiscontal) ? null : { fiscontal: 'True', fiscontal_fecha: hoyISO() }), 'marcados como enviados a la gestoría') }, 'Enviados a gestoría'),
      h('button', { class: 'btn small', onclick: () => enBloque((g) => (esVerdad(g.pago) ? null : { pago: 'True' }), 'marcados como pagados') }, 'Marcar pagados'),
      varios ? h('span', { class: 'barra-accion' }, 'Mover a', destino, h('button', { class: 'btn small primary', onclick: async () => {
        try {
          const nuevos = await moverGastosACentro([...seleccion], destino.value);
          const porId = new Map(nuevos.map((x) => [x.id, x]));
          gastos = gastos.map((g) => porId.get(g.id) || g); ctx.setGastos(curso.id, gastos);
          toast(`${nuevos.length} gastos movidos a ${ctx.tituloCentro(nombreCentro.get(destino.value))}`);
          seleccion.clear(); pintar();
        } catch (ex) { toast('No se han movido: ' + ex.message, 'error'); }
      } }, 'Mover')) : null,
      h('button', { class: 'btn small ghost', onclick: () => { seleccion.clear(); pintar(); } }, 'Quitar selección'));
  }

  // ---------- filtros ----------
  const fQ = h('input', { type: 'search', placeholder: 'Buscar empresa, concepto, nº factura, comentario…', 'aria-label': 'Buscar', oninput: () => { f.q = fQ.value; limite = POR_PAGINA; pintar(); } });
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
    h('option', { value: '' }, 'Todos los meses'), MESES.map((m) => h('option', { value: m }, `${capitalizar(m)} (${etiquetaContable(m)})`)));
  const fEstado = h('select', { 'aria-label': 'Estado', onchange: () => { f.estado = fEstado.value; limite = POR_PAGINA; pintar(); } },
    h('option', { value: '' }, 'Cualquier estado'),
    h('option', { value: 'sin_pago' }, 'Pendientes de pago'),
    h('option', { value: 'sin_banca' }, 'Sin comprobar en banco'),
    h('option', { value: 'sin_gestoria' }, 'Sin enviar a gestoría'),
    h('option', { value: 'sin_link' }, 'Sin factura adjunta'),
    h('option', { value: 'sin_factura' }, 'Marcados sin factura'),
    h('option', { value: 'comentarios' }, 'Con comentarios'));

  const titulo = h('div', { class: 'count' });
  const tbody = h('tbody');
  const pie = h('div', { class: 'table-foot' });
  const thOrden = (label, campo, cls = '', title) => {
    const flecha = h('span', { 'aria-hidden': 'true' });
    const th = h('th', { class: 'sortable ' + cls, scope: 'col', tabindex: '0', 'aria-sort': 'none', title }, label, flecha);
    th.addEventListener('click', () => { orden = { campo, asc: orden.campo === campo ? !orden.asc : ['empresa', 'concepto'].includes(campo) }; pintar(); });
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); } });
    th._campo = campo; th._flecha = flecha;
    return th;
  };
  const th = (label, cls = '', title) => h('th', { scope: 'col', class: cls, title }, label);
  // columnas: [clase de <col>, cabecera]
  const COLS = [
    ['c-sel', h('th', { scope: 'col', class: 'col-check' }, chkTodos)],
    ['c-fecha', thOrden('F. fact.', 'fecha_factura', '', 'Fecha de la factura')],
    ['c-cont', thOrden('Contab.', 'mes', '', 'Fecha contable: mes y año en que se contabiliza')],
    conCentro ? ['c-centro', th('Centro')] : null,
    ['c-tipo', th('Tipo')],
    ['c-emp', thOrden('Empresa', 'empresa')],
    ['c-nfac', th('Nº factura')],
    ['c-conc', thOrden('Concepto', 'concepto')],
    ['c-cat', th('Categoría')],
    ['c-sub', th('Subcategoría')],
    ['c-per', th('Periodicidad')],
    ['c-met', th('Método')],
    ['c-imp', thOrden('Importe', 'cantidad', 'num')],
    ['c-fecha c-fpago', thOrden('F. pago', 'fecha_pago', '', 'Fecha de pago')],
    ['c-tick', th('Pago', 'center', 'Pagado')],
    ['c-tick', th('Banco', 'center', 'Comprobado en el extracto del banco')],
    ['c-tick', th('Gest.', 'center', 'Factura enviada a la gestoría (FISCONTAL)')],
    ['c-ico', h('th', { scope: 'col', class: 'center', title: 'Factura adjunta' }, svg(ICO.doc))],
    ['c-ico', h('th', { scope: 'col', class: 'center', title: 'Comentarios' }, svg(ICO.coment))],
    ['c-ico', th('', 'center')],
  ].filter(Boolean);
  const ths = COLS.map((c) => { c[1].classList.add(...c[0].split(' ')); return c[1]; });

  function filtrados() {
    const q = normalizar(f.q.trim());
    const enCentro = new Set(ctx.filtrarCentro(gastos));
    return gastos.filter((g) => {
      if (!enCentro.has(g)) return false;
      if (f.cat && g.categoria_id !== f.cat) return false;
      if (f.sub && g.subcategoria_id !== f.sub) return false;
      if (f.mes && (g.mes || mesDeFecha(g.fecha_pago || g.fecha_factura)) !== f.mes) return false;
      if (f.estado === 'sin_pago' && esVerdad(g.pago)) return false;
      if (f.estado === 'sin_banca' && g.check_banca) return false;
      if (f.estado === 'sin_gestoria' && esVerdad(g.fiscontal)) return false;
      if (f.estado === 'sin_factura' && !g.sin_factura) return false;
      if (f.estado === 'sin_link' && (g.link_factura || g.sin_factura)) return false;
      if (f.estado === 'comentarios' && !(g.comentarios || '').trim()) return false;
      if (q && !normalizar(`${g.empresa} ${g.concepto} ${g.factura_nr} ${g.comentarios} ${g.cantidad}`).includes(q)) return false;
      return true;
    }).sort((a, b) => {
      const { campo, asc } = orden;
      let va = a[campo], vb = b[campo];
      if (campo === 'cantidad') { va = num(va); vb = num(vb); } else if (campo === 'mes') { va = MESES.indexOf(va); vb = MESES.indexOf(vb); } else { va = (va || '').toString().toLowerCase(); vb = (vb || '').toString().toLowerCase(); }
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return asc ? c : -c;
    });
  }

  // ---------- guardar una celda ----------
  async function guardar(g, cambios, el) {
    el?.classList.add('saving');
    try {
      const nuevo = await actualizarGasto(g.id, cambios);
      Object.assign(g, nuevo);
      el?.classList.remove('saving');
      if (el) { el.classList.add('saved'); setTimeout(() => el.classList.remove('saved'), 900); }
      actualizarTotales();
      return true;
    } catch (ex) {
      el?.classList.remove('saving');
      toast('No se ha guardado: ' + ex.message, 'error');
      return false;
    }
  }

  const opciones = (valores, actual, vacio = '—') => [h('option', { value: '' }, vacio),
    ...[...new Set([...valores, ...(actual ? [actual] : [])])].map((v) => h('option', { value: v, selected: v === actual }, v))];
  const etq = (campo, g) => `${campo} · ${g.empresa || ''} ${g.concepto || ''}`.trim();

  function celdaTexto(g, campo, { cls = '', lista, formato = (v) => v ?? '', leer = (v) => v.trim() || null, label = campo } = {}) {
    const inp = h('input', { type: 'text', class: 'gc ' + cls, value: formato(g[campo]), 'aria-label': etq(label, g), list: lista, title: formato(g[campo]) || null, spellcheck: 'false' });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = formato(g[campo]); inp.blur(); } });
    inp.addEventListener('change', async () => {
      const v = leer(inp.value);
      if (v === undefined) { inp.value = formato(g[campo]); return; }
      if (v === g[campo] || (v === null && !g[campo])) { inp.value = formato(g[campo]); return; }
      if (!(await guardar(g, { [campo]: v }, inp))) inp.value = formato(g[campo]);
      else { inp.value = formato(g[campo]); inp.title = inp.value; }
    });
    return h('td', {}, inp);
  }
  const celdaFecha = (g, campo, label) => celdaTexto(g, campo, {
    cls: 'gc-fecha', label, formato: (v) => (v ? fmtFechaCorta(v) : ''),
    leer: (t) => { const v = parsearFecha(t); if (v === null) { toast('Fecha no válida. Usa dd/mm/aa.', 'error'); return undefined; } return v || null; },
  });
  function celdaSelect(g, campo, valores, label) {
    const sel = h('select', { class: 'gc', 'aria-label': etq(label, g), title: g[campo] || '' }, opciones(valores, g[campo]));
    sel.addEventListener('change', async () => { if (!(await guardar(g, { [campo]: sel.value || null }, sel))) sel.value = g[campo] || ''; sel.title = sel.value; });
    return h('td', {}, sel);
  }
  function celdaCheck(g, campo, label, { valor = (v) => !!v, cambios = (on) => ({ [campo]: on }) } = {}) {
    const chk = h('input', { type: 'checkbox', checked: valor(g[campo]), 'aria-label': etq(label, g) });
    chk.addEventListener('change', async () => { chk.disabled = true; if (!(await guardar(g, cambios(chk.checked), chk))) chk.checked = !chk.checked; chk.disabled = false; tituloGestoria(); });
    const td = h('td', { class: 'center' }, chk);
    const tituloGestoria = () => { if (campo === 'fiscontal') td.title = esVerdad(g.fiscontal) ? `Enviada a la gestoría${g.fiscontal_fecha ? ' el ' + fmtFecha(g.fiscontal_fecha) : ''}` : 'Sin enviar a la gestoría'; };
    tituloGestoria();
    return td;
  }

  function fila(g) {
    const chk = h('input', { type: 'checkbox', checked: seleccion.has(g.id), 'aria-label': `Seleccionar ${g.empresa || ''} ${g.concepto || ''}`,
      onchange: () => { if (chk.checked) seleccion.add(g.id); else seleccion.delete(g.id); pintarBarra(); } });

    // contable (mes del curso)
    const selMes = h('select', { class: 'gc', 'aria-label': etq('Mes contable', g) }, MESES.map((m) => h('option', { value: m, selected: m === g.mes }, etiquetaContable(m))));
    if (!g.mes) selMes.prepend(h('option', { value: '', selected: true }, '—'));
    selMes.addEventListener('change', async () => { if (!(await guardar(g, { mes: selMes.value }, selMes))) selMes.value = g.mes || ''; });

    // categoría / subcategoría dependientes
    const selCat = h('select', { class: 'gc', 'aria-label': etq('Categoría del gasto', g) },
      h('option', { value: '' }, g.categoria_texto ? `(${g.categoria_texto})` : '—'),
      taxonomia.map((c) => h('option', { value: c.id, selected: c.id === g.categoria_id }, tituloCategoria(c.nombre))));
    const selSub = h('select', { class: 'gc', 'aria-label': etq('Subcategoría del gasto', g) });
    const pintarSubFila = () => {
      const cat = catPorId.get(selCat.value);
      selSub.replaceChildren(h('option', { value: '' }, cat ? 'Elige…' : (g.subcategoria_texto ? `(${g.subcategoria_texto})` : '—')),
        ...(cat ? cat.subcategorias.map((s) => h('option', { value: s.id, selected: s.id === g.subcategoria_id }, s.nombre)) : []));
      selSub.classList.toggle('falta', !!cat && !selSub.value);
      selCat.title = selCat.selectedOptions[0]?.textContent || ''; selSub.title = selSub.selectedOptions[0]?.textContent || '';
    };
    pintarSubFila();
    selCat.addEventListener('change', async () => {
      const cat = catPorId.get(selCat.value);
      const unica = cat && cat.subcategorias.length === 1 ? cat.subcategorias[0] : null;
      const ok = await guardar(g, { categoria_id: cat?.id || null, categoria_texto: cat ? tituloCategoria(cat.nombre) : null, subcategoria_id: unica?.id || null, subcategoria_texto: unica?.nombre || null }, selCat);
      if (!ok) selCat.value = g.categoria_id || '';
      pintarSubFila();
      if (ok && !unica && cat) selSub.focus();
    });
    selSub.addEventListener('change', async () => {
      const sub = subPorId.get(selSub.value);
      if (!(await guardar(g, { subcategoria_id: sub?.id || null, subcategoria_texto: sub?.nombre || null }, selSub))) selSub.value = g.subcategoria_id || '';
      pintarSubFila();
    });

    // centro
    let tdCentro = null;
    if (conCentro) {
      const selCen = h('select', { class: 'gc', 'aria-label': etq('Centro del gasto', g) }, state.centros.filter((c) => c.activo !== false || c.id === g.centro_id).map((c) => h('option', { value: c.id, selected: c.id === (g.centro_id || ctx.centroPrincipal()?.id) }, ctx.tituloCentro(c.nombre))));
      selCen.addEventListener('change', async () => { if (!(await guardar(g, { centro_id: selCen.value }, selCen))) selCen.value = g.centro_id; });
      tdCentro = h('td', {}, selCen);
    }

    // factura adjunta
    let factura;
    if (g.sin_factura) factura = h('span', { class: 'sf', title: 'Marcado sin factura' }, 's/f');
    else if (g.link_factura) {
      const url = /^https?:\/\//i.test(g.link_factura) ? g.link_factura : null;
      factura = esArchivoSubido(g.link_factura) || url
        ? h('button', { type: 'button', class: 'ib ok', title: 'Abrir la factura', 'aria-label': etq('Abrir factura', g), onclick: () => (url ? window.open(url, '_blank', 'noopener') : abrirFactura(g.link_factura)) }, svg(ICO.doc))
        : h('span', { class: 'ib ok', title: g.link_factura }, svg(ICO.doc));
    } else {
      factura = botonSubirFactura({ clase: 'ib warn', etiqueta: '', carpeta: () => curso.nombre,
        onSubido: async (link) => { if (await guardar(g, { link_factura: link, sin_factura: false })) { toast('Factura adjuntada'); pintar(); } } });
      const b = factura.querySelector('button'); b.title = 'Adjuntar la factura (PDF o foto)'; b.setAttribute('aria-label', etq('Adjuntar factura', g)); b.append(svg(ICO.subir));
    }

    // comentarios
    const tieneCom = !!(g.comentarios || '').trim();
    const btnCom = h('button', { type: 'button', class: 'ib' + (tieneCom ? ' activo' : ' tenue'), title: tieneCom ? g.comentarios : 'Añadir comentario', 'aria-label': etq(tieneCom ? 'Ver comentario' : 'Añadir comentario', g),
      onclick: () => editarComentario(g) }, svg(tieneCom ? ICO.comentLleno : ICO.coment));

    const importe = celdaTexto(g, 'cantidad', { cls: 'gc-num', label: 'Importe', formato: (v) => fmtEUR2(num(v)).replace(/\s?€/, ''),
      leer: (t) => { const n = Number(t.replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); if (!t.trim() || !Number.isFinite(n)) { toast('Importe no válido.', 'error'); return undefined; } return Math.round(n * 100) / 100; } });

    const tr = h('tr', { class: 'clickable', dataset: { id: g.id } },
      h('td', { class: 'col-check' }, chk),
      celdaFecha(g, 'fecha_factura', 'Fecha factura'),
      h('td', {}, selMes),
      tdCentro,
      celdaSelect(g, 'tipo', LISTAS.tipo, 'Tipo'),
      celdaTexto(g, 'empresa', { lista: 'dl-g-empresa', label: 'Empresa' }),
      celdaTexto(g, 'factura_nr', { label: 'Nº factura' }),
      celdaTexto(g, 'concepto', { label: 'Concepto' }),
      h('td', {}, selCat), h('td', {}, selSub),
      celdaSelect(g, 'periodicidad', LISTAS.periodicidad, 'Periodicidad'),
      celdaSelect(g, 'metodo_pago', LISTAS.metodo_pago, 'Método de pago'),
      importe,
      celdaFecha(g, 'fecha_pago', 'Fecha pago'),
      celdaCheck(g, 'pago', 'Pagado', { valor: esVerdad, cambios: (on) => ({ pago: on ? 'True' : 'False' }) }),
      celdaCheck(g, 'check_banca', 'Comprobado en banco'),
      celdaCheck(g, 'fiscontal', 'Enviada a gestoría', { valor: esVerdad, cambios: (on) => ({ fiscontal: on ? 'True' : 'False', fiscontal_fecha: on ? hoyISO() : null }) }),
      h('td', { class: 'center' }, factura),
      h('td', { class: 'center' }, btnCom),
      h('td', { class: 'center' }, h('button', { type: 'button', class: 'ib', title: 'Abrir la ficha completa (NIF, IBAN, dividir, borrar…)', 'aria-label': etq('Abrir ficha', g), onclick: () => editar(g) }, svg(ICO.mas))));
    [...tr.children].forEach((td, i) => td.classList.add(...COLS[i][0].split(' ')));
    return tr;
  }

  async function editarComentario(g) {
    const ta = h('textarea', { class: 'input-nota', rows: 5, 'aria-label': 'Comentario' }, g.comentarios || '');
    setTimeout(() => ta.focus(), 80);
    const ok = await confirmar({ titulo: `Comentario · ${g.empresa || ''}`, texto: h('div', {}, h('p', { class: 'muted' }, `${g.concepto || ''} · ${fmtEUR2(num(g.cantidad))}`), ta), ok: 'Guardar' });
    if (!ok) return;
    const v = ta.value.trim() || null;
    if (v === (g.comentarios || null)) return;
    if (await guardar(g, { comentarios: v })) { toast('Comentario guardado'); pintar(); }
  }

  let listaActual = [];
  function actualizarTotales() {
    const total = listaActual.reduce((s, g) => s + num(g.cantidad), 0);
    titulo.textContent = `${listaActual.length} de ${gastos.length} gastos · total ${fmtEUR2(total)}`;
  }

  function pintar() {
    const lista = filtrados();
    listaActual = lista;
    actualizarTotales();
    for (const t of ths) if (t._campo) {
      const activo = t._campo === orden.campo;
      t.setAttribute('aria-sort', activo ? (orden.asc ? 'ascending' : 'descending') : 'none');
      t._flecha.textContent = activo ? (orden.asc ? ' ▲' : ' ▼') : '';
    }
    if (!lista.length) {
      clear(tbody, h('tr', {}, h('td', { colspan: String(COLS.length), class: 'empty' }, gastos.length ? 'Ningún gasto coincide con los filtros.' : `Todavía no hay gastos en ${curso.nombre}.`)));
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
  function nuevoGasto(inicial) {
    abrirGastoForm({ gasto: null, ctx, inicial, onGuardado: (nuevo) => reemplazar(null, nuevo), onBorrado: () => {} });
  }
  function exportar() {
    const cols = ['fecha_factura', 'mes', 'contable', 'tipo', 'empresa', 'factura_nr', 'concepto', 'fecha_pago', 'cantidad', 'categoria', 'subcategoria', 'periodicidad', 'metodo_pago', 'pago', 'check_banca', 'fiscontal', 'fiscontal_fecha', 'sin_factura', 'link_factura', 'nif', 'iban', 'swift', 'comentarios'];
    const filas = filtrados().map((g) => cols.map((c) => {
      if (c === 'categoria') return tituloCategoria(catPorId.get(g.categoria_id)?.nombre || g.categoria_texto || '');
      if (c === 'subcategoria') return subPorId.get(g.subcategoria_id)?.nombre || g.subcategoria_texto || '';
      if (c === 'contable') return etiquetaContable(g.mes);
      if (c === 'cantidad') return num(g.cantidad).toFixed(2).replace('.', ',');
      if (c.startsWith('fecha') || c === 'fiscontal_fecha') return g[c] ? fmtFecha(g[c]) : '';
      if (c === 'pago' || c === 'fiscontal') return esVerdad(g[c]) ? 'Sí' : 'No';
      if (typeof g[c] === 'boolean') return g[c] ? 'Sí' : 'No';
      return g[c] ?? '';
    }));
    descargarCSV(`gastos_${curso.nombre}.csv`, [cols, ...filas]);
  }

  const empresasDL = h('datalist', { id: 'dl-g-empresa' }, [...new Set([...gastos.map((g) => g.empresa).filter(Boolean), ...(state.empresas || []).map((e) => e.nombre_comercial)])].sort((a, b) => a.localeCompare(b, 'es')).map((v) => h('option', { value: v })));

  clear(view,
    h('div', { class: 'banner' }, h('span', {}, h('strong', {}, 'Fase de pruebas: '), 'el Excel sigue siendo la referencia. Los cambios de la tabla se guardan al salir de cada celda.')),
    h('div', { class: 'section-head' },
      h('div', {}, h('h2', {}, `Gastos · ${curso.nombre}`), titulo),
      h('div', { class: 'section-actions' },
        h('button', { class: 'btn', onclick: exportar }, 'Exportar CSV'),
        h('button', { class: 'btn', onclick: () => generarGastosDelMes(ctx, { curso, gastos, onCreados: (creados) => { gastos.unshift(...creados); ctx.setGastos(curso.id, gastos); pintar(); } }) }, 'Generar gastos del mes'),
        h('button', { class: 'btn', onclick: () => abrirEscaner(ctx, { gastos, onDatos: (inicial) => nuevoGasto(inicial) }) }, 'Escanear factura'),
        h('button', { class: 'btn primary', onclick: () => nuevoGasto() }, '+ Nuevo gasto'))),
    h('div', { class: 'filters' }, h('div', { class: 'search' }, fQ), fCat, fSub, fMes, fEstado),
    barra, empresasDL,
    h('div', { class: 'table-wrap' }, h('table', { class: 'data tabla-gastos' + (conCentro ? ' con-centro' : '') },
      h('colgroup', {}, COLS.map(([c]) => h('col', { class: c }))),
      h('thead', {}, h('tr', {}, ths)), tbody)),
    pie);
  pintar();
}
