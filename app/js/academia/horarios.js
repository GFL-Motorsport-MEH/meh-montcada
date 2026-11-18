// Grupos y horarios: grupos del curso con sus sesiones semanales y alumnos; parrilla semanal; profesoras y aulas.
import { h, clear, cargando, toast, confirmar, normalizar } from '../ui.js';
import * as api from './api.js';
import { colorGrupo, campo, txt, area, numero, sel, drawer, cabecera, tabla, pill, nombreAlumno, hhmm, DIAS, DIAS_CORTO, guardarBoton, buscadorAlumno, refrescar } from './kit.js';

let vistaActual = 'lista';
export const sesionesTexto = (g) => (g.sesiones || []).slice().sort((a, b) => a.dia - b.dia || a.hora_inicio.localeCompare(b.hora_inicio)).map((s) => `${DIAS_CORTO[s.dia]} ${hhmm(s.hora_inicio)}-${hhmm(s.hora_fin)}`).join(' · ');
const activos = (g) => g.miembros.filter((m) => !m.fecha_baja);

export async function renderHorarios(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const [grupos, profes, aulas, alumnos, ls] = await Promise.all([api.grupos(curso.id), api.profesoras(), api.aulas(), api.alumnos(), api.listas()]);
  const pPor = new Map(profes.map((p) => [p.id, p])); const aPor = new Map(aulas.map((a) => [a.id, a]));
  const editor = ctx.puedeEditar();
  const recargar = () => { api.invalidar(); refrescar(); };
  const cont = h('div');
  const seg = h('div', { class: 'segmented', role: 'tablist' }, [['lista', 'Grupos'], ['parrilla', 'Parrilla semanal'], ['recursos', 'Profesoras y aulas']].map(([k, l]) =>
    h('button', { class: 'seg-btn', role: 'tab', type: 'button', 'aria-selected': String(vistaActual === k), onclick: () => { vistaActual = k; seg.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-selected', String(b.textContent === l))); pintar(); } }, l)));

  function pintar() {
    if (vistaActual === 'lista') {
      clear(cont, tabla([
        { t: 'Grupo', v: (g) => h('strong', {}, g.nombre) },
        { t: 'Modalidad · nivel', v: (g) => [g.modalidad, g.nivel].filter(Boolean).join(' · ') },
        { t: 'Profesora', v: (g) => (pPor.get(g.profesora_id) ? h('span', {}, h('span', { class: 'ac-punto', style: `background:${pPor.get(g.profesora_id).color}` }), pPor.get(g.profesora_id).nombre) : '') },
        { t: 'Aula', v: (g) => aPor.get(g.aula_id)?.nombre || '' },
        { t: 'Horario', v: sesionesTexto },
        { t: 'Alumnos', num: true, v: (g) => { const n = activos(g).length; return pill(`${n}/${g.capacidad}`, n > g.capacidad ? 'warn' : n === g.capacidad ? 'ok' : 'off'); } },
        { t: '', v: (g) => (g.activo ? '' : pill('inactivo')) },
      ], grupos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true })), { onClick: (g) => abrirGrupo(g, { ctx, curso, profes, aulas, alumnos, ls, recargar }), vacio: 'Aún no hay grupos en este curso. Crea el primero con «+ Nuevo grupo».' }));
    } else if (vistaActual === 'parrilla') clear(cont, parrilla(grupos, pPor));
    else clear(cont, recursos(profes, aulas, editor, recargar));
  }
  clear(view, cabecera(`Grupos y horarios · ${curso.nombre}`, `${grupos.length} grupos`, seg, editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrirGrupo(null, { ctx, curso, profes, aulas, alumnos, ls, recargar }) }, '+ Nuevo grupo') : null), cont);
  pintar();
}

