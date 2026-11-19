// Mejoras software (dentro de Tareas): el equipo apunta cosas a mejorar de la app, indicando módulo y pestaña.
import { h, clear, cargando, toast, confirmar } from '../ui.js';
import * as api from './api.js';
import { cabecera, refrescar } from './kit.js';

const MODULOS = { facturacion: 'Facturación', academia: 'Academia', trabajadores: 'Trabajadores' };
const OTRA = 'General / otra';
const PESTANAS = {
  facturacion: ['Panel', 'Gastos', 'Escáner', 'Ingresos', 'Pagos', 'Remesas', 'Balance', 'Control', 'Configuración', 'Usuarios', OTRA],
  academia: ['Alumnos', 'Seguimiento', 'Tutorías', 'Bajas', 'Grupos', 'Horarios', 'Calendario', 'Recogidas', 'Tareas', 'Biblioteca y Mascotas', 'Protocolos', 'Programaciones', OTRA],
  trabajadores: ['Mi portal', 'Contrato y horario', 'Bolsa de horas', 'Documentos', 'Equipo', OTRA],
};
const F = { modulo: 'all', estado: 'pend', q: '' };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaHora = (ts) => { const d = new Date(ts); return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const sel = (opciones, valor, extra = {}) => h('select', extra, opciones.map(([v, l]) => h('option', { value: v, selected: v === valor }, l)));

export async function renderMejoras(view, ctx, { conmutador } = {}) {
  clear(view, cargando());
  const [lista, usuarios] = await Promise.all([api.mejoras(), api.usuarios().catch(() => [])]);
  const yo = ctx.state.perfil;
  const editor = ctx.edita('ac_tareas');
  const nombreDe = (id) => { const u = [...usuarios, yo].find((x) => x?.id === id); return u ? (u.nombre || u.email) : ''; };
  const recargar = () => { api.invalidar(); refrescar(); };

  // ---- alta ----
  const nuevo = h('textarea', { rows: 2, placeholder: 'Escribe aquí qué hay que mejorar o qué te ha fallado…', 'aria-label': 'Comentario', disabled: !editor });
  const modulo = sel(Object.entries(MODULOS), 'academia', { 'aria-label': 'Módulo', disabled: !editor });
  const pestana = sel([], '', { 'aria-label': 'Pestaña', disabled: !editor });
  const llenarPestanas = () => { clear(pestana, PESTANAS[modulo.value].map((p) => h('option', { value: p }, p))); };
  modulo.addEventListener('change', llenarPestanas); llenarPestanas();
  async function crear() {
    if (!nuevo.value.trim()) { toast('Escribe el comentario', 'error'); return; }
    try { await api.ins('ac_mejoras_software', { comentario: nuevo.value.trim(), modulo: modulo.value, pestana: pestana.value }); nuevo.value = ''; recargar(); } catch (ex) { toast(ex.message, 'error'); }
  }

  // ---- listado ----
  const cont = h('div', { class: 'ac-mej-lista' });
  async function guardar(m, parche) {
    try { Object.assign(m, await api.upd('ac_mejoras_software', m.id, parche)); } catch (ex) { toast(ex.message, 'error'); }
    pintar();
  }
  function fila(m) {
    const autor = nombreDe(m.created_by);
    const puedeBorrar = editor && (m.created_by === yo.id || yo.rol === 'admin');
    return h('div', { class: 'ac-mej' + (m.estado === 'hecha' ? ' hecha' : ''), dataset: { id: m.id } },
      h('input', { type: 'checkbox', class: 'ac-cb', checked: m.estado === 'hecha', disabled: !editor, title: 'Marcar como hecha', 'aria-label': 'Hecha', onchange: (e) => guardar(m, { estado: e.target.checked ? 'hecha' : 'pend' }) }),
      h('textarea', { class: 'ac-mej-txt', rows: Math.min(6, Math.max(1, m.comentario.split('\n').length)), disabled: !editor, 'aria-label': 'Comentario', onchange: (e) => { if (e.target.value.trim()) guardar(m, { comentario: e.target.value.trim() }); else e.target.value = m.comentario; } }, m.comentario),
      h('div', { class: 'ac-mej-meta' },
        sel(Object.entries(MODULOS), m.modulo, { disabled: !editor, 'aria-label': 'Módulo', onchange: (e) => guardar(m, { modulo: e.target.value, pestana: OTRA }) }),
        sel((PESTANAS[m.modulo].includes(m.pestana) || !m.pestana ? PESTANAS[m.modulo] : [...PESTANAS[m.modulo], m.pestana]).map((p) => [p, p]), m.pestana || OTRA, { disabled: !editor, 'aria-label': 'Pestaña', onchange: (e) => guardar(m, { pestana: e.target.value }) }),
        h('span', { class: 'muted small' }, `${autor ? autor + ' · ' : ''}${fechaHora(m.created_at)}`),
        puedeBorrar ? h('button', { class: 'ac-x', type: 'button', title: 'Borrar', 'aria-label': 'Borrar', onclick: async () => { if (await confirmar({ titulo: 'Borrar comentario', texto: m.comentario.slice(0, 120), ok: 'Borrar', peligro: true })) { try { await api.del('ac_mejoras_software', m.id); recargar(); } catch (ex) { toast(ex.message, 'error'); } } } }, '✕') : null));
  }
  function pintar() {
    const q = F.q.trim().toLowerCase();
    const it = lista.filter((m) => (F.modulo === 'all' || m.modulo === F.modulo) && (F.estado === 'all' || m.estado === F.estado) && (!q || `${m.comentario} ${m.pestana || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    clear(cont, it.length ? it.map(fila) : h('div', { class: 'card empty' }, 'No hay comentarios con estos filtros.'));
    document.querySelectorAll('.ac-mej-f [data-m]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.m === F.modulo)));
    document.querySelectorAll('.ac-mej-f [data-e]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.e === F.estado)));
  }
  const fMod = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Módulo' }, [['all', 'Todos'], ...Object.entries(MODULOS)].map(([k, l]) => h('button', { class: 'seg-btn', type: 'button', dataset: { m: k }, onclick: () => { F.modulo = k; pintar(); } }, l)));
  const fEst = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Estado' }, [['pend', 'Pendientes'], ['hecha', 'Hechas'], ['all', 'Todas']].map(([k, l]) => h('button', { class: 'seg-btn', type: 'button', dataset: { e: k }, onclick: () => { F.estado = k; pintar(); } }, l)));

  clear(view, cabecera('Tareas', `${lista.filter((m) => m.estado === 'pend').length} mejoras pendientes`, conmutador),
    h('div', { class: 'card ac-mej-nueva' }, h('h3', { class: 'sub-titulo' }, 'Nueva mejora del software'), nuevo,
      h('div', { class: 'ac-mej-meta' }, modulo, pestana, h('button', { class: 'btn primary', type: 'button', disabled: !editor, onclick: crear }, 'Añadir'))),
    h('div', { class: 'ac-filtros ac-mej-f' }, fMod, fEst, h('input', { type: 'search', placeholder: 'Buscar…', 'aria-label': 'Buscar mejoras', value: F.q, oninput: (e) => { F.q = e.target.value; pintar(); } })),
    cont);
  pintar();
}
