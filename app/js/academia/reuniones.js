// Reuniones dentro de Tareas: Coordinación (lunes) y Profesoras (martes) del 1 de septiembre al 20 de junio, más reuniones sueltas.
// Cada reunión tiene temas a tratar; un tema se puede convertir en tarea o enlazar a una tarea que ya existe.
import { h, clear, cargando, toast, confirmar, hoyISO } from '../ui.js';
import * as api from './api.js';
import { cabecera, refrescar, avatarDe } from './kit.js';

const TIPOS = { coordinacion: { nombre: 'Coordinación', dia: 1, sub: 'lunes', color: '#7a3fc0' }, profesoras: { nombre: 'Profesoras', dia: 2, sub: 'martes', color: '#0f8b8d' }, otra: { nombre: 'Otras reuniones', color: '#c26d1a' } };
const AREAS = { aca: 'Académica', centro: 'Centro', conta: 'Contabilidad', pagos: 'Domiciliaciones y pagos' };
const AREAS_DINERO = ['conta', 'pagos'];
const R = { tipo: 'coordinacion', fecha: null, mes: null, tareaEn: null, vincular: null, abiertos: new Set() };
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
  const verDinero = yo.rol === 'admin' || ctx.ve('ac_pagos');
  const areasPropias = Object.keys(AREAS).filter((a) => verDinero || !AREAS_DINERO.includes(a));
  const hoy = hoyISO();
  const tarPor = new Map(tareas.map((t) => [t.id, t]));
  const personas = [...new Map([...usuarios, yo].filter(Boolean).map((u) => [u.id, u])).values()];
  const siglasDe = new Map(personas.map((u) => [u.id, u.siglas || (u.nombre || '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()]));
  const nombreDe = (id) => { const u = personas.find((x) => x.id === id); return u ? (u.nombre || u.email) : (id ? 'Usuario no activo' : ''); };
  const quienSel = (valor, onchange, etiqueta) => {
    const ops = personas.map((u) => [u.id, u.nombre || u.email]);
    if (valor && !ops.some(([v]) => v === valor)) ops.push([valor, 'Usuario no activo']);
    const s = h('select', { class: 'ac-tema-q', 'aria-label': etiqueta }, [h('option', { value: '' }, 'Sin asignar'), ...ops.map(([v, l]) => h('option', { value: v, selected: v === valor }, l))]);
    s.addEventListener('change', () => onchange(s.value));
    return s;
  };
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
  const pestañas = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Tipo de reunión' });
  function pintarPestañas() {
    clear(pestañas, Object.entries(TIPOS).map(([k, t]) =>
      h('button', { class: 'seg-btn', type: 'button', style: `--c:${t.color}`, 'aria-selected': String(R.tipo === k), onclick: () => { R.tipo = k; R.fecha = null; R.mes = null; recargar(); } },
        h('i', { class: 'ac-punto', style: `background:${t.color}` }), t.nombre, t.sub ? h('span', { class: 'muted small' }, ` · ${t.sub}`) : null)));
  }
  const irA = (f) => { R.fecha = f; R.mes = f.slice(0, 7); };

  // calendario del mes: de un vistazo qué días hay reunión (anillo = sin temas, relleno = con temas y su número)
  function calendario() {
    if (!R.mes) R.mes = R.fecha.slice(0, 7);
    const [y, m] = R.mes.split('-').map(Number);
    const fijas = { coordinacion: new Set(fechasFijas('coordinacion', hoy)), profesoras: new Set(fechasFijas('profesoras', hoy)) };
    const nTemas = new Map(); const nPend = new Map();
    temas.forEach((t) => { nTemas.set(t.reunion_id, (nTemas.get(t.reunion_id) || 0) + 1); if (!t.tratado) nPend.set(t.reunion_id, (nPend.get(t.reunion_id) || 0) + 1); });
    const reunionesDe = (f) => {
      const out = [];
      ['coordinacion', 'profesoras'].forEach((tp) => { if (fijas[tp].has(f)) out.push({ tipo: tp, fila: filaDe(tp, f) }); });
      reuniones.filter((r) => r.tipo === 'otra' && r.fecha === f).forEach((r) => out.push({ tipo: 'otra', fila: r }));
      return out;
    };
    const mesNombre = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    const mover = (n) => { const d = new Date(y, m - 1 + n, 1); R.mes = fmtISO(d).slice(0, 7); clear(selector, selectorFecha()); };
    const off = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const celdas = [];
    for (let i = 0; i < off; i++) celdas.push(h('span', { class: 'ac-mini-d fuera' }));
    for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
      const f = fmtISO(new Date(y, m - 1, d));
      const rs = reunionesDe(f);
      const esHoy = f === hoy;
      if (!rs.length) { celdas.push(h('span', { class: `ac-mini-d${esHoy ? ' hoy' : ''}` }, String(d))); continue; }
      const r0 = rs[0]; const total = r0.fila ? nTemas.get(r0.fila.id) || 0 : 0; const pend = r0.fila ? nPend.get(r0.fila.id) || 0 : 0;
      const sel = R.tipo === r0.tipo && R.fecha === f && (r0.tipo !== 'otra' || R.otraId === r0.fila?.id);
      celdas.push(h('button', { type: 'button', class: `ac-mini-d reu${total ? ' con' : ''}${f < hoy ? ' pas' : ''}${esHoy ? ' hoy' : ''}${sel ? ' sel' : ''}`, style: `--c:${TIPOS[r0.tipo].color}`,
        title: `${TIPOS[r0.tipo].nombre}${r0.fila?.titulo ? ' · ' + r0.fila.titulo : ''} · ${fechaLarga(f)}${total ? ` · ${total} tema${total > 1 ? 's' : ''}${pend ? `, ${pend} sin tratar` : ', todos tratados'}` : ' · sin temas'}`,
        'aria-label': `${TIPOS[r0.tipo].nombre} ${fechaLarga(f)}`,
        onclick: () => { R.tipo = r0.tipo; R.fecha = f; R.mes = f.slice(0, 7); if (r0.tipo === 'otra') R.otraId = r0.fila.id; pintarPestañas(); pintar(); } },
      String(d), pend ? h('i', {}, String(pend)) : null));
    }
    return h('div', { class: 'card ac-mini' },
      h('div', { class: 'ac-mini-h' },
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Mes anterior', onclick: () => mover(-1) }, '◀'),
        h('span', {}, mesNombre.charAt(0).toUpperCase() + mesNombre.slice(1)),
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Mes siguiente', onclick: () => mover(1) }, '▶')),
      h('div', { class: 'ac-mini-g' }, ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((x) => h('span', { class: 'ac-mini-dow' }, x)), celdas),
      h('div', { class: 'ac-mini-ley small muted' },
        Object.values(TIPOS).map((t) => h('span', {}, h('i', { class: 'ac-punto', style: `background:${t.color}` }), t.nombre)),
        h('span', {}, h('i', { class: 'ac-punto aro' }), 'anillo: sin temas'), h('span', {}, h('i', { class: 'ac-punto' }), 'relleno: con temas (el número, los que faltan)')));
  }

  function selectorFecha() {
    if (R.tipo === 'otra') {
      const otras = reuniones.filter((r) => r.tipo === 'otra').sort((a, b) => b.fecha.localeCompare(a.fecha));
      const nf = h('input', { type: 'date', value: hoy, 'aria-label': 'Fecha de la nueva reunión' });
      const nt = h('input', { type: 'text', placeholder: 'Título de la reunión (p. ej. Reunión con familias de 1º)', 'aria-label': 'Título de la reunión' });
      const sel = h('select', { 'aria-label': 'Reunión' }, otras.map((r) => h('option', { value: r.id, selected: r.fecha === R.fecha && r.id === R.otraId }, `${fechaCorta(r.fecha)} · ${r.titulo || 'Sin título'}`)));
      sel.addEventListener('change', () => { const r = otras.find((x) => x.id === sel.value); irA(r.fecha); R.otraId = r.id; pintar(); });
      return h('div', { class: 'ac-reu-sel col' }, calendario(), h('div', { class: 'ac-reu-nav' }, otras.length ? sel : h('span', { class: 'muted' }, 'Todavía no hay reuniones sueltas.'),
        editor ? [nf, nt, h('button', { class: 'btn small primary', type: 'button', onclick: async () => {
          if (!nt.value.trim() || !nf.value) { toast('Pon fecha y título', 'error'); return; }
          try { const r = await api.ins('ac_reuniones', { tipo: 'otra', fecha: nf.value, titulo: nt.value.trim() }); irA(r.fecha); R.otraId = r.id; pintarLuego(); } catch (ex) { toast(ex.message, 'error'); }
        } }, 'Crear reunión')] : null));
    }
    const fechas = fechasFijas(R.tipo, hoy);
    const i = fechas.indexOf(R.fecha);
    return h('div', { class: 'ac-reu-sel col' }, calendario(),
      h('div', { class: 'ac-reu-nav' },
        h('button', { class: 'btn small', type: 'button', disabled: i <= 0, onclick: () => { irA(fechas[i - 1]); pintarLuego(); } }, '← Anterior'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { irA(proxima(R.tipo, hoy) || fechas[fechas.length - 1]); pintarLuego(); } }, 'Próxima'),
        h('button', { class: 'btn small', type: 'button', disabled: i < 0 || i >= fechas.length - 1, onclick: () => { irA(fechas[i + 1]); pintarLuego(); } }, 'Siguiente →')));
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

    async function nuevoTema(texto, tareaId, quien) {
      if (!texto.trim()) return;
      try {
        const r = await asegurar(R.tipo, R.fecha, fila?.titulo);
        const t = await api.ins('ac_reunion_temas', { reunion_id: r.id, texto: texto.trim(), tarea_id: tareaId || null, asignado_a: quien || null, orden: lista.length });
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
        const q = h('select', { 'aria-label': 'Responsable de la tarea' }, [h('option', { value: '' }, 'Sin asignar'), ...personas.map((u) => h('option', { value: u.id, selected: u.id === t.asignado_a }, u.nombre || u.email))]);
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
      const abierto = R.abiertos.has(t.id);
      const abrirNotas = () => { R.abiertos.add(t.id); pintar(); cuerpo.querySelector(`.ac-tema[data-id="${t.id}"] .ac-tema-n`)?.focus(); };
      const quien = quienSel(t.asignado_a, (v) => guardarTema(t, { asignado_a: v || null }), 'Responsable del tema');
      quien.disabled = !editor;
      return h('div', { class: `ac-tema${t.tratado ? ' hecho' : ''}`, dataset: { id: t.id } },
        h('div', { class: 'ac-tema-l1' },
          h('input', { type: 'checkbox', class: 'ac-cb', checked: t.tratado, disabled: !editor, 'aria-label': 'Tratado', onchange: (e) => guardarTema(t, { tratado: e.target.checked }) }),
          h('input', { type: 'text', class: 'ac-tema-t', value: t.texto, disabled: !editor, 'aria-label': 'Tema', onchange: (e) => { if (e.target.value.trim()) guardarTema(t, { texto: e.target.value.trim() }); else e.target.value = t.texto; } }),
          avatarDe(nombreDe(t.asignado_a), siglasDe.get(t.asignado_a)), quien,
          h('button', { type: 'button', class: `ac-tema-nb${t.notas ? ' con' : ''}`, title: t.notas ? 'Ver o editar las notas' : 'Añadir notas', 'aria-label': 'Notas', 'aria-expanded': String(abierto),
            onclick: () => { if (abierto) { R.abiertos.delete(t.id); pintar(); } else abrirNotas(); } }, '📝'),
          t.tarea_id ? (tar ? h('span', { class: 'ac-reu-tarea', title: 'Tarea enlazada' },
              h('span', { class: `ac-chip`, style: `--c:${tar.estado === 'hecha' ? '#2a7d4f' : '#2a5bd7'}` }, tar.estado === 'hecha' ? 'Hecha' : tar.estado === 'curso' ? 'En curso' : 'Tarea'),
              h('button', { type: 'button', class: 'link-btn small', title: 'Ver en Tareas', onclick: () => { verTarea?.(tar.titulo); } }, tar.titulo.slice(0, 60)),
              editor ? h('button', { class: 'ac-x', type: 'button', title: 'Quitar el enlace', 'aria-label': 'Quitar enlace', onclick: () => guardarTema(t, { tarea_id: null }) }, '⛓') : null)
            : h('span', { class: 'muted small' }, 'Tarea borrada'))
            : editor ? h('span', { class: 'ac-reu-acc' },
              h('button', { class: 'btn small ghost', type: 'button', onclick: () => { R.tareaEn = t.id; R.vincular = null; pintar(); } }, '+ Crear tarea'),
              h('button', { class: 'btn small ghost', type: 'button', onclick: () => { R.vincular = t.id; R.tareaEn = null; pintar(); } }, 'Enlazar tarea')) : null,
          editor ? h('button', { class: 'ac-x', type: 'button', title: 'Quitar tema', 'aria-label': 'Quitar tema', onclick: async () => {
            if (!(await confirmar({ titulo: 'Quitar tema', texto: t.texto, ok: 'Quitar', peligro: true }))) return;
            try { await api.del('ac_reunion_temas', t.id); temas.splice(temas.indexOf(t), 1); pintar(); } catch (ex) { toast(ex.message, 'error'); }
          } }, '✕') : null),
        abierto ? h('textarea', { class: 'ac-tema-n', rows: Math.min(6, Math.max(2, (t.notas || '').split('\n').length)), placeholder: 'Notas, comentarios, lo que se acordó…', disabled: !editor, 'aria-label': 'Notas del tema', onchange: (e) => guardarTema(t, { notas: e.target.value.trim() || null }) }, t.notas || '')
          : t.notas ? h('button', { type: 'button', class: 'ac-tema-prev', title: 'Pulsa para abrir y escribir', onclick: abrirNotas }, t.notas.split('\n')[0]) : null,
        formTarea, formVincular);
    };

    const nuevo = h('input', { type: 'text', placeholder: 'Añadir un tema a tratar… (Enter)', class: 'ac-tarea-nueva', disabled: !editor || (R.tipo === 'otra' && !fila), 'aria-label': 'Nuevo tema' });
    const nuevoQ = quienSel('', () => {}, 'Asignar el tema a'); nuevoQ.disabled = !editor || (R.tipo === 'otra' && !fila);
    nuevo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = nuevo.value; nuevo.value = ''; nuevoTema(v, null, nuevoQ.value); } });
    const notas = h('textarea', { class: 'ac-reu-notas', rows: 3, placeholder: 'Acta / acuerdos de la reunión…', disabled: !editor || (R.tipo === 'otra' && !fila), 'aria-label': 'Acuerdos de la reunión' }, fila?.notas || '');
    notas.addEventListener('change', async () => {
      try { const r = await asegurar(R.tipo, R.fecha, fila?.titulo); Object.assign(r, await api.upd('ac_reuniones', r.id, { notas: notas.value.trim() || null })); } catch (ex) { toast(ex.message, 'error'); }
    });
    const esFutura = R.fecha > hoy;
    clear(cuerpo,
      h('div', { class: 'card ac-reu-card' },
        h('div', { class: 'ac-grupo-h' }, h('span', {}, `${TIPOS[R.tipo].nombre}${fila?.titulo ? ' · ' + fila.titulo : ''} · ${fechaLarga(R.fecha)}`), h('span', { class: 'ac-prog-t' }, h('span', { class: 'ac-prog', 'aria-hidden': 'true' }, h('i', { style: `width:${lista.length ? Math.round(100 * lista.filter((t) => t.tratado).length / lista.length) : 0}%` })), `${lista.filter((t) => t.tratado).length}/${lista.length} tratados`)),
        h('div', { class: 'ac-reu-pad' },
          editor ? h('div', { class: 'ac-tema-nuevo' }, nuevo, nuevoQ) : null,
          lista.length ? lista.map(tema) : h('p', { class: 'muted small' }, R.tipo === 'otra' && !fila ? 'Crea una reunión para apuntar temas.' : esFutura ? 'Todavía no hay temas. Apunta aquí lo que hay que hablar y saldrá en la reunión.' : 'No se apuntó ningún tema.'),
          h('label', { class: 'field full' }, h('span', {}, 'Acuerdos'), notas))),
      pendientes.length ? h('div', { class: 'card ac-reu-card' },
        h('div', { class: 'ac-grupo-h' }, h('span', {}, 'Sin tratar en reuniones anteriores'), h('span', {}, pendientes.length)),
        h('div', { class: 'ac-reu-pad' }, pendientes.map((t) => h('div', { class: 'ac-tema' }, h('div', { class: 'ac-tema-l1' },
          h('span', { class: 'ac-tema-t pend' }, t.texto), t.asignado_a ? avatarDe(nombreDe(t.asignado_a), siglasDe.get(t.asignado_a)) : null, h('span', { class: 'muted small' }, fechaCorta(fechaDe(t))),
          editor ? h('button', { class: 'btn small', type: 'button', onclick: async () => { try { const r = await asegurar(R.tipo, R.fecha, fila?.titulo); Object.assign(t, await api.upd('ac_reunion_temas', t.id, { reunion_id: r.id, orden: lista.length })); pintar(); } catch (ex) { toast(ex.message, 'error'); } } }, 'Traer a esta reunión') : null,
          editor ? h('button', { class: 'btn small ghost', type: 'button', title: 'Darlo por tratado', onclick: () => guardarTema(t, { tratado: true }) }, 'Ya tratado') : null))))) : null);
    clear(selector, selectorFecha());
  }

  const selector = h('div', {});
  clear(view, cabecera('Tareas', 'Reuniones', conmutador),
    h('div', { class: 'ac-filtros' }, pestañas),
    h('div', { class: 'ac-reu-layout' }, selector, cuerpo));
  pintarPestañas();
  pintar();
}
