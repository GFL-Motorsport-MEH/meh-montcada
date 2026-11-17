import { authHash } from './hash.js'; // debe ir el primero
import { h, clear, cargando, toast, hoyISO } from './ui.js';
import * as db from './db.js';
import { renderLogin, renderNuevaPassword, renderPendiente } from './views/auth.js';
import { renderPanel } from './views/panel.js';
import { renderGastos } from './views/gastos.js';
import { renderIngresos } from './views/ingresos.js';
import { renderUsuarios } from './views/usuarios.js';
import { renderBalance } from './views/balance.js';
import { renderFacturacion } from './views/facturacion.js';
import { renderControl } from './views/control.js';
import { renderConfig } from './views/config.js';
import { renderAcademia } from './views/academia.js';
import { renderEscanerVista } from './views/escaner-vista.js';
import * as historial from './deshacer.js';
import './views/config-listas.js';
import './views/config-centros.js';
import './views/plantillas.js';
import './views/conciliacion.js';
import './views/factcheck.js';
import './views/notas-datos.js';
import './views/gestoria.js';
import './views/historial.js';

const root = document.getElementById('app');
const LS_CURSO = 'meh.curso';
const LS_CENTRO = 'meh.centro';
const state = {
  session: null, perfil: null, cursos: [], cursosVisibles: [], taxonomia: [], cursoId: null, centros: [], centroId: '',
  gastos: new Map(), ingresos: new Map(), sugerencias: null, arrancado: false,
};

// ---------- contexto que reciben las vistas ----------
const ctx = {
  state,
  cursoActual: () => state.cursos.find((c) => c.id === state.cursoId),
  esAdmin: () => state.perfil?.rol === 'admin' && state.perfil?.activo,
  rol: () => (state.perfil?.activo ? state.perfil.rol : null),
  puedeEditar: () => ['admin', 'empleado'].includes(ctx.rol()),
  esEscaner: () => ctx.rol() === 'escaner',
  soloLectura: () => ctx.rol() === 'consulta',
  async gastos(cursoId) {
    if (!state.gastos.has(cursoId)) state.gastos.set(cursoId, await db.getGastos(cursoId));
    return state.gastos.get(cursoId);
  },
  async ingresos(cursoId) {
    if (!state.ingresos.has(cursoId)) state.ingresos.set(cursoId, await db.getIngresos(cursoId));
    return state.ingresos.get(cursoId);
  },
  // Olvida los datos cargados (p.ej. tras restaurar un cambio del historial) para que se vuelvan a leer
  limpiarCache() {
    state.gastos.clear(); state.ingresos.clear();
    Object.assign(state, { facturacion: null, movimientos: null, empresas: null, plantillas: null, sugerencias: null });
  },
  async empresas() {
    if (!state.empresas) state.empresas = await db.getEmpresas();
    return state.empresas;
  },
  // centro elegido arriba ('' = todos). Los gastos sin centro cuentan como del principal.
  centroActual: () => state.centros.find((c) => c.id === state.centroId) || null,
  centroPrincipal: () => state.centros.find((c) => c.principal) || state.centros[0] || null,
  filtrarCentro(lista) {
    if (!state.centroId) return lista;
    const principal = ctx.centroPrincipal()?.id;
    return lista.filter((g) => (g.centro_id || principal) === state.centroId);
  },
  // los ingresos todavía no tienen centro: son del principal
  ingresosDelCentro: (lista) => (!state.centroId || state.centroId === ctx.centroPrincipal()?.id ? lista : []),
  setGastos(cursoId, lista) { state.gastos.set(cursoId, lista); },
  invalidar(cursoId) { state.gastos.delete(cursoId); },
  cargarSugerencias() {
    if (state.sugerencias || state._cargandoSug) return;
    state._cargandoSug = true;
    ctx.empresas().catch(() => {});
    if (!state.listas) db.getListas().then((l) => { state.listas = l; }).catch(() => {});
    db.getSugerenciasGastos().then((filas) => {
      const top = (campo, n = 400) => {
        const cnt = new Map();
        for (const f of filas) { const v = (f[campo] || '').trim(); if (v) cnt.set(v, (cnt.get(v) || 0) + 1); }
        return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([v]) => v);
      };
      state.sugerencias = { tipo: top('tipo'), empresa: top('empresa'), periodicidad: top('periodicidad'), metodo_pago: top('metodo_pago') };
    }).catch(() => { /* las sugerencias son opcionales */ }).finally(() => { state._cargandoSug = false; });
  },
};

