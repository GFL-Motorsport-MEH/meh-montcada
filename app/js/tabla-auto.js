// Orden automático para cualquier tabla de listado: se pincha en la cabecera para ordenar (como en Excel).
// - Varias columnas: el último clic manda y los anteriores desempatan (ver orden-multi.js). Tercer clic en la principal la quita.
// - Se recuerda al refrescar (por usuario y por tabla). Si la tabla repinta sus filas, se vuelve a aplicar el orden.
// - Solo actúa en tablas «planas» (una fila de cabecera, filas con tantas celdas como columnas) que aún no se ordenan solas.
//   Para excluir una tabla: data-no-ordenar en el <table>.
import { leerV, guardarV } from './vista.js';
import * as om from './orden-multi.js';

const EXCLUIDAS = '.balance, .grid-ing, .resumen-trimestral, .matriz-roles, .ac-parrilla, .ac-matriz, .escaner-tabla, [data-no-ordenar]';
const hash = (t) => { let x = 5381; for (const c of t) x = ((x << 5) + x + c.charCodeAt(0)) >>> 0; return x.toString(36); };

// ---- valor de una celda: número, fecha o texto ----
function valorCelda(td) {
  const c = td.querySelector('input:not([type=checkbox]):not([type=radio]), select, textarea');
  if (td.querySelector('input[type=checkbox]') && !c) return td.querySelector('input[type=checkbox]').checked ? 1 : 0;
  let t = (c ? (c.tagName === 'SELECT' ? c.selectedOptions[0]?.textContent || '' : c.value) : td.textContent || '').replace(/\s+/g, ' ').trim();
  if (t === '' || t === '—' || t === '-' || t === '–') return null;
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\D.*)?$/);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return y * 10000 + Number(m[2]) * 100 + Number(m[1]); }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  const n = t.replace(/[€%\s ]|h$/g, '').replace('−', '-');
  if (/^[-+]?\d{1,3}(\.\d{3})*(,\d+)?$|^[-+]?\d+(,\d+)?$|^[-+]?\d+(\.\d+)?$/.test(n)) {
    const v = /,/.test(n) || /^[-+]?\d{1,3}(\.\d{3})+$/.test(n) ? Number(n.replace(/\./g, '').replace(',', '.')) : Number(n);
    if (Number.isFinite(v)) return v;
  }
  return t;
}
const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' }));

// ¿La tabla es de listado y sencilla? Devuelve la fila de cabecera y el nº de columnas, o null.
function analizar(tabla) {
  if (tabla.matches(EXCLUIDAS) || tabla.closest('[data-no-ordenar]')) return null;
  if (tabla.querySelector('thead th.sortable, thead th.ac-ord, thead th[aria-sort], thead th[data-ord]')) return null; // ya se ordena sola
  const filasCab = [...tabla.tHead?.rows || []];
  if (!filasCab.length || filasCab.length > 2) return null;
  const cab = filasCab.find((r) => r.cells.length >= 2 && !r.querySelector('input, select'))
    || null;
  if (!cab || [...cab.cells].some((c) => c.colSpan > 1 || c.rowSpan > 1)) return null;
  if (filasCab.length === 2 && !filasCab.some((r) => r !== cab && r.querySelector('input, select'))) return null; // dos cabeceras de texto: demasiado complejo
  const n = cab.cells.length;
  if (tabla.tBodies.length !== 1) return null;
  const filas = [...tabla.tBodies[0].rows];
  const buenas = filas.filter((r) => r.cells.length === n && ![...r.cells].some((c) => c.colSpan > 1));
  if (buenas.length < 2) return null;
  const malas = filas.filter((r) => !buenas.includes(r));
  if (malas.length && !(malas.length <= 1 && filas[filas.length - 1] === malas[0])) return null; // filas intercaladas (grupos, detalles): no se toca
  return { cab, n };
}

