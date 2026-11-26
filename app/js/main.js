import { authHash } from './hash.js'; // debe ir el primero
import { h, clear, cargando, toast, hoyISO } from './ui.js';
import { cargarOrdenes } from './orden-compartido.js';
import { fijarUsuario } from './vista.js';
import { ordenAutomatico } from './tabla-auto.js';
import * as db from './db.js';
import { renderLogin, renderNuevaPassword, renderPendiente } from './views/auth.js';
import { renderPanel } from './views/panel.js';
import { renderGastos } from './views/gastos.js';
import { renderIngresos, ingresosConPagos } from './views/ingresos.js';
import { renderUsuarios } from './views/usuarios.js';
import { renderBalance } from './views/balance.js';
import { renderFacturacion } from './views/facturacion.js';
import { renderAjustes } from './views/ajustes.js';
import { cargarAjustes, ajustes, alCambiarAjustes } from './ajustes.js';
import { renderControl } from './views/control.js';
import { renderConfig } from './views/config.js';
import { RUTAS_ACADEMIA, TABS_ACADEMIA } from './academia/index.js';
import { RUTAS_TRABAJADORES, TABS_TRABAJADORES } from './trabajadores/index.js';
import { RUTAS_ALUMNOS, TABS_ALUMNOS } from './alumnos/index.js';
import { precargar as precargarAcademia, refrescarTodo as refrescarAcademia, setCentro } from './academia/api.js';
import * as acadApi from './academia/api.js';
import { renderEscanerVista } from './views/escaner-vista.js';
import * as historial from './deshacer.js';
import { crearPermisos } from './permisos.js';
import './views/config-listas.js';
import './views/config-centros.js';
import './views/config-cuotas.js';
import './views/config-onedrive.js';
import * as onedrive from './onedrive.js';
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
  roles: [], permisos: crearPermisos(null, []),
};

