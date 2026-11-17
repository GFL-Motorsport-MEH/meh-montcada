// Piezas de interfaz compartidas por las pantallas de Academia.
import { h, clear, normalizar } from '../ui.js';

export const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const DIAS_CORTO = ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const esVerdad = (v) => v === true || /^(true|1|x|si|sí|verdadero)$/i.test(String(v ?? '').trim());
export const nombreAlumno = (a) => (a ? `${a.apellidos}, ${a.nombre}` : '—');
export const hhmm = (t) => (t || '').slice(0, 5);

export function edad(fechaNac) {
  if (!fechaNac) return '';
  const n = new Date(fechaNac); const hoy = new Date();
  let e = hoy.getFullYear() - n.getFullYear();
  if (hoy.getMonth() < n.getMonth() || (hoy.getMonth() === n.getMonth() && hoy.getDate() < n.getDate())) e--;
  return e;
}

// campo de formulario con etiqueta
export function campo(label, input, { full = false, req = false } = {}) {
  return h('label', { class: 'field' + (full ? ' full' : '') }, h('span', {}, label, req ? h('span', { class: 'req' }, ' *') : null), input);
}
export const txt = (value, extra = {}) => h('input', { type: 'text', value: value ?? '', ...extra });
export const area = (value, extra = {}) => h('textarea', { rows: 3, ...extra }, value ?? '');
export const fecha = (value, extra = {}) => h('input', { type: 'date', value: value || '', ...extra });
export const numero = (value, extra = {}) => h('input', { type: 'number', step: '0.01', inputmode: 'decimal', value: value ?? '', ...extra });
export function sel(opciones, valor, { vacio, ...extra } = {}) {
  const ops = opciones.map((o) => (Array.isArray(o) ? o : [o, o]));
  if (valor && !ops.some(([v]) => v === valor)) ops.push([valor, valor]);
  return h('select', extra, vacio !== undefined ? h('option', { value: '' }, vacio) : null, ops.map(([v, l]) => h('option', { value: v, selected: v === (valor ?? '') }, l)));
}

// panel lateral (como el de gastos): devuelve { cerrar, cuerpo, pie }
export function drawer({ titulo, ancho, onCerrar }) {
  const cuerpo = h('div', { class: 'drawer-body' });
  const pie = h('div', { class: 'drawer-foot' });
  const cerrar = () => { overlay.remove(); document.removeEventListener('keydown', onKey); onCerrar?.(); };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.overlay.modal-center')) cerrar(); };
  const panel = h('div', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', style: ancho ? `width:min(${ancho}px,100%)` : null },
    h('div', { class: 'drawer-head' }, h('h2', { style: 'font-size:17px' }, titulo), h('button', { class: 'btn ghost', type: 'button', onclick: cerrar, 'aria-label': 'Cerrar' }, '✕')),
    cuerpo, pie);
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) cerrar(); } }, panel);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  return { cerrar, cuerpo, pie, panel };
}

// cabecera de sección con título, contador y acciones
export function cabecera(titulo, sub, ...acciones) {
  return h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, titulo), sub ? h('div', { class: 'count' }, sub) : null), h('div', { class: 'section-actions' }, ...acciones));
}

// tabla de solo lectura con columnas [{t:'Título', v:(fila)=>nodo|texto, num?:bool}]
export function tabla(cols, filas, { onClick, vacio = 'Sin datos todavía.', clase = '' } = {}) {
  if (!filas.length) return h('div', { class: 'card empty' }, vacio);
  return h('div', { class: 'table-wrap card-tabla' }, h('table', { class: 'data ac-tabla ' + clase },
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', { class: c.num ? 'num' : '' }, c.t)))),
    h('tbody', {}, filas.map((f) => h('tr', { class: onClick ? 'clickable' : '', onclick: onClick ? () => onClick(f) : null },
      cols.map((c) => h('td', { class: c.num ? 'num' : '' }, c.v(f))))))));
}

export const pill = (texto, tipo = 'off') => h('span', { class: `pill ${tipo}` }, texto);

// buscador de alumnos: un campo con lista desplegable; getAlumno() devuelve el elegido
export function buscadorAlumno(alumnos, { valorId, placeholder = 'Escribe apellido o nombre…', soloActivos = false } = {}) {
  const lista = soloActivos ? alumnos.filter((a) => a.estado === 'inscrito' || a.estado === 'prematricula') : alumnos;
  const etiqueta = (a) => `${nombreAlumno(a)}${a.num ? ` · nº ${a.num}` : ''}`;
  const dl = h('datalist', { id: 'dl-al-' + Math.random().toString(36).slice(2) }, lista.map((a) => h('option', { value: etiqueta(a) })));
  const input = h('input', { type: 'text', list: dl.id, placeholder, autocomplete: 'off' });
  const porId = alumnos.find((a) => a.id === valorId);
  if (porId) input.value = etiqueta(porId);
  const el = h('span', { class: 'buscador-alumno' }, input, dl);
  el.getAlumno = () => {
    const v = input.value.trim();
    return lista.find((a) => etiqueta(a) === v) || lista.find((a) => normalizar(nombreAlumno(a)) === normalizar(v)) || null;
  };
  el.input = input;
  return el;
}

export function guardarBoton(texto, fn) {
  const b = h('button', { class: 'btn primary', type: 'button' }, texto);
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { await fn(); } finally { b.disabled = false; }
  });
  return b;
}

// vuelve a pintar la pantalla actual (las vistas se montan fuera del DOM y luego se mueven, así que no pueden repintarse solas)
export const refrescar = () => { window.dispatchEvent(new Event('hashchange')); };
export { h, clear };