function activar(tabla) {
  const a = analizar(tabla);
  if (!a) return false;
  const { cab } = a;
  const cuerpo = tabla.tBodies[0];
  const titulo = (th) => (th.textContent || '').replace(/\s+/g, ' ').trim();
  const ths = [...cab.cells];
  const ordenables = ths.map((th) => titulo(th) !== '' && !th.querySelector('input[type=checkbox]'));
  if (ordenables.filter(Boolean).length < 2) return false;
  const clave = 'orden.' + hash(`${(location.hash || '').split('?')[0]}|${tabla.className}|${ths.map(titulo).join('|')}`);
  const porT = (t) => ths.findIndex((th, j) => ordenables[j] && titulo(th) === t);
  let pila = om.deGuardado(leerV(clave, []), porT);
  const flechas = ths.map((th, j) => {
    if (!ordenables[j]) return null;
    const f = document.createElement('span'); f.className = 'ord-flecha'; f.setAttribute('aria-hidden', 'true');
    th.append(' ', f);
    th.classList.add('sortable', 'ord-auto'); th.tabIndex = 0; th.title = th.title || 'Clic para ordenar';
    th.setAttribute('aria-sort', 'none');
    th.addEventListener('click', (e) => { if (e.target.closest('button, a, input, select, textarea, label')) return; pila = om.pulsar(pila, j, 1, true); guardarV(clave, om.aGuardar(pila, (k) => titulo(ths[k]))); aplicar(); });
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); } });
    return f;
  });
  let orig = new Map(); let aplicando = false; let n0 = 0;
  const obs = new MutationObserver(() => { if (!aplicando) aplicar(); });
  function aplicar() {
    aplicando = true;
    ths.forEach((th, j) => { if (flechas[j]) { flechas[j].textContent = om.flecha(pila, j) ? ' ' + om.flecha(pila, j) : ''; th.setAttribute('aria-sort', om.ariaSort(pila, j)); } });
    const filas = [...cuerpo.rows];
    for (const r of filas) if (!orig.has(r)) orig.set(r, n0++); // orden original (para volver a él al quitar el orden)
    const buenas = filas.filter((r) => r.cells.length === ths.length);
    const resto = filas.filter((r) => r.cells.length !== ths.length);
    let orden = buenas;
    if (pila.length) {
      const val = new Map(buenas.map((r) => [r, [...r.cells].map(valorCelda)]));
      orden = [...buenas].sort((x, y) => {
        for (const { k, dir } of pila) {
          const p = val.get(x)[k], q = val.get(y)[k];
          if (p === null || q === null) { if (p === null && q === null) continue; return p === null ? 1 : -1; } // vacíos siempre al final
          const r = cmp(p, q); if (r) return r * dir;
        }
        return orig.get(x) - orig.get(y);
      });
    } else orden = [...buenas].sort((x, y) => orig.get(x) - orig.get(y));
    const nuevo = [...orden, ...resto];
    if (nuevo.some((r, i) => r !== filas[i])) cuerpo.append(...nuevo);
    obs.takeRecords();
    aplicando = false;
  }
  aplicar();
  obs.observe(cuerpo, { childList: true });
  return true;
}

// Revisa las tablas de la pantalla cada vez que cambia el DOM (las vistas se pintan con clear(): no hay un único punto de entrada).
export function ordenAutomatico(raiz = document.body) {
  let pendiente = false;
  const revisar = () => {
    pendiente = false;
    for (const t of raiz.querySelectorAll('table.data:not([data-ord]), table.tbl:not([data-ord])')) {
      if (!t.tBodies[0] || t.tBodies[0].rows.length < 2) continue; // aún sin filas: se vuelve a mirar cuando cambie
      t.dataset.ord = activar(t) ? 'si' : 'no';
    }
  };
  new MutationObserver(() => { if (!pendiente) { pendiente = true; requestAnimationFrame(revisar); } }).observe(raiz, { childList: true, subtree: true });
  revisar();
}
