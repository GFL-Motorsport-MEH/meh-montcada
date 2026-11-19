// Pestaña Configuración: ajustes de la app. Colores de pestañas y pantalla de inicio (de cada usuario), y colores de las personas (equipo y profesoras).
import { h, clear, toast, cargando } from '../ui.js';
import * as db from '../db.js';
import * as api from '../academia/api.js';
import { ajustes, cambiarAjustes, AJUSTES_BASE } from '../ajustes.js';
import { registrarPersonas, colorAuto, PALETA } from '../personas.js';

const iguales = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

function seccionPestanas(ctx, repintar) {
  const A = ajustes();
  const grupos = ctx.pestanasPorModulo();
  const color = (n) => A.coloresTabs[n] || ctx.colorPestanaBase(n) || '#c2c6cc';
  return h('div', { class: 'card aj-card' },
    h('h3', { class: 'sub-titulo' }, 'Colores de las pestañas'),
    h('p', { class: 'muted small' }, 'Cada pestaña tiene un color suave para reconocerla de un vistazo. Cambia el que quieras: solo lo ves tú, en todos tus dispositivos.'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: A.colorTabs, onchange: (e) => { cambiarAjustes({ colorTabs: e.target.checked }); } }), ' Mostrar colores en las pestañas'),
    grupos.map((g) => h('div', { class: 'aj-grupo' }, h('div', { class: 'aj-grupo-t' }, g.titulo),
      h('div', { class: 'aj-tabs' }, g.nombres.map((n) => h('label', { class: 'aj-tab' },
        h('input', { type: 'color', value: color(n), 'aria-label': `Color de la pestaña ${n}`, onchange: (e) => { cambiarAjustes({ coloresTabs: { ...ajustes().coloresTabs, [n]: e.target.value } }); } }), h('span', {}, n)))))),
    h('div', { class: 'aj-acciones' }, h('button', { class: 'btn small', type: 'button', onclick: () => { cambiarAjustes({ coloresTabs: {} }); toast('Colores de pestañas restaurados'); repintar(); } }, 'Restaurar colores originales')));
}

