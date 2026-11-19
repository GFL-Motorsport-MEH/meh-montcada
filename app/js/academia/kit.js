// Piezas de interfaz compartidas por las pantallas de Academia.
import { h, clear, normalizar } from '../ui.js';
import { ordenGuardado, guardarOrden } from '../orden-compartido.js';

export const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const DIAS_CORTO = ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const esVerdad = (v) => v === true || /^(true|1|x|si|sí|verdadero)$/i.test(String(v ?? '').trim());
// color de cada modalidad (como en el horario en papel: KIDS amarillo, TEENS naranja, ADULTS rosa…)
export const COLORES_MODALIDAD = [['baby', '#5aa469'], ['kids', '#d9b72e'], ['teen', '#e08a3c'], ['adult', '#d76f9a'], ['1 to 1', '#4f7cff'], ['one to one', '#4f7cff'], ['extra', '#8c6bc8'], ['speaking', '#26a69a'], ['empresa', '#7a8a99']];
export function colorGrupo(g) {
  const t = `${g.modalidad || ''} ${g.nombre || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return (COLORES_MODALIDAD.find(([k]) => t.includes(k)) || [0, '#8c8a81'])[1];
}
// niveles de la academia: L1 amarillo · L2 azul · L3 rojo claro · L4 verde · L5 negro (el texto puede ser «Level 3», «L3», «3»…)
export const COLORES_NIVEL = { 1: ['#f2c94c', '#3b3000'], 2: ['#3b82f6', '#fff'], 3: ['#f28b82', '#4a0d08'], 4: ['#43a85b', '#fff'], 5: ['#1d1d1f', '#fff'] };
export function nivelNum(n) {
  const m = /^\s*(?:level|nivel|l)?\s*([1-5])\s*$/i.exec(String(n ?? ''));
  return m ? Number(m[1]) : null;
}
export const colorNivel = (n) => (COLORES_NIVEL[nivelNum(n)] || [])[0] || null;
export function pillNivel(n) {
  const k = nivelNum(n);
  if (!k) return n ? h('span', { class: 'muted' }, String(n)) : '';
  const [bg, fg] = COLORES_NIVEL[k];
  return h('span', { class: 'ac-nivel', style: `background:${bg};color:${fg}`, title: `Nivel ${k}` }, `L${k}`);
}
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

// edad en años a partir de la fecha de nacimiento o del texto de «edad» («8», «4 años», «2016», «2016-09-22»); null si no se entiende
export function edadNumerica(texto, fnac) {
  if (fnac) { const e = edad(fnac); return e === '' || Number.isNaN(e) ? null : e; }
  const t = String(texto ?? '').trim(); if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return edad(t);
  if (/^\d{4}$/.test(t)) return Number(t) >= 1930 ? new Date().getFullYear() - Number(t) : null;
  const m = /^(\d{1,3})\s*(años?|a)?\b/i.exec(t);
  return m ? Number(m[1]) : null;
}
// valor de una lista «nivel» cuyo tramo de edad contiene la edad dada (items = [{ valor, edad_min, edad_max }])
export const nivelPorEdad = (items, e) => (e == null ? null : (items || []).find((x) => x.edad_min != null && x.edad_max != null && e >= x.edad_min && e <= x.edad_max) || null);

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

// color estable por nombre y círculo con las siglas de una persona (o «?» si no hay nadie asignado)
export const colorDe = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${x % 360} 42% 40%)`; };
export const iniciales = (n) => String(n).trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
export const avatarDe = (nombre, siglas) => (nombre
  ? h('span', { class: 'ac-av', title: nombre, style: `background:${colorDe(nombre)}` }, siglas || iniciales(nombre))
  : h('span', { class: 'ac-av vacio', title: 'Sin asignar' }, '?'));

// cabecera de sección con título, contador y acciones
export function cabecera(titulo, sub, ...acciones) {
  return h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, titulo), sub ? h('div', { class: 'count' }, sub) : null), h('div', { class: 'section-actions' }, ...acciones));
}

