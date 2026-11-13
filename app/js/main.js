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
import './views/config-listas.js';
import './views/config-centros.js';
import './views/plantillas.js';
import './views/conciliacion.js';
import './views/factcheck.js';
import './views/notas-datos.js';

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
  async gastos(cursoId) {
    if (!state.gastos.has(cursoId)) state.gastos.set(cursoId, await db.getGastos(cursoId));
    return state.gastos.get(cursoId);
  },
  async ingresos(cursoId) {
    if (!state.ingresos.has(cursoId)) state.ingresos.set(cursoId, await db.getIngresos(cursoId));
    return state.ingresos.get(cursoId);
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
        h('div', {}, h('div', { class: 'brand-name' }, 'My English House — Montcada'), h('div', { class: 'brand-sub' }, 'Gestión y contabilidad'))),
      modulosEl,
      h('div', { class: 'header-controls' }, centroSelect(), cursoSel,
        h('div', { class: 'user-chip' }, h('span', { class: 'dot', 'aria-hidden': 'true' }, inicial),
          h('span', {}, `${p.nombre || p.email}${p.rol === 'admin' ? ' · admin' : ''}`),
          h('button', { class: 'btn ghost', onclick: () => renderNuevaPassword(root, { titulo: 'Cambiar contraseña', onDone: async () => { toast('Contraseña cambiada'); await arrancar(); }, onCancel: () => { pintarShell(); pintarVista(); } }) }, 'Contraseña'),
          botonTema(),
          h('button', { class: 'btn ghost', onclick: salir }, 'Salir')))),
    tabsEl);
  // altura de la cabecera fija, para que las cabeceras de las tablas se queden justo debajo
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => document.documentElement.style.setProperty('--cab', `${cabecera.offsetHeight}px`)).observe(cabecera);
}

function centroSelect() {
  if (state.centros.filter((c) => c.activo !== false).length < 2) return null;
  const sel = h('select', { class: 'select-inline', 'aria-label': 'Centro', onchange: () => { state.centroId = sel.value; try { localStorage.setItem(LS_CENTRO, sel.value); } catch { /* */ } pintarVista(); } },
    h('option', { value: '' }, 'Todos los centros'),
    state.centros.filter((c) => c.activo !== false || c.id === state.centroId).map((c) => h('option', { value: c.id, selected: c.id === state.centroId }, tituloCentro(c.nombre))));
  return sel;
}
// ---------- tema claro / oscuro (Auto = el del sistema) ----------
const LS_TEMA = 'meh.tema';
const TEMAS = [['auto', 'Tema automático (el del sistema)', 'Tema: auto'], ['light', 'Tema claro', 'Tema: claro'], ['dark', 'Tema oscuro', 'Tema: oscuro']];
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
  clear(tabsEl, tab('panel', 'Panel'), tab('gastos', 'Gastos'), tab('ingresos', 'Ingresos'), tab('balance', 'Balance'), tab('facturacion', 'Facturación'), tab('control', 'Control'), tab('config', 'Configuración'),
    ctx.esAdmin() ? tab('usuarios', 'Usuarios') : null);
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
    if (id === renderId) clear(viewEl, ...tmp.childNodes);
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
  const [cursos, taxonomia, centros] = await Promise.all([db.getCursos(), db.getTaxonomia(), db.getCentros().catch(() => [])]);
  state.centros = centros;
  try { const c = localStorage.getItem(LS_CENTRO); state.centroId = centros.some((x) => x.id === c) ? c : ''; } catch { state.centroId = ''; }
  const hoy = hoyISO();
  state.cursos = cursos;
  state.cursosVisibles = cursos.filter((c) => !c.fecha_inicio || c.fecha_inicio <= hoy);
  if (!state.cursosVisibles.length) state.cursosVisibles = cursos;
  state.taxonomia = taxonomia;
  state.cursoId = await elegirCurso();
  state.arrancado = true;
  if (/access_token=|type=/.test(window.location.hash)) history.replaceState(null, '', '#/panel');
  pintarShell();
  pintarVista();
}

async function salir() {
  await db.logout();
}

function reiniciarEstado() {
  Object.assign(state, { session: null, perfil: null, cursos: [], cursosVisibles: [], taxonomia: [], cursoId: null, sugerencias: null, empresas: null, centros: [], centroId: '', arrancado: false });
  state.gastos.clear(); state.ingresos.clear();
}

db.onAuthChange((event) => {
  if (event === 'SIGNED_OUT') { reiniciarEstado(); renderLogin(root, { onLogin: arrancar }); }
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