// ---------- módulos y rutas ----------
// Dos módulos principales: Facturación (contabilidad, en uso) y Academia (gestión diaria, en desarrollo).
const MODULOS = [
  { id: 'facturacion', titulo: 'Facturación', sub: 'Contabilidad y control', inicio: 'panel' },
  { id: 'academia', titulo: 'Academia', sub: 'Alumnos, horarios y pagos', inicio: 'academia' },
];
const RUTAS = {
  panel: { titulo: 'Panel', render: renderPanel, modulo: 'facturacion' },
  gastos: { titulo: 'Gastos', render: renderGastos, modulo: 'facturacion' },
  escaner: { titulo: 'Escáner', render: renderEscanerVista, modulo: 'facturacion' },
  ingresos: { titulo: 'Ingresos', render: renderIngresos, modulo: 'facturacion' },
  balance: { titulo: 'Balance', render: renderBalance, modulo: 'facturacion' },
  facturacion: { titulo: 'Facturación', render: renderFacturacion, modulo: 'facturacion' },
  control: { titulo: 'Control', render: renderControl, modulo: 'facturacion' },
  config: { titulo: 'Configuración', render: renderConfig, modulo: 'facturacion' },
  usuarios: { titulo: 'Usuarios', render: renderUsuarios, admin: true, modulo: 'facturacion' },
  academia: { titulo: 'Academia', render: renderAcademia, modulo: 'academia' },
};
const LS_RUTA = 'meh.ruta.';
function rutaActual() {
  const r = (window.location.hash.match(/^#\/(\w+)/) || [])[1];
  if (ctx.esEscaner()) return 'escaner'; // el usuario del escáner solo tiene esta pantalla
  if (!RUTAS[r] || (RUTAS[r].admin && !ctx.esAdmin())) return 'panel';
  return r;
}
function irAModulo(id) {
  const m = MODULOS.find((x) => x.id === id);
  let destino = m.inicio;
  try { const g = localStorage.getItem(LS_RUTA + id); if (RUTAS[g]?.modulo === id) destino = g; } catch { /* */ }
  window.location.hash = `#/${destino}`;
}

let viewEl, tabsEl, cursoSel, modulosEl;
function pintarShell() {
  const p = state.perfil;
  cursoSel = h('select', { class: 'select-inline', 'aria-label': 'Curso', onchange: () => { state.cursoId = cursoSel.value; guardarCurso(); pintarVista(); } },
    [...state.cursosVisibles].reverse().map((c) => h('option', { value: c.id, selected: c.id === state.cursoId }, `Curso ${c.nombre}`)));
  tabsEl = h('nav', { class: 'tabs', 'aria-label': 'Secciones' });
  modulosEl = h('nav', { class: 'modulos', 'aria-label': 'Módulos' });
  viewEl = h('main', { id: 'view', style: 'display:flex; flex-direction:column; gap:12px' });
  const inicial = (p.nombre || p.email || '?').trim().charAt(0).toUpperCase();
  const cabecera = h('div', { class: 'cabecera-fija' });
  clear(root, h('div', { class: 'page' }, cabecera, viewEl));
  clear(cabecera,
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, 'M'),
        h('div', {}, h('div', { class: 'brand-name' }, h('span', { class: 'nombre-largo' }, 'My English House — Montcada'), h('span', { class: 'nombre-corto' }, 'MEH Montcada')), h('div', { class: 'brand-sub' }, 'Gestión y contabilidad'))),
      ctx.esEscaner() ? null : modulosEl,
      h('div', { class: 'header-controls' }, ctx.esEscaner() ? null : centroSelect(), ctx.esEscaner() ? null : cursoSel,
        ctx.esEscaner() ? null : resumenEl,
        ctx.puedeEditar() ? botonDeshacer() : null,
        h('div', { class: 'user-chip' }, h('span', { class: 'dot', 'aria-hidden': 'true' }, inicial),
          h('span', { title: NOMBRE_ROL[p.rol] || p.rol }, `${p.nombre || p.email}${['consulta', 'escaner'].includes(p.rol) ? ' · ' + NOMBRE_ROL[p.rol].toLowerCase() : ''}`),
          h('button', { class: 'btn ghost', onclick: () => renderNuevaPassword(root, { titulo: 'Cambiar contraseña', onDone: async () => { toast('Contraseña cambiada'); await arrancar(); }, onCancel: () => { pintarShell(); pintarVista(); } }) }, 'Contraseña'),
          botonTema(),
          h('button', { class: 'btn ghost', onclick: salir }, 'Salir')))),
    tabsEl);
  // altura de la cabecera fija, para que las cabeceras de las tablas se queden justo debajo
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => document.documentElement.style.setProperty('--cab', `${cabecera.offsetHeight}px`)).observe(cabecera);
}