// ---------- parrilla (días × franjas) ----------
function parrilla(grupos, pPor) {
  const filas = new Map();
  for (const g of grupos.filter((x) => x.activo)) for (const s of g.sesiones) { const k = hhmm(s.hora_inicio); if (!filas.has(k)) filas.set(k, new Map()); const d = filas.get(k); if (!d.has(s.dia)) d.set(s.dia, []); d.get(s.dia).push({ g, s }); }
  if (!filas.size) return h('div', { class: 'card empty' }, 'Añade sesiones a los grupos para ver la parrilla.');
  const dias = [1, 2, 3, 4, 5, 6];
  const quien = (g, s) => pPor.get(s.profesora_id || g.profesora_id);
  const chip = ({ g, s }) => h('span', { class: 'ac-chip', style: `--c:${colorGrupo(g)}`, title: `${g.nombre} ${hhmm(s.hora_inicio)}-${hhmm(s.hora_fin)} · ${quien(g, s)?.nombre || 'sin profesora'}` }, g.nombre);
  const fila = (k) => h('tr', {}, h('th', {}, k), dias.map((d) => h('td', {}, (filas.get(k).get(d) || []).map(chip))));
  return h('div', { class: 'table-wrap card-tabla' }, h('table', { class: 'data ac-parrilla' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Hora'), dias.map((d) => h('th', {}, DIAS[d])))),
    h('tbody', {}, [...filas.keys()].sort().map(fila))));
}

// ---------- profesoras y aulas ----------
function recursos(profes, aulas, editor, recargar) {
  const lista = (titulo, filas, tabla_, extra, nuevo) => h('div', { class: 'card' }, h('h3', { class: 'sub-titulo' }, titulo),
    h('div', {}, filas.map((f) => extra(f))), editor ? nuevo : null);
  const guardarCampo = async (tabla_, id, parche) => { try { await api.upd(tabla_, id, parche); toast('Guardado'); } catch (ex) { toast(ex.message, 'error'); } };
  const nuevoP = (() => { const i = txt('', { placeholder: 'Nombre de la profesora' }); return h('div', { class: 'fila-anadir' }, i, h('button', { class: 'btn small', type: 'button', onclick: async () => { if (!i.value.trim()) return; try { await api.ins('ac_profesoras', { nombre: i.value.trim(), orden: profes.length }); recargar(); } catch (ex) { toast(ex.message, 'error'); } } }, 'Añadir')); })();
  const nuevoA = (() => { const i = txt('', { placeholder: 'Nombre del aula (L1, L2, EXT…)' }); return h('div', { class: 'fila-anadir' }, i, h('button', { class: 'btn small', type: 'button', onclick: async () => { if (!i.value.trim()) return; try { await api.ins('ac_aulas', { nombre: i.value.trim(), orden: aulas.length }); recargar(); } catch (ex) { toast(ex.message, 'error'); } } }, 'Añadir')); })();
  return h('div', { class: 'ac-dos-col' },
    lista('Profesoras', profes, null, (p) => h('div', { class: 'ac-fila' },
      h('input', { type: 'color', value: p.color, disabled: !editor, onchange: (e) => guardarCampo('ac_profesoras', p.id, { color: e.target.value }), 'aria-label': `Color de ${p.nombre}` }),
      h('input', { type: 'text', class: 'cell cell-text', value: p.nombre, disabled: !editor, onchange: (e) => guardarCampo('ac_profesoras', p.id, { nombre: e.target.value.trim() || p.nombre }) }),
      h('input', { type: 'number', step: '0.5', class: 'cell ac-imp', value: p.horas_semana ?? '', placeholder: 'h/sem', title: 'Horas semanales de contrato', disabled: !editor, onchange: (e) => guardarCampo('ac_profesoras', p.id, { horas_semana: e.target.value ? Number(e.target.value) : null }) }),
      h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: p.activa, disabled: !editor, onchange: (e) => guardarCampo('ac_profesoras', p.id, { activa: e.target.checked }) }), ' activa')), nuevoP),
    lista('Aulas', aulas, null, (a) => h('div', { class: 'ac-fila' },
      h('input', { type: 'text', class: 'cell cell-text', value: a.nombre, disabled: !editor, onchange: (e) => guardarCampo('ac_aulas', a.id, { nombre: e.target.value.trim() || a.nombre }) }),
      h('input', { type: 'number', class: 'cell ac-imp', value: a.capacidad ?? '', placeholder: 'aforo', disabled: !editor, onchange: (e) => guardarCampo('ac_aulas', a.id, { capacidad: e.target.value ? Number(e.target.value) : null }) }),
      h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: a.activa, disabled: !editor, onchange: (e) => guardarCampo('ac_aulas', a.id, { activa: e.target.checked }) }), ' activa')), nuevoA));
}