// tabla con columnas [{t:'Título', v:(fila)=>nodo|texto, num?:bool, s?:(fila)=>valor para ordenar/filtrar, sin?:true para no ordenar ni filtrar}].
// Pulsar un título ordena (A→Z, Z→A, sin orden); bajo los títulos hay un filtro por columna (lista si tiene pocos valores distintos).
// El orden y los filtros se recuerdan mientras no se recargue la página (por tabla, según sus títulos).
const ESTADO_TABLAS = new Map();
const textoCelda = (c, f) => {
  const v = c.s ? c.s(f) : c.v(f);
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map((x) => (x && x.textContent !== undefined ? x.textContent : String(x ?? ''))).join(' ').trim();
  return (v.textContent !== undefined ? v.textContent : String(v)).replace(/\s+/g, ' ').trim();
};
const comoNumero = (t) => { const m = /^-?\s*\d[\d.,]*/.exec(t.replace(/[€%\s]/g, '')); return m && /^-?[\d.,]+$/.test(t.replace(/[€%\s]/g, '')) ? parseFloat(m[0].replace(/\./g, (x, i, str) => (str.includes(',') ? '' : x)).replace(',', '.')) : null; };
// «15/06/2026» o «15/06/26» → número aaaammdd, para ordenar por la fecha real y no por el día
const comoFecha = (t) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t); return m ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) * 10000 + +m[2] * 100 + +m[1] : null; };
const comparar = (a, b) => {
  if (a === b) return 0;
  if (a === '' || a === '—') return 1; // los vacíos siempre al final
  if (b === '' || b === '—') return -1;
  const fa = comoFecha(a); const fb = comoFecha(b);
  if (fa !== null && fb !== null) return fa - fb;
  const na = comoNumero(a); const nb = comoNumero(b);
  if (na !== null && nb !== null) return na - nb;
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
};

export function tabla(cols, filas, { onClick, vacio = 'Sin datos todavía.', clase = '', ordenable = true } = {}) {
  if (!filas.length) return h('div', { class: 'card empty' }, vacio);
  const clave = cols.map((c) => c.t).join('|');
  let est = ESTADO_TABLAS.get(clave);
  if (!est) { // la última ordenación elegida por cualquiera del equipo (servidor)
    const g = ordenGuardado('tabla:' + clave);
    const col = g && g.t ? cols.findIndex((c) => c.t === g.t) : -1;
    est = { col, dir: col >= 0 && g.dir === -1 ? -1 : 1, filtros: {} };
  }
  ESTADO_TABLAS.set(clave, est);
  const util = ordenable && filas.length > 1;
  const textos = util ? filas.map((f) => cols.map((c) => (c.sin || !c.t ? '' : textoCelda(c, f)))) : [];
  const filtrable = cols.map((c, j) => util && !c.sin && !!c.t && textos.some((t) => t[j] !== ''));
  const distintos = cols.map((c, j) => (filtrable[j] ? [...new Set(textos.map((t) => t[j]).filter(Boolean))] : []));
  const nota = h('div', { class: 'ac-tabla-nota count' });
  const tbody = h('tbody');
  const ths = cols.map((c, j) => {
    const th = h('th', { class: (c.num ? 'num ' : '') + (filtrable[j] ? 'sortable' : ''), title: filtrable[j] ? 'Pulsa para ordenar' : null }, c.t, ' ', h('span', { class: 'ac-orden' }));
    if (filtrable[j]) th.addEventListener('click', () => { if (est.col !== j) { est.col = j; est.dir = 1; } else if (est.dir === 1) est.dir = -1; else { est.col = -1; est.dir = 1; } guardarOrden('tabla:' + clave, { t: est.col >= 0 ? cols[est.col].t : null, dir: est.dir }); pinta(); });
    return th;
  });
  const controles = cols.map((c, j) => {
    if (!filtrable[j]) return h('th', {});
    const lista = distintos[j].length > 1 && distintos[j].length <= 14 && filas.length > 12;
    const el = lista
      ? h('select', { 'aria-label': 'Filtrar ' + c.t }, h('option', { value: '' }, 'Todos'), distintos[j].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).map((v) => h('option', { value: v }, v)))
      : h('input', { type: 'search', placeholder: 'Filtrar', 'aria-label': 'Filtrar ' + c.t });
    el.value = est.filtros[j] || '';
    el.addEventListener(lista ? 'change' : 'input', () => { est.filtros[j] = el.value; pinta(); });
    return h('th', { class: 'ac-filtro' }, el);
  });
  function pinta() {
    let idx = filas.map((_, i) => i);
    const activos = Object.entries(est.filtros).filter(([, v]) => v);
    for (const [j, v] of activos) {
      const q = normalizar(v); const exacto = distintos[j].length > 1 && distintos[j].length <= 14 && filas.length > 12;
      idx = idx.filter((i) => (exacto ? textos[i][j] === v : normalizar(textos[i][j]).includes(q)));
    }
    if (est.col >= 0) idx.sort((x, y) => est.dir * comparar(textos[x][est.col], textos[y][est.col]));
    ths.forEach((th, j) => { th.querySelector('.ac-orden').textContent = est.col === j ? (est.dir === 1 ? '▲' : '▼') : ''; });
    nota.textContent = util && (activos.length || est.col >= 0) ? `${idx.length} de ${filas.length} filas${activos.length ? ' · filtradas' : ''}` : '';
    clear(tbody, idx.length ? idx.map((i) => { const f = filas[i]; return h('tr', { class: onClick ? 'clickable' : '', onclick: onClick ? () => onClick(f) : null }, cols.map((c) => h('td', { class: c.num ? 'num' : '' }, c.v(f)))); })
      : h('tr', {}, h('td', { colspan: cols.length, class: 'empty' }, 'Ningún dato coincide con los filtros de la tabla.')));
  }
  pinta();
  return h('div', { class: 'table-wrap card-tabla' }, nota, h('table', { class: 'data ac-tabla ' + clase },
    h('thead', {}, h('tr', {}, ths), util && filtrable.some(Boolean) ? h('tr', { class: 'ac-fila-filtros' }, controles) : null), tbody));
}