// ---------- deshacer (botón y Ctrl+Z) ----------
export const NOMBRE_ROL = { admin: 'Administrador', empleado: 'Gestión', consulta: 'Consulta', escaner: 'Solo escáner' };
let quitarDeshacer = null;
function botonDeshacer() {
  const b = h('button', { class: 'btn ghost btn-deshacer', type: 'button', onclick: () => ejecutarDeshacer() }, '↶ Deshacer');
  quitarDeshacer?.();
  quitarDeshacer = historial.suscribir((u) => {
    b.disabled = !u;
    b.title = u ? `Deshacer: ${u.texto} (Ctrl+Z)` : 'No hay nada que deshacer';
    b.setAttribute('aria-label', u ? `Deshacer: ${u.texto}` : 'Deshacer (no hay cambios)');
  });
  return b;
}
async function ejecutarDeshacer() {
  if (!historial.ultimo()) { toast('No hay nada que deshacer'); return; }
  try {
    const e = await historial.deshacer();
    if (e) toast(`Deshecho: ${e.texto}`);
  } catch (ex) { toast('No se ha podido deshacer: ' + ex.message, 'error'); }
}
historial.alTerminar(async () => {
  state.gastos.clear(); state.ingresos.clear(); state.facturacion = null;
  await pintarVista();
  actualizarPendientes();
});
// Ctrl+Z / Cmd+Z: dentro de un campo de texto deshace lo que se está escribiendo (lo normal del navegador);
// fuera de los campos, deshace el último cambio guardado.
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
  const t = document.activeElement;
  const escribiendo = t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'file'].includes(t.type)));
  if (escribiendo || !state.arrancado || !ctx.puedeEditar() || document.querySelector('.overlay')) return;
  e.preventDefault();
  ejecutarDeshacer();
});

// ---------- miniresumen del curso junto al selector de curso ----------
const resumenEl = h('div', { class: 'mini-resumen', 'aria-label': 'Resumen de gastos del curso' });
async function refrescarResumen() {
  if (!state.cursoId || ctx.esEscaner()) return;
  let l;
  try { l = ctx.filtrarCentro(await ctx.gastos(state.cursoId)); } catch { return; }
  const si = (v) => /^(true|1|x|verdadero|s[ií])$/i.test(String(v ?? '').trim());
  const datos = [
    ['revisar', 'Revisar', l.filter((g) => g.revisado === false).length, 'Añadidos por otra persona, pendientes de revisar'],
    ['sin_banca', 'Banco', l.filter((g) => !g.check_banca).length, 'Sin comprobar en el banco'],
    ['sin_gestoria', 'Gestoría', l.filter((g) => !si(g.fiscontal)).length, 'Sin enviar a la gestoría'],
    ['sin_link', 'Sin fra.', l.filter((g) => !g.link_factura && !g.sin_factura).length, 'Sin factura adjunta'],
    ['sin_pago', 'Sin pagar', l.filter((g) => !si(g.pago)).length, 'Pendientes de pago'],
  ];
  clear(resumenEl, datos.map(([k, t, n, title]) => h('button', { type: 'button', class: `mr mr-${k}` + (n ? '' : ' cero'), title: `${title}: ${n}. Clic para verlos en Gastos.`,
    onclick: () => { state.filtroInicial = k; if (window.location.hash.startsWith('#/gastos')) pintarVista(); else window.location.hash = '#/gastos'; } }, t, ' ', h('b', {}, String(n)))));
}
ctx.refrescarResumen = refrescarResumen;

