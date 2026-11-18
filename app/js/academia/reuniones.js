// Reuniones dentro de Tareas: Coordinación (lunes) y Profesoras (martes) del 1 de septiembre al 20 de junio, más reuniones sueltas.
// Cada reunión tiene temas a tratar; un tema se puede convertir en tarea o enlazar a una tarea que ya existe.
import { h, clear, cargando, toast, confirmar, hoyISO } from '../ui.js';
import * as api from './api.js';
import { cabecera, refrescar } from './kit.js';

const TIPOS = { coordinacion: { nombre: 'Coordinación', dia: 1, sub: 'lunes' }, profesoras: { nombre: 'Profesoras', dia: 2, sub: 'martes' }, otra: { nombre: 'Otras reuniones' } };
const AREAS = { aca: 'Académica', centro: 'Centro', conta: 'Contabilidad', pagos: 'Domiciliaciones y pagos' };
const AREAS_DINERO = ['conta', 'pagos'];
const R = { tipo: 'coordinacion', fecha: null, tareaEn: null, vincular: null };
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fechaLarga = (iso) => { const d = new Date(iso + 'T00:00'); return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`; };
export const fechaCorta = (iso) => { const d = new Date(iso + 'T00:00'); return `${DIAS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MESES[d.getMonth()]}`; };

// fechas fijas de un curso: de 1 de septiembre a 20 de junio
export function fechasFijas(tipo, hoy = hoyISO()) {
  const dia = TIPOS[tipo]?.dia; if (!dia) return [];
  const h0 = new Date(hoy + 'T00:00');
  const y = h0.getMonth() >= 6 ? h0.getFullYear() : h0.getFullYear() - 1;
  const out = []; const d = new Date(y, 8, 1); const fin = new Date(y + 1, 5, 20);
  while (d.getDay() !== dia) d.setDate(d.getDate() + 1);
  for (; d <= fin; d.setDate(d.getDate() + 7)) out.push(fmtISO(d));
  return out;
}
// próxima reunión fija (hoy incluido) de cada tipo; null si ya acabó el curso
export const proxima = (tipo, hoy = hoyISO()) => fechasFijas(tipo, hoy).find((f) => f >= hoy) || null;

export async function llevarAReunion(tipo, tarea) {
  const fecha = proxima(tipo); if (!fecha) throw new Error('El curso ya ha terminado: no quedan reuniones');
  const rs = await api.reuniones();
  const r = rs.find((x) => x.tipo === tipo && x.fecha === fecha) || await api.ins('ac_reuniones', { tipo, fecha });
  await api.ins('ac_reunion_temas', { reunion_id: r.id, texto: tarea.titulo, tarea_id: tarea.id });
  return fecha;
}
export const nombreReunion = (tipo) => TIPOS[tipo]?.nombre || 'Reunión';

export async function renderReuniones(view, ctx, { conmutador, verTarea } = {}) {
  clear(view, cargando());
  const [reuniones, temas, tareas, usuarios] = await Promise.all([api.reuniones(), api.temas(), api.tareas(), api.usuarios().catch(() => [])]);
  const yo = ctx.state.perfil;
  const editor = ctx.edita('ac_tareas');
  const verDinero = yo.rol === 'admin' || (ctx.ve('ac_pagos') && !yo.sin_dinero);
  const areasPropias = Object.keys(AREAS).filter((a) => verDinero || !AREAS_DINERO.includes(a));
  const hoy = hoyISO();
  const tarPor = new Map(tareas.map((t) => [t.id, t]));
  const personas = [...new Map([...usuarios, yo].filter(Boolean).map((u) => [u.id, u])).values()];
  const siglasDe = new Map(personas.map((u) => [u.id, u.siglas || (u.nombre || '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()]));
  const recargar = () => { api.invalidar(); refrescar(); };
  const cuerpo = h('div', { class: 'ac-reu-cuerpo' });
  const pintarLuego = () => recargar(); // el enrutador vuelve a dibujar la pantalla entera

  if (!R.fecha) R.fecha = (R.tipo === 'otra' ? null : proxima(R.tipo, hoy)) || hoy;

  const filaDe = (tipo, fecha) => reuniones.find((r) => r.tipo === tipo && r.fecha === fecha);
  async function asegurar(tipo, fecha, titulo) {
    let r = filaDe(tipo, fecha);
    if (r && (tipo !== 'otra' || r.id)) return r;
    try { r = await api.ins('ac_reuniones', { tipo, fecha, titulo: titulo || null }); } catch (ex) {
      const otra = (await api.reuniones()).find((x) => x.tipo === tipo && x.fecha === fecha); if (!otra) throw ex; r = otra;
    }
    reuniones.push(r); return r;
  }

  // ---- selector de reunión ----
  const pestañas = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Tipo de reunión' }, Object.entries(TIPOS).map(([k, t]) =>
    h('button', { class: 'seg-btn', type: 'button', 'aria-selected': String(R.tipo === k), onclick: () => { R.tipo = k; R.fecha = null; recargar(); } },
      t.nombre, t.sub ? h('span', { class: 'muted small' }, ` · ${t.sub}`) : null)));

  function selectorFecha() {
    if (R.tipo === 'otra') {
      const otras = reuniones.filter((r) => r.tipo === 'otra').sort((a, b) => b.fecha.localeCompare(a.fecha));
      const nf = h('input', { type: 'date', value: hoy, 'aria-label': 'Fecha de la nueva reunión' });
      const nt = h('input', { type: 'text', placeholder: 'Título de la reunión (p. ej. Reunión con familias de 1º)', 'aria-label': 'Título de la reunión' });
      const sel = h('select', { 'aria-label': 'Reunión' }, otras.map((r) => h('option', { value: r.id, selected: r.fecha === R.fecha && r.id === R.otraId }, `${fechaCorta(r.fecha)} · ${r.titulo || 'Sin título'}`)));
      sel.addEventListener('change', () => { const r = otras.find((x) => x.id === sel.value); R.fecha = r.fecha; R.otraId = r.id; pintar(); });
      return h('div', { class: 'ac-reu-sel' }, otras.length ? sel : h('span', { class: 'muted' }, 'Todavía no hay reuniones sueltas.'),
        editor ? [nf, nt, h('button', { class: 'btn small primary', type: 'button', onclick: async () => {
          if (!nt.value.trim() || !nf.value) { toast('Pon fecha y título', 'error'); return; }
          try { const r = await api.ins('ac_reuniones', { tipo: 'otra', fecha: nf.value, titulo: nt.value.trim() }); R.fecha = r.fecha; R.otraId = r.id; pintarLuego(); } catch (ex) { toast(ex.message, 'error'); }
        } }, 'Crear reunión')] : null);
    }
    const fechas = fechasFijas(R.tipo, hoy);
    const i = fechas.indexOf(R.fecha);
    const sel = h('select', { 'aria-label': 'Fecha de la reunión' }, fechas.map((f) => h('option', { value: f, selected: f === R.fecha }, `${fechaLarga(f)}${f === proxima(R.tipo, hoy) ? ' · próxima' : ''}${filaDe(R.tipo, f) && temas.some((t) => t.reunion_id === filaDe(R.tipo, f).id) ? ' ●' : ''}`)));
    sel.addEventListener('change', () => { R.fecha = sel.value; pintar(); });
    return h('div', { class: 'ac-reu-sel' },
      h('button', { class: 'btn small', type: 'button', disabled: i <= 0, onclick: () => { R.fecha = fechas[i - 1]; pintarLuego(); } }, '←'),
      sel,
      h('button', { class: 'btn small', type: 'button', disabled: i < 0 || i >= fechas.length - 1, onclick: () => { R.fecha = fechas[i + 1]; pintarLuego(); } }, '→'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { R.fecha = proxima(R.tipo, hoy) || fechas[fechas.length - 1]; pintarLuego(); } }, 'Próxima'));
  }

  // ---- temas de la reunión seleccionada ----
  function pintar() {
    const fila = R.tipo === 'otra' ? (reuniones.find((r) => r.id === R.otraId) || reuniones.filter((r) => r.tipo === 'otra').sort((a, b) => b.fecha.localeCompare(a.fecha))[0]) : filaDe(R.tipo, R.fecha);
    if (R.tipo === 'otra' && fila) { R.fecha = fila.fecha; R.otraId = fila.id; }
    const lista = fila ? temas.filter((t) => t.reunion_id === fila.id).sort((a, b) => a.orden - b.orden || a.created_at.localeCompare(b.created_at)) : [];
    // temas sin tratar de reuniones anteriores del mismo tipo (se pueden traer a esta)
    const prevIds = new Set(reuniones.filter((r) => r.tipo === R.tipo && r.fecha < R.fecha).map((r) => r.id));
    const pendientes = R.tipo === 'otra' ? [] : temas.filter((t) => prevIds.has(t.reunion_id) && !t.tratado && (!fila || t.reunion_id !== fila.id)).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const fechaDe = (t) => reuniones.find((r) => r.id === t.reunion_id)?.fecha;

    async function nuevoTema(texto, tareaId) {
      if (!texto.trim()) return;
      try {
        const r = await asegurar(R.tipo, R.fecha, fila?.titulo);
        const t = await api.ins('ac_reunion_temas', { reunion_id: r.id, texto: texto.trim(), tarea_id: tareaId || null, orden: lista.length });
        temas.push(t); pintar();
      } catch (ex) { toast(ex.message, 'error'); }
    }
    async function guardarTema(t, parche) { try { Object.assign(t, await api.upd('ac_reunion_temas', t.id, parche)); } catch (ex) { toast(ex.message, 'error'); } pintar(); }
    async function crearTarea(t, datos) {
      try {
        const tarea = await api.ins('ac_tareas', { titulo: datos.titulo, notas: t.notas || null, area: datos.area, vence: datos.vence || null,
          asignado_a: datos.quien || null, comentarios: [{ sys: true, t: `Creada desde la reunión de ${TIPOS[R.tipo].nombre} del ${fechaCorta(R.fecha)}`, at: new Date().toISOString() }] });
        tareas.push(tarea); tarPor.set(tarea.id, tarea);
        Object.assign(t, await api.upd('ac_reunion_temas', t.id, { tarea_id: tarea.id }));
        R.tareaEn = null; toast('Tarea creada y enlazada'); pintar();
      } catch (ex) { toast(ex.message, 'error'); }
    }

    const tema = (t) => {
      const tar = t.tarea_id ? tarPor.get(t.tarea_id) : null;
      const formTarea = R.tareaEn === t.id ? (() => {
        const ti = h('input', { type: 'text', value: t.texto, 'aria-label': 'Título de la tarea' });
        const q = h('select', { 'aria-label': 'Responsable de la tarea' }, [h('option', { value: '' }, 'Sin asignar'), ...personas.map((u) => h('option', { value: u.id }, u.nombre || u.email))]);
        const a = h('select', { 'aria-label': 'Área de la tarea' }, areasPropias.map((k) => h('option', { value: k }, AREAS[k])));
        const f = h('input', { type: 'date', 'aria-label': 'Fecha límite de la tarea' });
        return h('div', { class: 'ac-reu-form' }, ti, q, a, f,
          h('button', { class: 'btn small primary', type: 'button', onclick: () => ti.value.trim() && crearTarea(t, { titulo: ti.value.trim(), quien: q.value, area: a.value, vence: f.value }) }, 'Crear tarea'),
          h('button', { class: 'btn small ghost', type: 'button', onclick: () => { R.tareaEn = null; pintar(); } }, 'Cancelar'));
      })() : null;
      const formVincular = R.vincular === t.id ? (() => {
        const abiertas = tareas.filter((x) => x.estado !== 'hecha').sort((a, b) => a.titulo.localeCompare(b.titulo));
        const s = h('select', { 'aria-label': 'Tarea a enlazar' }, [h('option', { value: '' }, 'Elige una tarea…'), ...abiertas.map((x) => h('option', { value: x.id }, x.titulo.slice(0, 90)))]);
        s.addEventListener('change', () => { if (s.value) { R.vincular = null; guardarTema(t, { tarea_id: s.value }); } });
        return h('div', { class: 'ac-reu-form' }, s, h('button', { class: 'btn small ghost', type: 'button', onclick: () => { R.vincular = null; pintar(); } }, 'Cancelar'));
      })() : null;
      return h('div', { class: `ac-tema${t.tratado ? ' hecho' : ''}`, dataset: { id: t.id } },
        h('div', { class: 'ac-tema-l1' },
          h('input', { type: 'checkbox', class: 'ac-cb', checked: t.tratado, disabled: !editor, 'aria-label': 'Tratado', onchange: (e) => guardarTema(t, { tratado: e.target.checked }) }),
          h('input', { type: 'text', class: 'ac-tema-t', value: t.texto, disabled: !editor, 'aria-label': 'Tema', onchange: (e) => { if (e.target.value.trim()) guardarTema(t, { texto: e.target.value.trim() }); else e.target.value = t.texto; } }),
          t.tarea_id ? (tar ? h('span', { class: 'ac-reu-tarea', title: 'Tarea enlazada' },
              h('span', { class: `ac-chip`, style: `--c:${tar.estado === 'hecha' ? '#2a7d4f' : '#2a5bd7'}` }, tar.estado === 'hecha' ? 'Hecha' : tar.estado === 'curso' ? 'En curso' : 'Tarea'),
              h('button', { type: 'button', class: 'link-btn small', title: 'Ver en Tareas', onclick: () => { verTarea?.(tar.titulo); } }, tar.titulo.slice(0, 60)),
              tar.asignado_a ? h('span', { class: 'muted small' }, siglasDe.get(tar.asignado_a) || '') : null,
              editor ? h('button', { class: 'ac-x', type: 'button', title: 'Quitar el enlace', 'aria-label': 'Quitar enlace', onclick: () => guardarTema(t, { tarea_id: null }) }, '⛓') : null)
            : h('span', { class: 'muted small' }, 'Tarea borrada'))
            : editor ? h('span', { class: 'ac-reu-acc' },
              h('button', { class: 'btn small', type: 'button', onclick: () => { R.tareaEn = t.id; R.vincular = null; pintar(); } }, '+ Crear tarea'),
              h('button', { class: 'btn small ghost', type: 'button', onclick: () => { R.vincular = t.id; R.tareaEn = null; pintar(); } }, 'Enlazar tarea')) : null,
          editor ? h('button', { class: 'ac-x', type: 'button', title: 'Quitar tema', 'aria-label': 'Quitar tema', onclick: async () => {
            if (!(await confirmar({ titulo: 'Quitar tema', texto: t.texto, ok: 'Quitar', peligro: true }))) return;
            try { await api.del('ac_reunion_temas', t.id); temas.splice(temas.indexOf(t), 1); pintar(); } catch (ex) { toast(ex.message, 'error'); }
          } }, '✕') : null),
        h('textarea', { class: 'ac-tema-n', rows: Math.min(5, Math.max(1, (t.notas || '').split('\n').length)), placeholder: 'Notas / lo que se acordó…', disabled: !editor, 'aria-label': 'Notas del tema', onchange: (e) => guardarTema(t, { notas: e.target.value.trim() || null }) }, t.notas || ''),
        formTarea, formVincular);
    };

    const nuevo = h('input', { type: 'text', placeholder: 'Añadir un tema a tratar… (Enter)', class: 'ac-tarea-nueva', disabled: !editor || (R.tipo === 'otra' && !fila), 'aria-label': 'Nuevo tema' });
    nuevo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = nuevo.value; nuevo.value = ''; nuevoTema(v); } });
    const notas = h('textarea', { class: 'ac-reu-notas', rows: 3, placeholder: 'Acta / acuerdos de la reunión…', disabled: !editor || (R.tipo === 'otra' && !fila), 'aria-label': 'Acuerdos de la reunión' }, fila?.notas || '');
    notas.addEventListener('change', async () => {
      try { const r = await asegurar(R.tipo, R.fecha, fila?.titulo); Object.assign(r, await api.upd('ac_reuniones', r.id, { notas: notas.value.trim() || null })); } catch (ex) { toast(ex.message, 'error'); }
    });
    const esFutura = R.fecha > hoy;
    clear(cuerpo,
      h('div', { class: 'card ac-reu-card' },
        h('div', { class: 'ac-grupo-h' }, h('span', {}, `${TIPOS[R.tipo].nombre}${fila?.titulo ? ' · ' + fila.titulo : ''} · ${fechaLarga(R.fecha)}`), h('span', {}, `${lista.filter((t) => t.tratado).length}/${lista.length} tratados`)),
        h('div', { class: 'ac-reu-pad' },
          editor ? nuevo : null,
          lista.length ? lista.map(tema) : h('p', { class: 'muted small' }, R.tipo === 'otra' && !fila ? 'Crea una reunión para apuntar temas.' : esFutura ? 'Todavía no hay temas. Apunta aquí lo que hay que hablar y saldrá en la reunión.' : 'No se apuntó ningún tema.'),
          h('label', { class: 'field full' }, h('span', {}, 'Acuerdos'), notas))),
      pendientes.length ? h('div', { class: 'card ac-reu-card' },
        h('div', { class: 'ac-grupo-h' }, h('span', {}, 'Sin tratar en reuniones anteriores'), h('span', {}, pendientes.length)),
        h('div', { class: 'ac-reu-pad' }, pendientes.map((t) => h('div', { class: 'ac-tema' }, h('div', { class: 'ac-tema-l1' },
          h('span', { class: 'ac-tema-t pend' }, t.texto), h('span', { class: 'muted small' }, fechaCorta(fechaDe(t))),
          editor ? h('button', { class: 'btn small', type: 'button', onclick: async () => { try { const r = await asegurar(R.tipo, R.fecha, fila?.titulo); Object.assign(t, await api.upd('ac_reunion_temas', t.id, { reunion_id: r.id, orden: lista.length })); pintar(); } catch (ex) { toast(ex.message, 'error'); } } }, 'Traer a esta reunión') : null,
          editor ? h('button', { class: 'btn small ghost', type: 'button', title: 'Darlo por tratado', onclick: () => guardarTema(t, { tratado: true }) }, 'Ya tratado') : null))))) : null);
    clear(selector, selectorFecha());
  }

  const selector = h('div', {});
  clear(view, cabecera('Tareas', 'Reuniones', conmutador),
    h('div', { class: 'ac-filtros' }, pestañas),
    selector, cuerpo);
  pintar();
}
