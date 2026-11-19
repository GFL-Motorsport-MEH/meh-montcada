// Documentación y protocolos de la academia: textos con categoría y versión, con un formato sencillo (títulos, listas, negrita).
import { vista, vincular, avisoFiltros, busqueda } from '../vista.js';
import { h, clear, cargando, toast, confirmar, fmtFecha, normalizar } from '../ui.js';
import * as api from './api.js';
import { campo, txt, area, sel, drawer, cabecera, pill, guardarBoton, refrescar } from './kit.js';

// formato: "# Título", "## Subtítulo", "- elemento", "1. elemento", "**negrita**", línea en blanco = párrafo. Todo se inserta como texto (nunca HTML).
export function renderTexto(texto) {
  const raiz = h('div', { class: 'ac-doc' });
  const en = (s) => { const f = document.createDocumentFragment(); s.split(/(\*\*[^*]+\*\*)/).forEach((p) => f.append(/^\*\*[^*]+\*\*$/.test(p) ? h('strong', {}, p.slice(2, -2)) : document.createTextNode(p))); return f; };
  let lista = null; let tipoLista = null;
  const cerrarLista = () => { lista = null; tipoLista = null; };
  for (const linea of (texto || '').split('\n')) {
    const l = linea.trimEnd();
    if (!l.trim()) { cerrarLista(); continue; }
    let m;
    if ((m = l.match(/^(#{1,2})\s+(.*)/))) { cerrarLista(); raiz.append(h(m[1].length === 1 ? 'h3' : 'h4', {}, en(m[2]))); }
    else if ((m = l.match(/^\s*[-*]\s+(.*)/)) || (m = l.match(/^\s*\d+[.)]\s+(.*)/))) {
      const tipo = /^\s*\d/.test(l) ? 'ol' : 'ul';
      if (tipoLista !== tipo) { lista = h(tipo, {}); raiz.append(lista); tipoLista = tipo; }
      lista.append(h('li', {}, en(m[1])));
    } else { cerrarLista(); raiz.append(h('p', {}, en(l))); }
  }
  return raiz;
}

export async function renderDocumentos(view, ctx) {
  clear(view, cargando());
  const [docs, ls] = await Promise.all([api.documentos(), api.listas()]);
  const editor = ctx.edita('ac_documentos');
  const recargar = () => { api.invalidar(); refrescar(); };
  const f = vista('documentos.f', { q: '', cat: '', ver: 'vigente' });
  if (f.cat && !(ls.categoria_documento || []).includes(f.cat)) f.cat = '';
  const VER = [['vigente', 'Vigentes'], ['borrador', 'Borradores'], ['archivado', 'Archivados'], ['', 'Todos']];
  const cont = h('div');
  function pintar() {
    const q = normalizar(f.q);
    const filas = docs.filter((d) => (!f.ver || d.estado === f.ver) && (!f.cat || d.categoria === f.cat) && (!q || normalizar(`${d.titulo} ${d.contenido}`).includes(q))).sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '') || a.titulo.localeCompare(b.titulo));
    const cats = [...new Set(filas.map((d) => d.categoria || 'Sin categoría'))];
    clear(cont, filas.length ? cats.map((c) => h('div', { class: 'card ac-doc-cat' }, h('h3', { class: 'sub-titulo' }, c),
      filas.filter((d) => (d.categoria || 'Sin categoría') === c).map((d) => h('button', { class: 'ac-doc-item', type: 'button', onclick: () => abrir(d, { ls, ctx, recargar }) },
        h('strong', {}, d.titulo), h('span', { class: 'small muted' }, ` v${d.version} · actualizado ${fmtFecha(d.updated_at)}`), d.estado !== 'vigente' ? pill(d.estado) : null)))) : h('div', { class: 'card empty' }, 'No hay documentos. Crea el primer protocolo con «+ Nuevo documento».'));
  }
  clear(view, cabecera('Documentación y protocolos', 'Cómo se hacen las cosas en la academia', editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrir(null, { ls, ctx, recargar }) }, '+ Nuevo documento') : null),
    h('div', { class: 'filters filters-3' }, vincular(f, 'q', h('input', { type: 'search', placeholder: 'Buscar en títulos y contenido…', oninput: (e) => { f.q = e.target.value; pintar(); } })),
      vincular(f, 'cat', sel([['', 'Todas las categorías'], ...(ls.categoria_documento || []).map((c) => [c, c])], f.cat, { onchange: (e) => { f.cat = e.target.value; pintar(); } })),
      vincular(f, 'ver', sel(VER, f.ver, { onchange: (e) => { f.ver = e.target.value; pintar(); } }))),
    avisoFiltros(f, { etiquetas: { q: 'Búsqueda', cat: 'Categoría', ver: 'Estado' }, formato: { q: busqueda, ver: (v) => VER.find(([k]) => k === v)?.[1] || v }, alLimpiar: () => pintar() }), cont);
  pintar();
}

function abrir(doc, { ls, ctx, recargar }) {
  const d = drawer({ titulo: doc ? doc.titulo : 'Nuevo documento', ancho: 760 });
  const editor = ctx.edita('ac_documentos');
  let editando = !doc && editor;
  const F = { titulo: txt(doc?.titulo), cat: sel(ls.categoria_documento || [], doc?.categoria, { vacio: 'Sin categoría' }), estado: sel([['vigente', 'Vigente'], ['borrador', 'Borrador'], ['archivado', 'Archivado']], doc?.estado || 'vigente'), contenido: area(doc?.contenido, { rows: 18, placeholder: '# Título\n\n- Paso 1\n- Paso 2\n\n**Importante:** texto en negrita' }) };
  const pintar = () => {
    clear(d.cuerpo, editando
      ? [h('div', { class: 'form-section' }, campo('Título', F.titulo, { full: true, req: true }), campo('Categoría', F.cat), campo('Estado', F.estado), campo('Contenido', F.contenido, { full: true })),
        h('div', { class: 'small muted' }, 'Formato: «# Título», «## Subtítulo», «- elemento» o «1. elemento», «**negrita**». Al guardar sube la versión.')]
      : [h('div', { class: 'small muted' }, `${doc.categoria || 'Sin categoría'} · versión ${doc.version} · ${doc.estado}`), renderTexto(doc.contenido)]);
    clear(d.pie, doc && ctx.esAdmin() ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Borrar documento', texto: doc.titulo, ok: 'Borrar', peligro: true })) { try { await api.del('ac_documentos', doc.id); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } } }, 'Borrar') : h('span'),
      h('div', { class: 'ac-fila' }, h('button', { class: 'btn', type: 'button', onclick: d.cerrar }, 'Cerrar'),
        editando ? guardarBoton('Guardar', async () => {
          if (!F.titulo.value.trim()) { toast('Falta el título.', 'error'); return; }
          const fila = { titulo: F.titulo.value.trim(), categoria: F.cat.value || null, estado: F.estado.value, contenido: F.contenido.value };
          try { if (doc) await api.upd('ac_documentos', doc.id, { ...fila, version: doc.version + 1 }); else await api.ins('ac_documentos', fila); toast('Documento guardado'); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); }
        }) : editor ? h('button', { class: 'btn primary', type: 'button', onclick: () => { editando = true; pintar(); } }, 'Editar') : null));
  };
  pintar();
}
