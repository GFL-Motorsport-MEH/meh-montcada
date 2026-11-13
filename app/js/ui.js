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