// ---------- contexto que reciben las vistas ----------
const ctx = {
  state,
  cursoActual: () => state.cursos.find((c) => c.id === state.cursoId),
  esAdmin: () => state.perfil?.rol === 'admin' && state.perfil?.activo,
  rol: () => (state.perfil?.activo ? state.perfil.rol : null),
  // permisos del rol (se cargan al entrar; ver permisos.js). ve = ve todo · propio = solo lo suyo · veAlgo = lo suyo o todo
  alcance: (k) => state.permisos.alcance(k),
  ve: (k) => state.permisos.ve(k),
  propio: (k) => state.permisos.propio(k),
  veAlgo: (k) => state.permisos.veAlgo(k),
  edita: (k) => state.permisos.edita(k),
  puedeEditar: () => ctx.edita('fact'), // contabilidad (Facturación)
  soloEscaner: () => ctx.veAlgo('escaner') && !ctx.veAlgo('fact') && !state.permisos.algunoAcademia(),
  soloLectura: () => ctx.veAlgo('fact') && !ctx.edita('fact'),
  // la ficha de profesora enlazada a este usuario (para «lo suyo»)
  miProfesora: (profes) => (profes || []).find((p) => p.profile_id === state.perfil?.id) || null,
  async gastos(cursoId) {
    if (!state.gastos.has(cursoId)) state.gastos.set(cursoId, await db.getGastos(cursoId));
    return state.gastos.get(cursoId);
  },
  async ingresos(cursoId) {
    if (!state.ingresos.has(cursoId)) state.ingresos.set(cursoId, await db.getIngresos(cursoId));
    return state.ingresos.get(cursoId);
  },
  // ingresos del curso con lo cobrado en Pagos aplicado (Balance, Panel…)
  async ingresosPagos(cursoId, cursoNombre) { return ingresosConPagos(await ctx.ingresos(cursoId), cursoId, cursoNombre); },
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
// Cuatro módulos: Facturación (contabilidad), Academia (gestión diaria), Trabajadores (portal del trabajador, contratos, horas y documentos) y Alumnos (ficha, notas, informes y documentación de las familias; base del portal de padres).
const MODULOS = [
  { id: 'facturacion', titulo: 'Facturación', sub: 'Contabilidad, cobros y control', inicio: 'panel' },
  { id: 'academia', titulo: 'Academia', sub: 'Alumnos, horarios y seguimiento', inicio: 'ac_alumnos' },
  { id: 'trabajadores', titulo: 'Trabajadores', sub: 'Portal, contratos, horas y documentos', inicio: 'tr_portal' },
  { id: 'alumnos', titulo: 'Alumnos', sub: 'Ficha, notas, informes y familias', inicio: 'al_ficha' },
];
// perm = permiso que da acceso a la pantalla (ver permisos.js); edita = hace falta poder editar
async function renderSinAcceso(view) {
  clear(view, h('div', { class: 'card empty' }, h('h3', {}, 'Todavía no tienes secciones asignadas'),
    h('p', {}, 'Tu rol no tiene ningún permiso activo. Pide a un administrador que lo configure en Usuarios > Permisos de los roles.')));
}
let ultimoModulo = 'facturacion';
const RUTAS = {
  panel: { titulo: 'Panel', render: renderPanel, modulo: 'facturacion', perm: 'fact' },
  gastos: { titulo: 'Gastos', render: renderGastos, modulo: 'facturacion', perm: 'fact' },
  escaner: { titulo: 'Escáner', render: renderEscanerVista, modulo: 'facturacion', perm: 'escaner' },
  ingresos: { titulo: 'Ingresos', render: renderIngresos, modulo: 'facturacion', perm: 'fact' },
  balance: { titulo: 'Balance', render: renderBalance, modulo: 'facturacion', perm: 'fact' },
  facturacion: { titulo: 'Facturación', render: renderFacturacion, modulo: 'facturacion', perm: 'fact' },
  control: { titulo: 'Control', render: renderControl, modulo: 'facturacion', perm: 'fact' },
  config: { titulo: 'Listados y datos', render: renderConfig, modulo: 'facturacion', perm: 'fact', edita: true },
  // Configuración (ajustes de la app) es común a todos los módulos: se muestra dentro del último módulo en el que estabas
  ajustes: { titulo: 'Configuración', render: renderAjustes, get modulo() { return ultimoModulo; } },
  usuarios: { titulo: 'Usuarios', render: renderUsuarios, admin: true, modulo: 'facturacion' },
  sin_acceso: { titulo: 'Sin acceso', render: renderSinAcceso, modulo: 'facturacion' },
  ...RUTAS_ACADEMIA, // módulo Academia (todo su código está en js/academia/)
  ...RUTAS_TRABAJADORES, // módulo Trabajadores (js/trabajadores/)
  ...RUTAS_ALUMNOS, // módulo Alumnos (js/alumnos/)
};
function puedeRuta(r) {
  const x = RUTAS[r];
  if (!x) return false;
  if (r === 'ajustes') return !ctx.soloEscaner();
  if (x.admin) return ctx.esAdmin();
  if (x.alguno) return x.alguno.some((k) => ctx.veAlgo(k)); // Trabajadores: acceso (lo suyo o todo) a alguno de estos permisos
  if (x.todo) return x.todo.some((k) => ctx.ve(k)); // Trabajadores: ver lo de todos en alguno
  if (!x.perm) return true;
  return x.edita ? ctx.edita(x.perm) : ctx.veAlgo(x.perm);
}
// primera pantalla de un módulo a la que este usuario puede entrar
function primeraRuta(modulo) {
  const orden = modulo === 'academia' ? TABS_ACADEMIA.map((t) => t[0]) : modulo === 'trabajadores' ? TABS_TRABAJADORES.map((t) => t[0]) : modulo === 'alumnos' ? TABS_ALUMNOS.map((t) => t[0]) : ['panel', 'gastos', 'escaner', 'ingresos', 'ac_pagos', 'ac_remesas', 'facturacion', 'balance', 'control', 'config', 'usuarios'];
  return orden.find(puedeRuta) || null;
}
// Ingresos tiene dos sub-pestañas: Resumen de Pagos (la cuadrícula, que se rellena con los pagos marcados en Pagos) y Facturación.
// Pagos y Remesas son pestañas propias porque llevan un permiso exclusivo (ver permisos.js).
const SUBTABS_INGRESOS = [['ingresos', 'Resumen de Pagos'], ['facturacion', 'Facturación']];
const subtabDe = (ruta) => ruta;
const TABS_COBROS = [['ac_pagos', 'Pagos'], ['ac_remesas', 'Remesas']];
const enIngresos = (ruta) => SUBTABS_INGRESOS.some(([id]) => id === subtabDe(ruta));
const modulosVisibles = () => MODULOS.filter((m) => primeraRuta(m.id));
const LS_RUTA = 'meh.ruta.';
function rutaActual() {
  let r = (window.location.hash.match(/^#\/(\w+)/) || [])[1];
  if (r === 'academia') r = 'ac_alumnos'; // enlace antiguo: el Resumen pasó a Facturación
  if (r === 'ac_portal') r = 'tr_documentos'; // «Mi portal» ya no está en Academia: pasó al módulo Trabajadores
  if (r === 'ac_resumen') r = 'ingresos'; // el Resumen de Pagos ahora es el Resumen de Ingresos
  if (RUTAS[r] && puedeRuta(r)) return r;
  const mismo = RUTAS[r] && primeraRuta(RUTAS[r].modulo); // pantalla sin permiso de un módulo al que sí tiene acceso: a la primera de ese módulo
  if (mismo) return mismo;
  // sin permiso (o ruta que no existe): a la primera pantalla que le toca
  return (ctx.veAlgo('fact') && primeraRuta('facturacion')) || primeraRuta('academia') || primeraRuta('trabajadores') || primeraRuta('alumnos') || primeraRuta('facturacion') || 'sin_acceso';
}
function irAModulo(id) {
  let destino = primeraRuta(id);
  try { const g = localStorage.getItem(LS_RUTA + id); if (RUTAS[g]?.modulo === id && puedeRuta(g)) destino = g; } catch { /* */ }
  if (destino) window.location.hash = `#/${destino}`;
}

let viewEl, tabsEl, subTabsEl, cursoSel, modulosEl, avisoFormEl;
function pintarShell() {
  const p = state.perfil;
  cursoSel = h('select', { class: 'select-inline', 'aria-label': 'Curso', onchange: () => { state.cursoId = cursoSel.value; guardarCurso(); pintarVista(); } },
    [...state.cursosVisibles].reverse().map((c) => h('option', { value: c.id, selected: c.id === state.cursoId }, `Curso ${c.nombre}`)));
  tabsEl = h('nav', { class: 'tabs', 'aria-label': 'Secciones' });
  subTabsEl = h('nav', { class: 'subtabs', 'aria-label': 'Ingresos', hidden: true });
  modulosEl = h('nav', { class: 'modulos', 'aria-label': 'Módulos' });
  viewEl = h('main', { id: 'view', style: 'display:flex; flex-direction:column; gap:12px' });
  const inicial = (p.nombre || p.email || '?').trim().charAt(0).toUpperCase();
  const cabecera = h('div', { class: 'cabecera-fija' });
  avisoFormEl = h('div', { class: 'banner aviso-form', role: 'status', hidden: true });
  clear(root, h('div', { class: 'page' }, cabecera, avisoFormEl, viewEl));
  clear(cabecera,
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, 'M'),
        h('div', {}, h('div', { class: 'brand-name' }, h('span', { class: 'nombre-largo' }, 'My English House — Montcada'), h('span', { class: 'nombre-corto' }, 'MEH Montcada')), h('div', { class: 'brand-sub' }, 'Gestión y contabilidad'))),
      ctx.soloEscaner() ? null : modulosEl,
      h('div', { class: 'header-controls' }, ctx.soloEscaner() ? null : centroSelect(), ctx.soloEscaner() ? null : cursoSel,
        ctx.puedeEditar() ? botonDeshacer() : null,
        h('button', { class: 'btn ghost', type: 'button', id: 'btn-nueva-ventana', title: 'Abrir esta misma pantalla en otra ventana', 'aria-label': 'Abrir en una ventana nueva', onclick: () => window.open(location.href, '_blank', 'noopener') }, '⧉ Nueva ventana'),
        h('div', { class: 'user-chip' }, h('span', { class: 'dot', 'aria-hidden': 'true' }, inicial),
          h('span', { title: nombreRol(p.rol) }, `${p.nombre || p.email}${p.rol !== 'admin' ? ' · ' + nombreRol(p.rol).toLowerCase() : ''}`),
          h('button', { class: 'btn ghost', onclick: () => renderNuevaPassword(root, { titulo: 'Cambiar contraseña', onDone: async () => { toast('Contraseña cambiada'); await arrancar(); }, onCancel: () => { pintarShell(); pintarVista(); } }) }, 'Contraseña'),
          botonTema(),
          h('button', { class: 'btn ghost', onclick: salir }, 'Salir')))),
    tabsEl, subTabsEl, ctx.veAlgo('fact') ? resumenEl : null);
  // altura de la cabecera fija, para que las cabeceras de las tablas se queden justo debajo
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => document.documentElement.style.setProperty('--cab', `${cabecera.offsetHeight}px`)).observe(cabecera);
}