// ---------- ficha del grupo ----------
function abrirGrupo(g, { ctx, curso, profes, aulas, alumnos, ls, recargar }) {
  const editor = ctx.puedeEditar();
  const d = drawer({ titulo: g ? `Grupo ${g.nombre}` : 'Nuevo grupo', ancho: 720 });
  const F = {
    nombre: txt(g?.nombre, { placeholder: 'KIDS 1, TEENS 5, ADULTS 6…' }), modalidad: sel(ls.modalidad || [], g?.modalidad, { vacio: '—' }), nivel: txt(g?.nivel, { placeholder: 'L1, A2, B1…' }),
    prof: sel(profes.filter((p) => p.activa || p.id === g?.profesora_id).map((p) => [p.id, p.nombre]), g?.profesora_id, { vacio: 'Sin asignar' }),
    aula: sel(aulas.filter((a) => a.activa || a.id === g?.aula_id).map((a) => [a.id, a.nombre]), g?.aula_id, { vacio: 'Sin asignar' }),
    cap: numero(g?.capacidad ?? 8, { step: '1' }), anios: txt(g?.anios_nacimiento, { placeholder: '2015-2016' }), notas: area(g?.notas),
    activo: h('input', { type: 'checkbox', checked: g ? g.activo : true }),
  };
  let sesiones = (g?.sesiones || []).map((s) => ({ ...s })).sort((a, b) => a.dia - b.dia);
  const quitadas = [];
  const filasSes = h('div');
  const pintarSes = () => clear(filasSes, sesiones.map((s, i) => h('div', { class: 'ac-fila' },
    sel(DIAS.slice(1, 7).map((n, k) => [String(k + 1), n]), String(s.dia), { onchange: (e) => { s.dia = Number(e.target.value); }, disabled: !editor }),
    h('input', { type: 'time', value: hhmm(s.hora_inicio), disabled: !editor, onchange: (e) => { s.hora_inicio = e.target.value; } }), '–',
    h('input', { type: 'time', value: hhmm(s.hora_fin), disabled: !editor, onchange: (e) => { s.hora_fin = e.target.value; } }),
    editor ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => { if (s.id) quitadas.push(s.id); sesiones.splice(i, 1); pintarSes(); } }, 'Quitar') : null)));
  pintarSes();
  d.cuerpo.append(
    h('div', { class: 'form-section' }, h('h3', {}, 'Grupo'), campo('Nombre', F.nombre, { req: true }), campo('Modalidad', F.modalidad), campo('Nivel', F.nivel), campo('Capacidad', F.cap),
      campo('Profesora', F.prof), campo('Aula', F.aula), campo('Años de nacimiento', F.anios), h('label', { class: 'check' }, F.activo, ' Grupo activo'), campo('Notas', F.notas, { full: true })),
    h('div', { class: 'form-section' }, h('h3', {}, 'Sesiones semanales'), h('div', { class: 'full' }, filasSes, editor ? h('button', { class: 'btn small', type: 'button', onclick: () => { sesiones.push({ dia: 1, hora_inicio: '17:00', hora_fin: '18:00' }); pintarSes(); } }, '+ Añadir sesión') : null)));

  if (g) {
    const cajaAl = h('div');
    const buscador = buscadorAlumno(alumnos, { soloActivos: true, placeholder: 'Añadir alumno al grupo…' });
    const pintarAl = () => clear(cajaAl, activos(g).map((m) => { const a = alumnos.find((x) => x.id === m.alumno_id); return h('div', { class: 'ac-fila' }, h('span', {}, nombreAlumno(a)), editor ? h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { try { await api.upd('ac_alumno_grupo', m.id, { fecha_baja: new Date().toISOString().slice(0, 10) }); m.fecha_baja = 'x'; pintarAl(); recargarFondo(); } catch (ex) { toast(ex.message, 'error'); } } }, 'Quitar') : null); }), activos(g).length ? null : h('div', { class: 'muted small' }, 'Sin alumnos en el grupo.'));
    const recargarFondo = () => api.invalidar();
    pintarAl();
    const add = h('button', { class: 'btn small', type: 'button', onclick: async () => {
      const a = buscador.getAlumno(); if (!a) { toast('Elige un alumno de la lista.', 'error'); return; }
      if (activos(g).some((m) => m.alumno_id === a.id)) { toast('Ya está en el grupo.', 'error'); return; }
      try { const m = await api.insMany('ac_alumno_grupo', [{ alumno_id: a.id, grupo_id: g.id, fecha_baja: null }], { onConflict: 'alumno_id,grupo_id' }); g.miembros.push(m[0]); buscador.input.value = ''; pintarAl(); } catch (ex) { toast(ex.message, 'error'); }
    } }, 'Añadir');
    d.cuerpo.append(h('div', { class: 'form-section' }, h('h3', {}, 'Alumnos del grupo'), h('div', { class: 'full' }, cajaAl, editor ? h('div', { class: 'ac-fila' }, buscador, add) : null)));
  }

  const guardar = guardarBoton(g ? 'Guardar cambios' : 'Crear grupo', async () => {
    if (!F.nombre.value.trim()) { toast('Falta el nombre del grupo.', 'error'); return; }
    if (sesiones.some((s) => !s.hora_inicio || !s.hora_fin || s.hora_fin <= s.hora_inicio)) { toast('Revisa las horas de las sesiones (el fin debe ser posterior al inicio).', 'error'); return; }
    try {
      const fila = { nombre: F.nombre.value.trim(), modalidad: F.modalidad.value || null, nivel: F.nivel.value.trim() || null, profesora_id: F.prof.value || null, aula_id: F.aula.value || null,
        capacidad: Number(F.cap.value || 8), anios_nacimiento: F.anios.value.trim() || null, notas: F.notas.value.trim() || null, activo: F.activo.checked };
      const gr = g ? await api.upd('ac_grupos', g.id, fila) : await api.ins('ac_grupos', { curso_id: curso.id, ...fila });
      for (const id of quitadas) await api.del('ac_sesiones', id);
      for (const s of sesiones) {
        const datos = { dia: s.dia, hora_inicio: s.hora_inicio, hora_fin: s.hora_fin };
        if (s.id) await api.upd('ac_sesiones', s.id, datos); else await api.ins('ac_sesiones', { grupo_id: gr.id, ...datos });
      }
      toast('Grupo guardado'); d.cerrar(); recargar();
    } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
  });
  guardar.disabled = !editor;
  const borrar = g && ctx.esAdmin() ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
    if (!await confirmar({ titulo: `Eliminar el grupo ${g.nombre}`, texto: 'Se borran sus sesiones y la pertenencia de los alumnos. Los alumnos no se borran.', ok: 'Eliminar', peligro: true })) return;
    try { await api.del('ac_grupos', g.id); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } }, 'Eliminar') : h('span');
  d.pie.append(borrar, h('div', { class: 'ac-fila' }, h('button', { class: 'btn', type: 'button', onclick: () => { d.cerrar(); recargar(); } }, 'Cerrar'), editor ? guardar : null));
}
