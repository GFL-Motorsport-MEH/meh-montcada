import { authHash } from './hash.js'; // debe ir el primero
import { h, clear, cargando, toast, hoyISO } from './ui.js';
import * as db from './db.js';
import { renderLogin, renderNuevaPassword, renderPendiente } from './views/auth.js';
import { renderPanel } from './views/panel.js';
import { renderGastos } from './views/gastos.js';
import { renderUsuarios } from './views/usuarios.js';

const root = document.getElementById('app');
const LS_CURSO = 'meh.curso';
const state = {
  session: null, perfil: null, cursos: [], cursosVisibles: [], taxonomia: [], cursoId: null,
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
  setGastos(cursoId, lista) { state.gastos.set(cursoId, lista); },
  invalidar(cursoId) { state.gastos.delete(cursoId); },
  cargarSugerencias() {
    if (state.sugerencias || state._cargandoSug) return;
    state._cargandoSug = true;
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

// ---------- rutas ----------
const RUTAS = {
  panel: { titulo: 'Panel', render: renderPanel },
  gastos: { titulo: 'Gastos', render: renderGastos },
  usuarios: { titulo: 'Usuarios', render: renderUsuarios, admin: true },
};
function rutaActual() {
  const r = (window.location.hash.match(/^#\/(\w+)/) || [])[1];
  if (!RUTAS[r] || (RUTAS[r].admin && !ctx.esAdmin())) return 'panel';
  return r;
}

let viewEl, tabsEl, cursoSel;
function pintarShell() {
  const p = state.perfil;
  cursoSel = h('select', { class: 'select-inline', 'aria-label': 'Curso', onchange: () => { state.cursoId = cursoSel.value; guardarCurso(); pintarVista(); } },
    [...state.cursosVisibles].reverse().map((c) => h('option', { value: c.id, selected: c.id === state.cursoId }, `Curso ${c.nombre}`)));
  tabsEl = h('nav', { class: 'tabs', 'aria-label': 'Secciones' });
  viewEl = h('main', { id: 'view', style: 'display:flex; flex-direction:column; gap:18px' });
  const inicial = (p.nombre || p.email || '?').trim().charAt(0).toUpperCase();
  clear(root, h('div', { class: 'page' },
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, 'M'),
        h('div', {}, h('div', { class: 'brand-name' }, 'My English House — Montcada'), h('div', { class: 'brand-sub' }, 'Gestión y contabilidad'))),
      h('div', { class: 'header-controls' }, cursoSel,
        h('div', { class: 'user-chip' }, h('span', { class: 'dot', 'aria-hidden': 'true' }, inicial),
          h('span', {}, `${p.nombre || p.email}${p.rol === 'admin' ? ' · admin' : ''}`),
          h('button', { class: 'btn ghost', onclick: () => renderNuevaPassword(root, { titulo: 'Cambiar contraseña', onDone: async () => { toast('Contraseña cambiada'); await arrancar(); }, onCancel: () => { pintarShell(); pintarVista(); } }) }, 'Contraseña'),
          h('button', { class: 'btn ghost', onclick: salir }, 'Salir')))),
    tabsEl, viewEl));
}

function pintarTabs(actual) {
  const tab = (id, label) => h('a', { class: 'tab', href: `#/${id}`, 'aria-current': id === actual ? 'page' : false }, label);
  const proximamente = (label) => h('span', { class: 'tab disabled', title: 'Próximamente' }, label, h('span', { class: 'soon' }, 'pronto'));
  clear(tabsEl, tab('panel', 'Panel'), tab('gastos', 'Gastos'), proximamente('Ingresos'), proximamente('Facturación'),
    ctx.esAdmin() ? tab('usuarios', 'Usuarios') : null);
}

let renderId = 0;
async function pintarVista() {
  const r = rutaActual();
  pintarTabs(r);
  document.title = `${RUTAS[r].titulo} · MEH Montcada`;
  const id = ++renderId;
  const tmp = h('div', { style: 'display:flex; flex-direction:column; gap:18px' });
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
  const [cursos, taxonomia] = await Promise.all([db.getCursos(), db.getTaxonomia()]);
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
  Object.assign(state, { session: null, perfil: null, cursos: [], cursosVisibles: [], taxonomia: [], cursoId: null, sugerencias: null, arrancado: false });
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
