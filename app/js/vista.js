// Estado de las vistas que se recuerda al refrescar (filtros, orden, vista elegida) + componentes de filtro comunes:
//  · vista(clave, defecto)  → objeto que se guarda solo en este navegador (por usuario) cada vez que se cambia una propiedad.
//  · filtroFecha(...)       → filtro de fechas: entre dos fechas, posterior a, anterior a o igual a.
//  · crearAviso(...)        → franja de «hay un filtro activo» con botón para quitarlos.
//  · vincular(f, k, el)     → une un campo del formulario con f[k] (valor inicial, cambios y «quitar filtros»).
import { h, clear, fmtFechaCorta } from './ui.js';

let uid = 'anon';
export const fijarUsuario = (id) => { uid = id || 'anon'; };
const clave = (c) => `meh.vista.${uid}.${c}`;

// ---------- valores sueltos (una vista elegida, un interruptor…) ----------
export function leerV(c, def) {
  try { const v = localStorage.getItem(clave(c)); if (v === null) return def; const x = JSON.parse(v); return typeof def === 'object' || typeof x === typeof def ? x : def; } catch { return def; }
}
export function guardarV(c, v) { try { localStorage.setItem(clave(c), JSON.stringify(v)); } catch { /* sin almacenamiento */ } }
export function borrarV(c) { try { localStorage.removeItem(clave(c)); } catch { /* sin almacenamiento */ } }

// ---------- objeto de estado persistente ----------
const REG = new WeakMap(); // proxy → { oyentes, defecto }
export function vista(c, defecto) {
  const datos = { ...defecto };
  let guardado = {};
  try { guardado = JSON.parse(localStorage.getItem(clave(c)) || '{}') || {}; } catch { /* */ }
  for (const k of Object.keys(defecto)) {
    if (!(k in guardado)) continue;
    const a = guardado[k], d = defecto[k];
    if (d === null || a === null ? true : typeof a === typeof d) datos[k] = a;
  }
  const oyentes = new Set();
  const p = new Proxy(datos, {
    set(o, k, v) {
      o[k] = v;
      guardarV(c, o);
      for (const fn of oyentes) { try { fn(k, v); } catch { /* */ } }
      return true;
    },
  });
  REG.set(p, { oyentes, defecto });
  return p;
}
export const escuchar = (f, fn) => { REG.get(f)?.oyentes.add(fn); };

// valor «sin filtro» de cada tipo
const neutro = (v) => (typeof v === 'boolean' ? false : v && typeof v === 'object' ? { ...FECHA_VACIA } : '');
export const FECHA_VACIA = { modo: 'entre', a: '', b: '' };