// ---------- deshacer (botón y Ctrl+Z) ----------
const nombreRol = (rol) => state.roles.find((r) => r.rol === rol)?.nombre || (rol === 'admin' ? 'Administrador' : rol);
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
  if (!state.cursoId || !ctx.veAlgo('fact')) return;
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
  if (!ctx.veAlgo('fact')) return;
  const n = await db.contarPendientes().catch(() => 0);
  state.pendientes = n;
  document.querySelectorAll('.tab-badge-gastos').forEach((el) => { el.textContent = n ? String(n) : ''; el.hidden = !n; el.title = `${n} gastos pendientes de revisar`; });
}
ctx.actualizarPendientes = actualizarPendientes;

// ---------- respuestas de formularios sin abrir (aviso en la parte superior de todas las pantallas) ----------
async function actualizarAvisoFormularios() {
  if (!avisoFormEl) return;
  const n = ctx.ve('ac_formularios') ? await acadApi.contarFormNuevas().catch(() => 0) : 0;
  avisoFormEl.hidden = !n;
  if (!n) return;
  clear(avisoFormEl, h('strong', {}, n === 1 ? 'Hay 1 respuesta nueva de un formulario sin abrir.' : `Hay ${n} respuestas nuevas de formularios sin abrir.`), ' ',
    h('a', { href: '#/ac_formularios' }, 'Ver respuestas'));
}
ctx.actualizarAvisoFormularios = actualizarAvisoFormularios;
// cambia de curso (p.ej. desde el aviso de pendientes) y abre Gastos
ctx.irACurso = (cursoId, filtro) => {
  state.cursoId = cursoId; guardarCurso(); state.filtroInicial = filtro || null;
  pintarShell();
  if (window.location.hash.startsWith('#/gastos')) pintarVista(); else window.location.hash = '#/gastos';
};