export const pill = (texto, tipo = 'off') => h('span', { class: `pill ${tipo}` }, texto);

// ---------- valores de lista con color (ac_listas.color) ----------
export const COLOR_NEUTRO = '#6b7280';
export const PALETA_LISTAS = ['#2563eb', '#0891b2', '#0f766e', '#16a34a', '#d97706', '#ea580c', '#dc2626', '#db2777', '#c026d3', '#7c3aed', '#92400e', '#475569'];
const estiloColor = (c) => { const k = c || COLOR_NEUTRO; return `background:color-mix(in srgb, ${k} 16%, transparent);color:${k};border-color:color-mix(in srgb, ${k} 40%, transparent)`; };
export const colorLista = (items, valor) => (items || []).find((x) => x.valor === valor)?.color || COLOR_NEUTRO;
// etiqueta de color; sin valor no pinta nada
export const pillColor = (texto, color) => (texto ? h('span', { class: 'pill-color', style: estiloColor(color) }, texto) : '');
// desplegable que se pinta del color del valor elegido. items = [{ valor, color }]
export function selColor(items, valor, { vacio, onchange, disabled, label } = {}) {
  const ops = items.map((x) => [x.valor, x.valor]);
  if (valor && !ops.some(([v]) => v === valor)) ops.push([valor, valor]); // valor antiguo que ya no está en la lista: se conserva
  const s = h('select', { class: 'sel-color', disabled: !!disabled, 'aria-label': label || null },
    vacio !== undefined ? h('option', { value: '' }, vacio) : null,
    ops.map(([v, l]) => h('option', { value: v, selected: v === (valor ?? ''), style: `color:${colorLista(items, v)}` }, l)));
  const pintar = () => { s.setAttribute('style', s.value ? estiloColor(colorLista(items, s.value)) : ''); };
  s.addEventListener('change', pintar); s.addEventListener('repintar', pintar); pintar(); // «repintar»: tras cambiar .value por código
  if (onchange) s.addEventListener('change', onchange);
  return s;
}

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
