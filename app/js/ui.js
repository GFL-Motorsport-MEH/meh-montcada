// Utilidades de interfaz. Todo el texto se inserta con textContent (nunca
// innerHTML con datos), para que ningún dato pueda inyectar HTML.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// ---------- formato ----------
const eur0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' });
const eur2 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const pct = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 1 });
export const fmtEUR = (n) => eur0.format(n || 0);
export const fmtEUR2 = (n) => eur2.format(n || 0);
export const fmtPct = (n) => pct.format(n || 0);
export function fmtFecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
export function fmtFechaCorta(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y.slice(2)}`;
}
// fecha y hora de un instante (timestamptz), en hora de Madrid: 20/11/2026 13:01
const fHora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export function fmtFechaHora(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : fHora.format(d).replace(',', '');
}
// día (yyyy-mm-dd) de un instante, en hora de Madrid
export const diaDeInstante = (ts) => { if (!ts) return ''; const d = new Date(ts); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d); };
// Importe escrito a mano. «,» y «.» valen igual como decimal (los miles no se escriben): "44,20", "44.20", "1234,5".
// Si vienen los dos («1.234,56» o «1,234.56») el último es el decimal; si un mismo signo se repite («1.234.567») son miles.
// Devuelve null si está vacío, NaN si no vale y, si no, el número redondeado a 2 decimales.
export function importeEscrito(txt) {
  let s = String(txt ?? '').replace(/\s|€/g, '');
  if (s === '') return null;
  const ult = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (ult >= 0) {
    const dec = s[ult], otro = dec === ',' ? '.' : ',';
    const unico = s.split(dec).length === 2;
    s = s.split(otro).join('');
    if (!unico && !/^-?\d{1,3}(?:[.,]\d{3})+$/.test(s)) return NaN; // un signo repetido solo vale como miles
    s = unico ? s.replace(dec, '.') : s.split(dec).join('');
  }
  return /^-?\d*\.?\d+$|^-?\d+\.$/.test(s) ? Math.round(Number(s) * 100) / 100 : NaN;
}
// Casillas de importe marcadas con data-punto: «,» y «.» valen igual (se guarda siempre como punto) y no deja escribir otra cosa
if (typeof document !== 'undefined') {
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || !el.hasAttribute('data-punto')) return;
    const pos = el.selectionStart ?? el.value.length;
    let v = el.value.replace(/,/g, '.').replace(/[^\d.\-]/g, '');
    const i = v.indexOf('.'); if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '');
    v = v.charAt(0) + v.slice(1).replace(/-/g, '');
    if (v !== el.value) { const quitados = el.value.length - v.length; el.value = v; try { el.setSelectionRange(Math.max(0, pos - quitados), Math.max(0, pos - quitados)); } catch { /* */ } }
  }, true);
}
export const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));

// Curso escolar: septiembre -> agosto
export const MESES = ['septiembre', 'octubre', 'noviembre', 'diciembre', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto'];
export const MESES_CORTO = ['Sep', 'Oct', 'Nov', 'Dic', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago'];
const MESES_CAL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function mesDeFecha(iso) {
  if (!iso) return null;
  return MESES_CAL[Number(iso.slice(5, 7)) - 1] || null;
}
export const capitalizar = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
export const tituloCategoria = (s) => (s || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
export function hoyISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
export function normalizar(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
// Clase de color de un grupo de alumnos (Babies, Kids, Teens, Adultos, 1 to 1, Empresas, Activities); ver app.css
export const grupoClase = (g) => 'g-' + normalizar(g).trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- toasts ----------
let zone;
export function toast(msg, tipo = 'ok') {
  if (!zone) { zone = h('div', { class: 'toast-zone', role: 'status', 'aria-live': 'polite' }); document.body.append(zone); }
  const t = h('div', { class: 'toast' + (tipo === 'error' ? ' error' : '') }, msg);
  zone.append(t);
  setTimeout(() => t.remove(), tipo === 'error' ? 6000 : 3000);
}

// ---------- diálogos ----------
export function confirmar({ titulo, texto, ok = 'Aceptar', peligro = false }) {
  return new Promise((resolve) => {
    const cerrar = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') cerrar(false); };
    const btnOk = h('button', { class: 'btn ' + (peligro ? 'danger' : 'primary'), onclick: () => cerrar(true) }, ok);
    const overlay = h('div', { class: 'overlay modal-center', onclick: (e) => { if (e.target === overlay) cerrar(false); } },
      h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-t' },
        h('h3', { id: 'dlg-t' }, titulo),
        h('div', { class: 'small' }, texto),
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn', onclick: () => cerrar(false) }, 'Cancelar'), btnOk)));
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    // se enfoca un poco después para que la misma pulsación de Enter que abrió el diálogo no lo confirme
    setTimeout(() => btnOk.focus(), 60);
  });
}

export function cargando(texto = 'Cargando…') {
  return h('div', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), texto);
}

export function descargarCSV(nombre, filas) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const texto = '﻿' + filas.map((f) => f.map(esc).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: nombre });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- leer archivos (CSV / Excel) ----------
// CSV con separador ; , o tabulador (se detecta en la primera línea) y comillas dobles. Devuelve array de arrays.
export function parsearCSV(texto) {
  texto = texto.replace(/^﻿/, '');
  const primera = texto.split(/\r?\n/, 1)[0] || '';
  const sep = [';', '\t', ','].map((s) => [s, primera.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const filas = []; let fila = [], campo = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((v) => String(v).trim() !== ''));
}
// Lee .csv, .xlsx o .xls y devuelve las filas de la primera hoja (incluida la cabecera).
// Para Excel carga SheetJS bajo demanda.
export async function leerHojaArchivo(file) {
  if (/\.(csv|txt)$/i.test(file.name)) return parsearCSV(await file.text());
  const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
}

// ---------- tablas que deben caber sin scroll lateral ----------
// Si alguna celda (o el texto de un campo) no cabe, baja la letra de la tabla medio punto cada vez (hasta 9 px).
// Se recalcula cuando cambia el ancho de la tabla (ventana más estrecha o más ancha).
export function ajustarAncho(tabla, minimo = 8) {
  if (typeof ResizeObserver === 'undefined') return tabla;
  let ancho = 0;
  const desborda = () => [...tabla.querySelectorAll('tbody td, tbody th, tfoot td, tfoot th, input')].some((c) => c.offsetParent && c.scrollWidth > c.clientWidth + 1);
  const ajustar = () => {
    tabla.style.fontSize = '';
    const base = parseFloat(getComputedStyle(tabla).fontSize) || 12;
    let f = base;
    while (desborda() && f > minimo) { f -= 0.5; tabla.style.fontSize = `${f}px`; }
  };
  new ResizeObserver((entradas) => {
    const w = Math.round(entradas[0].contentRect.width);
    if (w && w !== ancho) { ancho = w; requestAnimationFrame(ajustar); }
  }).observe(tabla);
  return tabla;
}