// el centro activo condiciona las lecturas de Academia (y Trabajadores): hay que avisar a la capa de datos cada vez que cambie
function aplicarCentro() { setCentro(state.centroId, ctx.centroPrincipal()?.id); }
function centroSelect() {
  if (state.perfil?.centro_id) {
    const c = state.centros.find((x) => x.id === state.perfil.centro_id);
    return c ? h('span', { class: 'pill', title: 'Tu acceso está limitado a este centro' }, tituloCentro(c.nombre)) : null;
  }
  if (state.centros.filter((c) => c.activo !== false).length < 2) return null;
  const sel = h('select', { class: 'select-inline', 'aria-label': 'Centro', onchange: () => { state.centroId = sel.value; try { localStorage.setItem(LS_CENTRO, sel.value); } catch { /* */ } aplicarCentro(); pintarVista(); } },
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

// color pastel de cada pestaña (solo para ir asociando color y sección; se reparte por el nombre, no por la posición)
const COLOR_PESTANA = {
  Panel: '#9db4e8', Gastos: '#f2b5a0', 'Escáner': '#b7a6e0', Ingresos: '#9fd4b0', Pagos: '#f0d58a', Remesas: '#8fcfd6', Balance: '#e8a9c4', Control: '#b5c98a', 'Configuración': '#c2c6cc', 'Listados y datos': '#c8cfa0', Usuarios: '#d4b99a',
  Alumnos: '#9db4e8', Seguimiento: '#b7a6e0', 'Tutorías': '#8fcfd6', Bajas: '#f2b5a0', Grupos: '#9fd4b0', Horarios: '#f0d58a', Calendario: '#e8a9c4', Recogidas: '#b5c98a', Tareas: '#d4b99a',
  'Biblioteca y Mascotas': '#a9c6e0', Protocolos: '#c2c6cc', Programaciones: '#e8c19a',
  'Mi portal': '#c9b6e4', 'Contrato y horario': '#9db4e8', 'Bolsa de horas': '#f0d58a', Documentos: '#8fcfd6', Equipo: '#b5c98a',
  Ficha: '#9db4e8', Notas: '#f0d58a', 'Tareas y material': '#9fd4b0', 'Informes y notas': '#b7a6e0', Comunicaciones: '#8fcfd6', 'Documentación': '#e8a9c4', Actividades: '#e8c19a',
};
function colorearTabs() {
  const A = ajustes();
  tabsEl.querySelectorAll('.tab').forEach((t) => {
    const n = (t.firstChild?.textContent || '').trim();
    const c = A.colorTabs === false ? null : (A.coloresTabs && A.coloresTabs[n]) || COLOR_PESTANA[n];
    if (c) t.style.setProperty('--tc', c); else t.style.removeProperty('--tc');
  });
}
alCambiarAjustes(() => { if (state.arrancado) colorearTabs(); });
// pestañas de cada módulo que este usuario puede abrir (para elegir su color en Configuración)
ctx.pestanasPorModulo = () => {
  const fact = [['panel', 'Panel'], ['gastos', 'Gastos'], ['escaner', 'Escáner'], ['ingresos', 'Ingresos'], ...TABS_COBROS, ['balance', 'Balance'], ['control', 'Control'], ['config', 'Listados y datos'], ['usuarios', 'Usuarios']];
  const pack = (m, lista) => ({ titulo: m.titulo, nombres: lista.filter(([id]) => puedeRuta(id)).map(([, n]) => n) });
  return [pack(MODULOS[0], fact), pack(MODULOS[1], TABS_ACADEMIA), pack(MODULOS[2], TABS_TRABAJADORES), pack(MODULOS[3], TABS_ALUMNOS)].filter((g) => g.nombres.length)
    .map((g, i, a) => (i === a.length - 1 ? { ...g, nombres: [...g.nombres, 'Configuración'] } : g));
};
ctx.colorPestanaBase = (n) => COLOR_PESTANA[n];
ctx.modulosDisponibles = () => modulosVisibles();
ctx.restaurarOrdenPestanas = () => {
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('meh.tabs.')) localStorage.removeItem(k); } } catch { /* */ }
  prefsTabs = {}; db.setPrefsTabs({}).catch(() => {}); pintarTabs('ajustes');
};
// orden de pestañas a gusto de cada persona: se arrastran con el ratón y se recuerda en este navegador (una lista por módulo)
const nombreTab = (t) => (t.firstChild?.textContent || '').trim();
let prefsTabs = {}; // orden de pestañas por módulo, guardado en el servidor para el usuario
async function cargarPrefsTabs() {
  const remoto = await db.getPrefsTabs().catch(() => null);
  if (remoto) {
    prefsTabs = remoto;
    for (const [m, v] of Object.entries(remoto)) { try { localStorage.setItem(`meh.tabs.${m}`, JSON.stringify(v)); } catch { /* */ } }
    // lo que ya no está en el servidor se quita del almacén local (otro dispositivo pulsó «orden original»)
    try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('meh.tabs.') && !(k.slice(9) in remoto)) localStorage.removeItem(k); } } catch { /* */ }
  }
}
function guardarPrefsTabs(modulo, orden) {
  if (orden) prefsTabs[modulo] = orden; else delete prefsTabs[modulo];
  db.setPrefsTabs(prefsTabs).catch(() => { /* sin red: queda en este dispositivo */ });
}
function ordenarTabs(modulo) {
  const clave = `meh.tabs.${modulo}`;
  let guardado = null;
  try { guardado = JSON.parse(localStorage.getItem(clave) || 'null'); } catch { /* */ }
  const tabs = [...tabsEl.querySelectorAll('.tab:not(.disabled)')];
  if (Array.isArray(guardado) && guardado.length) {
    const pos = (t) => { const i = guardado.indexOf(nombreTab(t)); return i < 0 ? 1e6 : i; };
    [...tabs].sort((a, b) => pos(a) - pos(b)).forEach((t) => tabsEl.insertBefore(t, tabsEl.querySelector('.tab.disabled') || tabsEl.querySelector('.tab-reset')));
  }
  let arrastrada = null;
  const guardar = () => { const o = [...tabsEl.querySelectorAll('.tab:not(.disabled)')].map(nombreTab); try { localStorage.setItem(clave, JSON.stringify(o)); } catch { /* */ } guardarPrefsTabs(modulo, o); };
  tabsEl.querySelectorAll('.tab:not(.disabled)').forEach((t) => {
    t.draggable = true; t.title = t.title || 'Arrastra para cambiar el orden de las pestañas';
    t.addEventListener('dragstart', (e) => { arrastrada = t; t.classList.add('arrastrando'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', nombreTab(t)); });
    t.addEventListener('dragend', () => { t.classList.remove('arrastrando'); arrastrada = null; guardar(); pintarReset(); });
    t.addEventListener('dragover', (e) => {
      if (!arrastrada || arrastrada === t) return;
      e.preventDefault();
      const r = t.getBoundingClientRect();
      tabsEl.insertBefore(arrastrada, e.clientX < r.left + r.width / 2 ? t : t.nextSibling);
    });
    t.addEventListener('drop', (e) => e.preventDefault());
  });
  function pintarReset() {
    tabsEl.querySelector('.tab-reset')?.remove();
    let hay = false; try { hay = !!localStorage.getItem(clave); } catch { /* */ }
    if (!hay) return;
    tabsEl.append(h('button', { type: 'button', class: 'tab-reset', title: 'Volver al orden original de las pestañas', onclick: () => { try { localStorage.removeItem(clave); } catch { /* */ } guardarPrefsTabs(modulo, null); pintarTabs(location.hash.replace(/^#\//, '').split(/[/?]/)[0]); } }, '↺ orden original'));
  }
  pintarReset();
}
function pintarTabs(actual) {
  if (actual !== 'ajustes') ultimoModulo = RUTAS[actual].modulo;
  else if (!modulosVisibles().some((m) => m.id === ultimoModulo)) ultimoModulo = modulosVisibles()[0]?.id || 'facturacion';
  pintarTabsBase(actual); ordenarTabs(RUTAS[actual].modulo); colorearTabs(); }
function pintarTabsBase(actual) {
  const modulo = RUTAS[actual].modulo;
  resumenEl.hidden = modulo !== 'facturacion'; // los chips de gastos solo en el módulo Facturación
  if (actual !== 'ajustes') { try { localStorage.setItem(LS_RUTA + modulo, actual); } catch { /* */ } }
  const mods = modulosVisibles();
  modulosEl.hidden = mods.length < 2;
  clear(modulosEl, mods.map((m) => h('button', { type: 'button', class: 'modulo', 'aria-pressed': String(m.id === modulo), title: m.sub, onclick: () => irAModulo(m.id) },
    h('span', { class: 'modulo-titulo' }, m.titulo))));
  const tab = (id, label) => h('a', { class: 'tab', href: `#/${id}`, 'aria-current': id === actual ? 'page' : false }, label);
  const proximamente = (label) => h('span', { class: 'tab disabled', title: 'Próximamente' }, label, h('span', { class: 'soon' }, 'pronto'));
  subTabsEl.hidden = true; clear(subTabsEl);
  if (modulo === 'academia') {
    clear(tabsEl, TABS_ACADEMIA.filter(([id]) => puedeRuta(id)).map(([id, label]) => tab(id, label)), ctx.ve('ac_alumnos') ? proximamente('Asistencia') : null, tab('ajustes', 'Configuración'));
    return;
  }
  if (modulo === 'trabajadores') {
    clear(tabsEl, TABS_TRABAJADORES.filter(([id]) => puedeRuta(id)).map(([id, label]) => tab(id, label)), tab('ajustes', 'Configuración'));
    return;
  }
  if (modulo === 'alumnos') {
    clear(tabsEl, TABS_ALUMNOS.filter(([id]) => puedeRuta(id)).map(([id, label]) => tab(id, label)), tab('ajustes', 'Configuración'));
    return;
  }
  if (ctx.soloEscaner()) { clear(tabsEl, tab('escaner', 'Escáner')); return; }
  const fact = ctx.veAlgo('fact');
  const badge = h('span', { class: 'tab-badge tab-badge-gastos', hidden: !state.pendientes, title: `${state.pendientes || 0} gastos pendientes de revisar` }, state.pendientes ? String(state.pendientes) : '');
  clear(tabsEl, fact ? tab('panel', 'Panel') : null, fact ? h('a', { class: 'tab', href: '#/gastos', 'aria-current': actual === 'gastos' ? 'page' : false }, 'Gastos', badge) : null, ctx.veAlgo('escaner') ? tab('escaner', 'Escáner') : null,
    pestanaIngresos(actual), TABS_COBROS.filter(([id]) => puedeRuta(id)).map(([id, label]) => h('a', { class: 'tab', href: `#/${id}`, 'aria-current': subtabCobro(id, actual) ? 'page' : false }, label)),
    fact ? tab('balance', 'Balance') : null, fact ? tab('control', 'Control') : null, ctx.edita('fact') ? tab('config', 'Listados y datos') : null,
    ctx.esAdmin() ? tab('usuarios', 'Usuarios') : null, tab('ajustes', 'Configuración'));
}

// La pestaña Ingresos abre su primera sub-pestaña accesible y, dentro de ellas, muestra la barra de sub-pestañas.
const subtabCobro = (id, actual) => id === actual || (id === 'ac_pagos' && actual === 'ac_pagos_importar') || (id === 'ac_remesas' && actual === 'ac_remesas_mensuales');
function pestanaIngresos(actual) {
  const subs = SUBTABS_INGRESOS.filter(([id]) => puedeRuta(id));
  if (!subs.length) return null;
  const dentro = enIngresos(actual);
  if (dentro) {
    subTabsEl.hidden = subs.length < 2;
    clear(subTabsEl, subs.map(([id, label]) => h('a', { class: `subtab st-${id}`, href: `#/${id}`, 'aria-current': id === subtabDe(actual) ? 'page' : false }, label)));
  }
  return h('a', { class: 'tab', href: `#/${subs[0][0]}`, 'aria-current': dentro ? 'page' : false }, 'Ingresos');
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
    if (id === renderId) { clear(viewEl, ...tmp.childNodes); if (ctx.soloLectura() && RUTAS[r].modulo === 'facturacion' && !r.startsWith('ac_')) bloquearEdicion(viewEl); refrescarResumen(); }
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
  if (!ctx.veAlgo('fact')) { const hoy = hoyISO(); return (state.cursosVisibles.find((c) => c.fecha_inicio <= hoy && hoy <= c.fecha_fin) || state.cursosVisibles.at(-1))?.id; } // sin contabilidad no hay gastos que mirar
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
  fijarUsuario(perfil.id);
  const [roles, filasPermisos] = await Promise.all([db.getRoles(), db.getPermisosRoles()]);
  state.roles = roles;
  state.permisos = crearPermisos(perfil.rol, filasPermisos);
  if (perfil.debe_cambiar_password) {
    return renderNuevaPassword(root, {
      titulo: 'Tu contraseña es provisional: elige una nueva',
      onDone: async () => { await db.passwordCambiada(); toast('Contraseña guardada'); await arrancar(); },
    });
  }
  document.body.classList.toggle('solo-lectura', ctx.soloLectura());
  document.body.classList.toggle('rol-escaner', ctx.soloEscaner());
  const [cursos, taxonomia, centros] = await Promise.all([db.getCursos(), db.getTaxonomia(), db.getCentros().catch(() => [])]);
  state.centros = centros;
  try { const c = localStorage.getItem(LS_CENTRO); state.centroId = centros.some((x) => x.id === c) ? c : ''; } catch { state.centroId = ''; }
  // una persona limitada a un centro solo trabaja en él: no puede cambiarlo ni ver «todos»
  if (state.perfil.centro_id && centros.some((x) => x.id === state.perfil.centro_id)) state.centroId = state.perfil.centro_id;
  aplicarCentro();
  const hoy = hoyISO();
  state.cursos = cursos;
  state.cursosVisibles = cursos.filter((c) => !c.fecha_inicio || c.fecha_inicio <= hoy);
  if (!state.cursosVisibles.length) state.cursosVisibles = cursos;
  state.taxonomia = taxonomia;
  state.cursoId = ctx.soloEscaner() ? (cursos.find((c) => c.fecha_inicio <= hoy && hoy <= c.fecha_fin) || state.cursosVisibles.at(-1))?.id : await elegirCurso();
  await cargarPrefsTabs();
  await cargarAjustes();
  if (!window.location.hash.replace('#', '').replace('/', '') && ajustes().inicio !== 'ultimo') irAModulo(ajustes().inicio);
  await cargarOrdenes();
  state.arrancado = true;
  historial.vaciar();
  if (/access_token=|type=/.test(window.location.hash)) history.replaceState(null, '', '#/panel');
  pintarShell();
  pintarVista();
  actualizarPendientes();
  actualizarAvisoFormularios();
  if (!window.__mehAvisoForm) { window.__mehAvisoForm = setInterval(() => { if (!document.hidden) actualizarAvisoFormularios(); }, 120000); window.addEventListener('hashchange', () => actualizarAvisoFormularios()); }
  // con la app abierta, los datos de Academia se descargan en segundo plano y se mantienen al día
  if (ctx.ve('ac_alumnos') && !ctx.soloEscaner()) {
    setTimeout(() => precargarAcademia(state.cursoId), 800);
    if (!window.__mehRefresco) window.__mehRefresco = setInterval(() => { if (!document.hidden && ajustes().refresco !== false) refrescarAcademia(); }, 120000);
  }
}

async function salir() {
  await db.logout();
}

function reiniciarEstado() {
  Object.assign(state, { session: null, perfil: null, roles: [], permisos: crearPermisos(null, []), cursos: [], cursosVisibles: [], taxonomia: [], cursoId: null, sugerencias: null, empresas: null, centros: [], centroId: '', arrancado: false }); setCentro('', null);
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
ordenAutomatico(); // cualquier tabla de listado se ordena pinchando en su cabecera
inicio();