// ---------- filtro de fechas ----------
export const MODOS_FECHA = [['entre', 'Entre fechas'], ['despues', 'Posterior a'], ['antes', 'Anterior a'], ['igual', 'Igual a']];
export const fechaActiva = (d) => !!d && (d.modo === 'entre' || !d.modo ? !!(d.a || d.b) : !!d.a);
// valor: 'YYYY-MM-DD…' (o vacío). Sin filtro activo pasa todo; con filtro, lo que no tiene fecha no pasa.
export function pasaFecha(valor, d) {
  if (!fechaActiva(d)) return true;
  if (!valor) return false;
  const v = String(valor).slice(0, 10);
  switch (d.modo) {
    case 'despues': return v > d.a;
    case 'antes': return v < d.a;
    case 'igual': return v === d.a;
    default: return (!d.a || v >= d.a) && (!d.b || v <= d.b);
  }
}
// rango inclusivo {desde, hasta} (ISO o '') equivalente al filtro, para consultas al servidor
const mueve = (iso, dias) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + dias); return d.toISOString().slice(0, 10); };
export function rangoFecha(d) {
  if (!fechaActiva(d)) return { desde: '', hasta: '' };
  switch (d.modo) {
    case 'despues': return { desde: mueve(d.a, 1), hasta: '' };
    case 'antes': return { desde: '', hasta: mueve(d.a, -1) };
    case 'igual': return { desde: d.a, hasta: d.a };
    default: return { desde: d.a || '', hasta: d.b || '' };
  }
}
export function describirFecha(d) {
  if (!fechaActiva(d)) return '';
  const f = fmtFechaCorta;
  switch (d.modo) {
    case 'despues': return `posterior a ${f(d.a)}`;
    case 'antes': return `anterior a ${f(d.a)}`;
    case 'igual': return `el ${f(d.a)}`;
    default: return d.a && d.b ? `entre ${f(d.a)} y ${f(d.b)}` : d.a ? `desde ${f(d.a)}` : `hasta ${f(d.b)}`;
  }
}
// «dd/mm/aa», «dd/mm/aaaa» o ISO → ISO (para columnas de tablas que solo tienen el texto)
export function aISO(t) {
  const s = String(t ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  return m ? `${m[3].length === 2 ? 2000 + +m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

// Control de fecha. valor = { modo, a, b }. alCambiar(nuevo) se llama con un objeto nuevo cada vez.
// compacto: botón que abre un panelito (para cabeceras de tabla). .poner(nuevo) lo actualiza desde fuera.
export function filtroFecha(valor, alCambiar, { compacto = false, etiqueta = 'Fecha' } = {}) {
  let d = { ...FECHA_VACIA, ...(valor || {}) };
  const selModo = h('select', { 'aria-label': `${etiqueta}: tipo de filtro` }, MODOS_FECHA.map(([v, t]) => h('option', { value: v }, t)));
  const iA = h('input', { type: 'date', 'aria-label': `${etiqueta}: fecha` });
  const iB = h('input', { type: 'date', 'aria-label': `${etiqueta}: hasta` });
  const sep = h('span', { class: 'ffecha-y' }, 'y');
  const cuerpo = h('span', { class: 'ffecha-campos' }, selModo, iA, sep, iB);
  const btn = compacto ? h('button', { type: 'button', class: 'ffecha-btn', 'aria-haspopup': 'true', 'aria-label': `Filtro de ${etiqueta}` }) : null;
  const panel = compacto ? h('div', { class: 'ffecha-panel', hidden: true }, cuerpo,
    h('button', { type: 'button', class: 'link-btn small', onclick: () => cambiar({ ...FECHA_VACIA }) }, 'Quitar')) : null;
  const raiz = compacto ? h('span', { class: 'ffecha ffecha-compacto' }, btn, panel) : h('span', { class: 'ffecha' }, cuerpo);

  function pintar() {
    selModo.value = d.modo || 'entre'; iA.value = d.a || ''; iB.value = d.b || '';
    const entre = (d.modo || 'entre') === 'entre';
    iB.hidden = !entre; sep.hidden = !entre;
    iA.setAttribute('aria-label', `${etiqueta}: ${entre ? 'desde' : 'fecha'}`);
    raiz.classList.toggle('activo', fechaActiva(d));
    if (btn) btn.textContent = fechaActiva(d) ? describirFecha(d) : `${etiqueta}…`;
  }
  function cambiar(n) { d = n; pintar(); alCambiar?.({ ...d }); }
  selModo.addEventListener('change', () => cambiar({ modo: selModo.value, a: d.a, b: selModo.value === 'entre' ? d.b : '' }));
  iA.addEventListener('change', () => cambiar({ ...d, a: iA.value }));
  iB.addEventListener('change', () => cambiar({ ...d, b: iB.value }));
  if (btn) {
    const cerrar = (e) => { if (!raiz.contains(e.target)) { panel.hidden = true; document.removeEventListener('mousedown', cerrar); } };
    btn.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) document.addEventListener('mousedown', cerrar); });
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.hidden = true; });
  }
  raiz.poner = (n) => { d = { ...FECHA_VACIA, ...(n || {}) }; pintar(); };
  pintar();
  return raiz;
}

// ---------- unir campo ↔ f[k] ----------
// Pone el valor inicial, guarda en f[k] al cambiar y se actualiza si f[k] cambia desde fuera («quitar filtros»).
export function vincular(f, k, el) {
  const poner = () => {
    if (el.poner) el.poner(f[k]);
    else if (el.type === 'checkbox') el.checked = !!f[k];
    else el.value = f[k] ?? '';
  };
  poner();
  if (!el.poner) el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date' ? 'change' : 'input', () => { const v = el.type === 'checkbox' ? el.checked : el.value; if (f[k] !== v) f[k] = v; });
  escuchar(f, (kk) => { if (kk === k) poner(); });
  return el;
}

// ---------- aviso de filtro activo ----------
// obtener() → [[etiqueta, valor]] de lo que está filtrando ahora; limpiar() → lo quita todo. .actualizar() repinta.
export function crearAviso({ obtener, limpiar, si }) {
  const texto = h('span', { class: 'aviso-filtros-t' });
  const el = h('div', { class: 'aviso-filtros', role: 'status', hidden: true },
    h('span', { class: 'aviso-filtros-ico', 'aria-hidden': 'true' }, '⚠'), texto,
    h('button', { type: 'button', class: 'btn small', onclick: () => limpiar() }, 'Quitar filtros'));
  el.actualizar = () => {
    const lista = obtener().filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== false);
    el.hidden = !lista.length || (si ? !si() : false);
    clear(texto, h('strong', {}, lista.length === 1 ? 'Filtro activo: ' : `${lista.length} filtros activos: `),
      lista.map(([e, v], i) => [i ? ' · ' : '', e, v === true ? '' : ': ', v === true ? '' : h('em', {}, String(v))]));
  };
  el.actualizar();
  return el;
}

// Aviso para un objeto f creado con vista(): claves = las que son filtros; etiquetas/formato opcionales por clave.
// alLimpiar() debe volver a pintar la tabla.
export function avisoFiltros(f, { claves, etiquetas = {}, formato = {}, alLimpiar, extra, limpiarExtra, si } = {}) {
  const ks = claves || Object.keys(f);
  const obtener = () => [
    ...ks.map((k) => {
      const v = f[k];
      if (v && typeof v === 'object') return [etiquetas[k] || k, describirFecha(v)];
      return [etiquetas[k] || k, v === true ? true : v === '' || v === null || v === false ? '' : formato[k] ? formato[k](v) : v];
    }),
    ...(extra ? extra() : []),
  ];
  const limpiar = () => { for (const k of ks) if (f[k] !== neutro(f[k])) f[k] = neutro(f[k]); limpiarExtra?.(); alLimpiar?.(); aviso.actualizar(); };
  const aviso = crearAviso({ obtener, limpiar, si });
  escuchar(f, () => aviso.actualizar());
  return aviso;
}

// texto de una búsqueda para el aviso
export const busqueda = (v) => (String(v || '').trim() ? `«${String(v).trim()}»` : '');