async function seccionPersonas(ctx) {
  const cont = h('div', { class: 'card aj-card' });
  const admin = ctx.esAdmin();
  const editaProfes = ctx.edita('ac_calendario');
  async function pintar() {
    clear(cont, cargando());
    const [usuarios, profes] = await Promise.all([api.usuarios().catch(() => []), api.profesoras().catch(() => [])]);
    const lista = usuarios.some((u) => u.id === ctx.state.perfil.id) ? usuarios : [...usuarios, { ...ctx.state.perfil }];
    registrarPersonas(lista);
    const vinculada = (u) => profes.find((p) => p.profile_id === u.id);
    const colorU = (u) => u.color || colorAuto(u.id) || PALETA[0];
    const todos = [
      ...lista.map((u) => ({ clave: 'u' + u.id, nombre: u.nombre || u.email, siglas: u.siglas, color: colorU(u), elegido: !!u.color })),
      ...profes.filter((p) => !lista.some((u) => u.id === p.profile_id)).map((p) => ({ clave: 'p' + p.id, nombre: p.nombre, color: p.color, elegido: true })),
    ];
    const repetido = (c) => todos.filter((x) => iguales(x.color, c.color) && x.clave !== c.clave).map((x) => x.nombre);
    const fila = (x, guardar, puede, quitar) => {
      const otros = repetido(x);
      const sig = x.siglas || String(x.nombre || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
      return h('div', { class: 'aj-persona' },
        h('span', { class: 'ac-av', style: `background:${x.color}` }, sig),
        h('span', { class: 'aj-nombre' }, x.nombre),
        h('input', { type: 'color', value: x.color, disabled: !puede, 'aria-label': `Color de ${x.nombre}`, onchange: (e) => guardar(e.target.value) }),
        quitar && x.elegido && puede ? h('button', { class: 'link-btn small', type: 'button', onclick: () => guardar(null) }, 'automático') : (x.elegido ? null : h('span', { class: 'muted small' }, 'automático')),
        otros.length ? h('span', { class: 'aj-aviso', title: 'Mismo color que ' + otros.join(', ') }, '⚠ igual que ' + otros.join(', ')) : null);
    };
    const guardarUsuario = async (u, c) => {
      try {
        await db.actualizarPerfil(u.id, { color: c });
        u.color = c;
        const p = vinculada(u);
        if (p && editaProfes) await api.upd('ac_profesoras', p.id, { color: c || colorU(u) }).catch(() => {});
        api.invalidar(); toast('Color guardado'); pintar();
      } catch (ex) { toast(ex.message, 'error'); pintar(); }
    };
    const guardarProfe = async (p, c) => { try { await api.upd('ac_profesoras', p.id, { color: c }); api.invalidar(); toast('Color guardado'); pintar(); } catch (ex) { toast(ex.message, 'error'); pintar(); } };
    const repartir = async () => {
      try {
        const usados = new Set(); let n = 0;
        for (const u of lista) { const c = colorU(u); await db.actualizarPerfil(u.id, { color: c }); u.color = c; usados.add(c.toLowerCase()); const p = vinculada(u); if (p && editaProfes) await api.upd('ac_profesoras', p.id, { color: c }).catch(() => {}); }
        const vistos = new Set(usados);
        for (const p of profes.filter((x) => !lista.some((u) => u.id === x.profile_id))) {
          if (vistos.has((p.color || '').toLowerCase())) { const libre = PALETA.find((c) => !vistos.has(c.toLowerCase())) || PALETA[n++ % PALETA.length]; await api.upd('ac_profesoras', p.id, { color: libre }); vistos.add(libre.toLowerCase()); } else vistos.add((p.color || '').toLowerCase());
        }
        api.invalidar(); toast('Colores repartidos: ya no se repite ninguno'); pintar();
      } catch (ex) { toast(ex.message, 'error'); }
    };
    clear(cont,
      h('h3', { class: 'sub-titulo' }, 'Colores de las personas'),
      h('p', { class: 'muted small' }, 'El círculo con las siglas de cada persona (en Tareas y Reuniones) y su color en los Horarios. Lo que elijas lo ve todo el equipo.' + (admin ? '' : ' Solo un administrador puede cambiar los colores del equipo.')),
      h('div', { class: 'aj-personas' },
        lista.map((u) => fila({ clave: 'u' + u.id, nombre: u.nombre || u.email, siglas: u.siglas, color: colorU(u), elegido: !!u.color }, (c) => guardarUsuario(u, c), admin, true)),
        profes.filter((p) => !lista.some((u) => u.id === p.profile_id)).map((p) => fila({ clave: 'p' + p.id, nombre: p.nombre + ' (profesora)', color: p.color, elegido: true }, (c) => guardarProfe(p, c), editaProfes, false))),
      admin ? h('div', { class: 'aj-acciones' }, h('button', { class: 'btn small', type: 'button', onclick: repartir }, 'Repartir colores distintos a todos')) : null);
  }
  await pintar();
  return cont;
}

export async function renderAjustes(view, ctx) {
  const cont = h('div', { class: 'aj-wrap' });
  const A = () => ajustes();
  const MODS = ctx.modulosDisponibles();
  const basicos = () => h('div', { class: 'card aj-card' },
    h('h3', { class: 'sub-titulo' }, 'Ajustes básicos'),
    h('div', { class: 'aj-linea' }, h('label', { for: 'aj-inicio' }, 'Al entrar en la app abrir'),
      h('select', { id: 'aj-inicio', onchange: (e) => cambiarAjustes({ inicio: e.target.value }) },
        h('option', { value: 'ultimo', selected: A().inicio === 'ultimo' }, 'La última pantalla que usé'),
        MODS.map((m) => h('option', { value: m.id, selected: A().inicio === m.id }, `Siempre ${m.titulo}`)))),
    h('div', { class: 'aj-linea' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: A().refresco, onchange: (e) => { cambiarAjustes({ refresco: e.target.checked }); toast(e.target.checked ? 'Datos al día en segundo plano' : 'Los datos se actualizarán solo al cambiar de pantalla'); } }), ' Mantener los datos de Academia al día en segundo plano (cada 2 minutos)')),
    h('div', { class: 'aj-linea' }, h('button', { class: 'btn small', type: 'button', onclick: () => { ctx.restaurarOrdenPestanas(); toast('Orden de las pestañas restaurado'); } }, 'Restaurar el orden original de las pestañas')),
    h('div', { class: 'aj-linea' }, h('button', { class: 'btn small', type: 'button', onclick: () => { cambiarAjustes({ ...AJUSTES_BASE }); toast('Ajustes restaurados'); pintar(); } }, 'Restaurar todos mis ajustes')));
  const pintar = async () => {
    clear(view, h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'Configuración'), h('div', { class: 'count' }, 'Ajustes de la app, colores y preferencias'))), cont);
    clear(cont, basicos(), seccionPestanas(ctx, pintar), await seccionPersonas(ctx));
  };
  await pintar();
}
