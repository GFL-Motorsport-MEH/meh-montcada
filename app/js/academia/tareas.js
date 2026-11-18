// Tareas: lista compartida estilo Google Keep (tarjetas con lista de comprobación, fecha, prioridad y responsable).
import { h, clear, cargando, toast, confirmar, fmtFecha, hoyISO, normalizar } from '../ui.js';
import * as api from './api.js';
import { campo, txt, area, fecha, sel, drawer, cabecera, guardarBoton, refrescar } from './kit.js';

const PRIO = ['Normal', 'Importante', 'Urgente'];
let filtro = 'pendientes';

export async function renderTareas(view, ctx) {
  clear(view, cargando());
  const [tareas, usuarios] = await Promise.all([api.tareas(), api.usuarios().catch(() => [])]);
  const yo = ctx.state.perfil;
  const uPor = new Map([...usuarios, yo].filter(Boolean).map((u) => [u.id, u]));
  const editor = ctx.puedeEditar();
  const recargar = () => { api.invalidar(); refrescar(); };
  const f = { q: '', mias: false };
  const hoy = hoyISO();
  const cont = h('div', { class: 'ac-keep' });

  const nueva = h('input', { type: 'text', placeholder: 'Nueva tarea… (Enter para añadir)', class: 'ac-tarea-nueva', disabled: !editor, 'aria-label': 'Nueva tarea' });
  nueva.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !nueva.value.trim()) return;
    try { await api.ins('ac_tareas', { titulo: nueva.value.trim() }); nueva.value = ''; recargar(); } catch (ex) { toast(ex.message, 'error'); }
  });
  const seg = h('div', { class: 'segmented', role: 'tablist' }, [['pendientes', 'Pendientes'], ['hechas', 'Hechas'], ['todas', 'Todas']].map(([k, l]) =>
    h('button', { class: 'seg-btn', role: 'tab', type: 'button', 'aria-selected': String(filtro === k), onclick: () => { filtro = k; seg.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-selected', String(b.textContent === l))); pintar(); } }, l)));

  function tarjeta(t) {
    const items = Array.isArray(t.items) ? t.items : [];
    const guardarItems = async () => { try { Object.assign(t, await api.upd('ac_tareas', t.id, { items: t.items })); } catch (ex) { toast(ex.message, 'error'); } };
    const vencida = !t.hecha && t.vence && t.vence < hoy;
    return h('div', { class: `card ac-tarjeta prio${t.prioridad}${t.hecha ? ' hecha' : ''}` },
      h('div', { class: 'ac-fila' },
        h('input', { type: 'checkbox', checked: t.hecha, disabled: !editor, 'aria-label': 'Hecha', onchange: async (e) => { try { Object.assign(t, await api.upd('ac_tareas', t.id, { hecha: e.target.checked, hecha_at: e.target.checked ? new Date().toISOString() : null })); recargar(); } catch (ex) { toast(ex.message, 'error'); } } }),
        h('button', { class: 'ac-tarjeta-titulo link-btn', type: 'button', onclick: () => abrir(t, { uPor, ctx, recargar }) }, t.titulo)),
      t.notas ? h('div', { class: 'small muted ac-notas' }, t.notas) : null,
      items.length ? h('div', { class: 'ac-items' }, items.map((it, i) => h('label', { class: 'check small' + (it.ok ? ' hecho' : '') },
        h('input', { type: 'checkbox', checked: it.ok, disabled: !editor, onchange: (e) => { t.items[i] = { ...it, ok: e.target.checked }; guardarItems(); e.target.parentElement.classList.toggle('hecho', e.target.checked); } }), ' ', it.t))) : null,
      h('div', { class: 'ac-meta small' }, t.vence ? h('span', { class: `pill ${vencida ? 'warn' : 'off'}` }, `${vencida ? 'Vencida · ' : ''}${fmtFecha(t.vence)}`) : null,
        t.prioridad ? h('span', { class: `pill ${t.prioridad === 2 ? 'warn' : 'off'}` }, PRIO[t.prioridad]) : null, t.etiqueta ? h('span', { class: 'pill off' }, t.etiqueta) : null,
        t.asignado_a ? h('span', { class: 'muted' }, uPor.get(t.asignado_a)?.nombre || uPor.get(t.asignado_a)?.email || '') : null));
  }
  function pintar() {
    const q = normalizar(f.q);
    const filas = tareas.filter((t) => (filtro === 'todas' || (filtro === 'hechas') === t.hecha) && (!f.mias || t.asignado_a === yo.id) && (!q || normalizar(`${t.titulo} ${t.notas || ''} ${t.etiqueta || ''}`).includes(q)))
      .sort((a, b) => (b.prioridad - a.prioridad) || (a.vence || '9999').localeCompare(b.vence || '9999') || b.created_at.localeCompare(a.created_at));
    clear(cont, filas.length ? filas.map(tarjeta) : h('div', { class: 'card empty', style: 'grid-column:1/-1' }, filtro === 'pendientes' ? 'No hay tareas pendientes. 🎉' : 'No hay tareas.'));
  }
  clear(view, cabecera('Tareas', `${tareas.filter((t) => !t.hecha).length} pendientes`, seg, editor ? h('button', { class: 'btn small', type: 'button', onclick: () => abrir(null, { uPor, ctx, recargar }) }, '+ Tarea con detalle') : null),
    h('div', { class: 'filters filters-3' }, nueva, h('input', { type: 'search', placeholder: 'Buscar…', oninput: (e) => { f.q = e.target.value; pintar(); } }), h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { f.mias = e.target.checked; pintar(); } }), ' Solo las mías')), cont);
  pintar();
}

function abrir(t, { uPor, ctx, recargar }) {
  const d = drawer({ titulo: t ? 'Editar tarea' : 'Nueva tarea', ancho: 520 });
  let items = (t?.items || []).map((x) => ({ ...x }));
  const F = { titulo: txt(t?.titulo), notas: area(t?.notas), vence: fecha(t?.vence), prio: sel(PRIO.map((p, i) => [String(i), p]), String(t?.prioridad ?? 0)), etiqueta: txt(t?.etiqueta, { placeholder: 'Matrícula, Pagos, Material…' }),
    asig: sel([...uPor.values()].map((u) => [u.id, u.nombre || u.email]), t?.asignado_a, { vacio: 'Sin asignar' }) };
  const caja = h('div');
  const pintarItems = () => clear(caja, items.map((it, i) => h('div', { class: 'ac-fila' }, h('input', { type: 'checkbox', checked: it.ok, onchange: (e) => { it.ok = e.target.checked; } }),
    h('input', { type: 'text', value: it.t, style: 'flex:1', onchange: (e) => { it.t = e.target.value; } }), h('button', { class: 'btn small ghost', type: 'button', onclick: () => { items.splice(i, 1); pintarItems(); } }, '✕'))),
    h('button', { class: 'btn small', type: 'button', onclick: () => { items.push({ t: '', ok: false }); pintarItems(); } }, '+ Elemento'));
  pintarItems();
  d.cuerpo.append(h('div', { class: 'form-section' }, campo('Título', F.titulo, { full: true, req: true }), campo('Notas', F.notas, { full: true }), campo('Fecha límite', F.vence), campo('Prioridad', F.prio), campo('Etiqueta', F.etiqueta), campo('Responsable', F.asig),
    h('div', { class: 'full' }, h('div', { class: 'small', style: 'font-weight:600;margin-bottom:4px' }, 'Lista de comprobación'), caja)));
  const guardar = guardarBoton('Guardar', async () => {
    if (!F.titulo.value.trim()) { toast('Falta el título.', 'error'); return; }
    const fila = { titulo: F.titulo.value.trim(), notas: F.notas.value.trim() || null, vence: F.vence.value || null, prioridad: Number(F.prio.value), etiqueta: F.etiqueta.value.trim() || null, asignado_a: F.asig.value || null, items: items.filter((x) => x.t.trim()) };
    try { if (t) await api.upd('ac_tareas', t.id, fila); else await api.ins('ac_tareas', fila); toast('Tarea guardada'); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); }
  });
  guardar.disabled = !ctx.puedeEditar();
  const borrar = t && ctx.puedeEditar() ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Borrar tarea', texto: t.titulo, ok: 'Borrar', peligro: true })) { try { await api.del('ac_tareas', t.id); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } } }, 'Borrar') : h('span');
  d.pie.append(borrar, guardar);
}