// ---------- gastos pendientes de revisar (aviso en la pestaña) ----------
async function actualizarPendientes() {
  if (!ctx.puedeEditar() && !ctx.soloLectura()) return;
  const n = await db.contarPendientes().catch(() => 0);
  state.pendientes = n;
  document.querySelectorAll('.tab-badge-gastos').forEach((el) => { el.textContent = n ? String(n) : ''; el.hidden = !n; el.title = `${n} gastos pendientes de revisar`; });
}
ctx.actualizarPendientes = actualizarPendientes;
// cambia de curso (p.ej. desde el aviso de pendientes) y abre Gastos
ctx.irACurso = (cursoId, filtro) => {
  state.cursoId = cursoId; guardarCurso(); state.filtroInicial = filtro || null;
  pintarShell();
  if (window.location.hash.startsWith('#/gastos')) pintarVista(); else window.location.hash = '#/gastos';
};

function centroSelect() {
  if (state.centros.filter((c) => c.activo !== false).length < 2) return null;
  const sel = h('select', { class: 'select-inline', 'aria-label': 'Centro', onchange: () => { state.centroId = sel.value; try { localStorage.setItem(LS_CENTRO, sel.value); } catch { /* */ } pintarVista(); } },
    h('option', { value: '' }, 'Todos los centros'),
    state.centros.filter((c) => c.activo !== false || c.id === state.centroId).map((c) => h('option', { value: c.id, selected: c.id === state.centroId }, tituloCentro(c.nombre))));
  return sel;
}
// ---------- tema claro / oscuro (Auto = el del sistema) ----------
const LS_TEMA = 'meh.tema';
const TEMAS = [['auto', 'Tema automático (el del sistema)', '◐ Tema'], ['light', 'Tema claro', '☀ Claro'], ['dark', 'Tema oscuro', '☾ Oscuro']];
function aplicarTema(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
function temaGuardado() { try { return localStorage.getItem(LS_TEMA) || 'auto'; } catch { return 'auto'; } }
aplicarTema(temaGuardado());
function botonTema() {
  const b = h('button', { class: 'btn ghost btn-tema', type: 'button' });
  const pintar = () => { const t = TEMAS.find((x) => x[0] === temaGuardado()) || TEMAS[0]; b.textContent = t[2]; b.title = `${t[1]} · clic para cambiar`; b.setAttribute('aria-label', t[1]); };
  b.addEventListener('click', () => {
    const i = TEMAS.findIndex((x) => x[0] === temaGuardado());
    const nuevo = TEMAS[(i + 1) % TEMAS.length][0];
    try { localStorage.setItem(LS_TEMA, nuevo); } catch { /* */ }
    aplicarTema(nuevo); pintar();
  });
  pintar();
  return b;
}
export const tituloCentro = (s) => (s || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
ctx.tituloCentro = tituloCentro;
ctx.repintarCabecera = () => { pintarShell(); pintarVista(); };

function pintarTabs(actual) {
  const modulo = RUTAS[actual].modulo;
  try { localStorage.setItem(LS_RUTA + modulo, actual); } catch { /* */ }
  clear(modulosEl, MODULOS.map((m) => h('button', { type: 'button', class: 'modulo', 'aria-pressed': String(m.id === modulo), title: m.sub, onclick: () => irAModulo(m.id) },
    h('span', { class: 'modulo-titulo' }, m.titulo), m.id === 'academia' ? h('span', { class: 'soon' }, 'en desarrollo') : null)));
  const tab = (id, label) => h('a', { class: 'tab', href: `#/${id}`, 'aria-current': id === actual ? 'page' : false }, label);
  const proximamente = (label) => h('span', { class: 'tab disabled', title: 'Próximamente' }, label, h('span', { class: 'soon' }, 'pronto'));
  if (modulo === 'academia') {
    clear(tabsEl, tab('academia', 'Resumen'), proximamente('Alumnos'), proximamente('Grupos y horarios'), proximamente('Pagos'), proximamente('Asistencia'), proximamente('Profesores'));
    return;
  }
  if (ctx.esEscaner()) { clear(tabsEl, tab('escaner', 'Escáner')); return; }
  const badge = h('span', { class: 'tab-badge tab-badge-gastos', hidden: !state.pendientes, title: `${state.pendientes || 0} gastos pendientes de revisar` }, state.pendientes ? String(state.pendientes) : '');
  clear(tabsEl, tab('panel', 'Panel'), h('a', { class: 'tab', href: '#/gastos', 'aria-current': actual === 'gastos' ? 'page' : false }, 'Gastos', badge), ctx.soloLectura() ? null : tab('escaner', 'Escáner'), tab('ingresos', 'Ingresos'), tab('balance', 'Balance'), tab('facturacion', 'Facturación'), tab('control', 'Control'), ctx.soloLectura() ? null : tab('config', 'Configuración'),
    ctx.esAdmin() ? tab('usuarios', 'Usuarios') : null);
}

// rol «Consulta»: se ve todo pero no se puede cambiar nada (la base de datos tampoco lo permite)
const SELECTOR_EDICION = 'input.gc, select.gc, input.cell, select.select-celda, textarea, table input[type=checkbox]:not([aria-label^="Seleccionar"]), .btn.primary, .section-actions .btn, .subir-factura button, input[type=file]';
function bloquearEdicion(raiz) {
  const aplicar = () => raiz.querySelectorAll(SELECTOR_EDICION).forEach((el) => { if (!el.closest('.filters, .fila-filtros, [role=tablist]') && !/Exportar/i.test(el.textContent || '')) el.disabled = true; });
  aplicar();
  new MutationObserver(aplicar).observe(raiz, { childList: true, subtree: true });
}

let renderId = 0;
async function pintarVista() {
  const r = rutaActual();
  pintarTabs(r);
  document.title = `${RUTAS[r].titulo} · MEH Montcada`;
  document.body.dataset.modulo = RUTAS[r].modulo;
  const id = ++renderId;
  const tmp = h('div', { style: 'display:flex; flex-direction:column; gap:12px' });
  clear(viewEl, cargando());
  try {
    await RUTAS[r].render(tmp, ctx);
    if (id === renderId) { clear(viewEl, ...tmp.childNodes); if (ctx.soloLectura()) bloquearEdicion(viewEl); refrescarResumen(); }
  } catch (ex) {
    if (id !== renderId) return;
    console.error(ex);
    clear(viewEl, h('div', { class: 'banner error', role: 'alert' }, 'No se han podido cargar los datos: ', ex.message, ' ',
      h('button', { class: 'link-btn', onclick: () => { state.gastos.clear(); state.ingresos.clear(); pintarVista(); } }, 'Reintentar')));
  }
}
window.addEventListener('hashchange', () => { if (state.arrancado) pintarVista(); });

function guardarCurso() { try { localStorage.setItem(LS_CURSO, state.cursoId); } catch { /* sin almacenamiento */ } }
function leerCurso() { try { return localStorage.getItem(LS_CURSO); } catch { return null; } }

async function elegirCurso() {
  const guardado = leerCurso();
  if (state.cursosVisibles.some((c) => c.id === guardado)) return guardado;
  // el curso más reciente que ya tenga gastos (el actual puede estar vacío al empezar)
  for (const c of [...state.cursosVisibles].reverse()) {
    if ((await ctx.gastos(c.id)).length) return c.id;
  }
  return state.cursosVisibles.at(-1)?.id;
}

// ---------- arranque ----------
async function arrancar() {
  clear(root, cargando('Entrando…'));
  const session = await db.getSession();
  if (!session) return renderLogin(root, { onLogin: arrancar });
  state.session = session;
  const perfil = await db.getPerfil(session.user.id);
  if (!perfil || !perfil.activo) {
    return renderPendiente(root, { email: session.user.email, onReintentar: arrancar });
  }
  state.perfil = perfil;
  if (perfil.debe_cambiar_password) {
    return renderNuevaPassword(root, {
      titulo: 'Tu contraseña es provisional: elige una nueva',
      onDone: async () => { await db.passwordCambiada(); toast('Contraseña guardada'); await arrancar(); },
    });
  }
  document.body.classList.toggle('solo-lectura', ctx.soloLectura());
  document.body.classList.toggle('rol-escaner', ctx.esEscaner());
  const [cursos, taxonomia, centros] = await Promise.all([db.getCursos(), db.getTaxonomia(), db.getCentros().catch(() => [])]);
  state.centros = centros;
  try { const c = localStorage.getItem(LS_CENTRO); state.centroId = centros.some((x) => x.id === c) ? c : ''; } catch { state.centroId = ''; }
  const hoy = hoyISO();
  state.cursos = cursos;
  state.cursosVisibles = cursos.filter((c) => !c.fecha_inicio || c.fecha_inicio <= hoy);
  if (!state.cursosVisibles.length) state.cursosVisibles = cursos;
  state.taxonomia = taxonomia;
  state.cursoId = ctx.esEscaner() ? (cursos.find((c) => c.fecha_inicio <= hoy && hoy <= c.fecha_fin) || state.cursosVisibles.at(-1))?.id : await elegirCurso();
  state.arrancado = true;
  historial.vaciar();
  if (/access_token=|type=/.test(window.location.hash)) history.replaceState(null, '', '#/panel');
  pintarShell();
  pintarVista();
  actualizarPendientes();
}

async function salir() {
  await db.logout();
}

function reiniciarEstado() {
  Object.assign(state, { session: null, perfil: null, cursos: [], cursosVisibles: [], taxonomia: [], cursoId: null, sugerencias: null, empresas: null, centros: [], centroId: '', arrancado: false });
  state.gastos.clear(); state.ingresos.clear();
}

db.onAuthChange((event) => {
  if (event === 'SIGNED_OUT') { reiniciarEstado(); historial.vaciar(); renderLogin(root, { onLogin: arrancar }); }
  if (event === 'PASSWORD_RECOVERY') {
    renderNuevaPassword(root, { titulo: 'Elige una contraseña nueva', onDone: async () => { toast('Contraseña cambiada'); await arrancar(); } });
  }
});

async function inicio() {
  try {
    if (authHash.error) {
      const caducado = /expired/i.test(authHash.errorCode || authHash.errorDescription || '');
      history.replaceState(null, '', window.location.pathname);
      return renderLogin(root, {
        onLogin: arrancar,
        error: caducado ? 'El enlace del email ha caducado o ya se usó. Pide otro con “¿Has olvidado la contraseña?”.' : `No se ha podido completar el acceso: ${authHash.errorDescription || authHash.error}`,
      });
    }
    if (authHash.type === 'invite' || authHash.type === 'recovery') {
      const session = await db.getSession();
      if (session) {
        return renderNuevaPassword(root, {
          titulo: authHash.type === 'invite' ? 'Bienvenido/a: elige tu contraseña' : 'Elige una contraseña nueva',
          onDone: async () => { history.replaceState(null, '', '#/panel'); toast('Contraseña guardada'); await arrancar(); },
        });
      }
    }
    await arrancar();
  } catch (ex) {
    console.error(ex);
    clear(root, h('div', { class: 'auth-wrap' }, h('div', { class: 'card auth-card' },
      h('h2', {}, 'No se ha podido conectar'), h('div', { class: 'banner error' }, ex.message),
      h('button', { class: 'btn primary', onclick: () => window.location.reload() }, 'Reintentar'))));
  }
}
inicio();
