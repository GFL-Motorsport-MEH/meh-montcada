// ALUMNOS · Tareas y material: tareas extra y material didáctico para un alumno o para todo un grupo (una fila por alumno, para seguir cada entrega).
import { h, clear, cargando, toast, confirmar, hoyISO } from '../ui.js';
import * as api from './api.js';
import { campo, sel, txt, area, fecha, drawer, cabecera, tabla, guardarBoton, buscadorAlumno, nombreAlumno, refrescar, pill } from '../academia/kit.js';
import { ESTADOS_TAREA, familiaPill, filtroAlumno, casillaFamilia } from './util.js';

const TIPOS = [['tarea', 'Tarea extra'], ['material', 'Material didáctico']];
const ESTADO_PILL = { pendiente: 'warn', entregada: 'ok', revisada: 'off' };

export async function renderTareas(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const [alumnos, profes, filas] = await Promise.all([api.alumnos(), api.profesoras(), api.tareas()]);
  const editor = ctx.edita('al_tareas');
  const yo = ctx.miProfesora(profes);
  const porId = new Map(alumnos.map((a) => [a.id, a]));
  let estado = 'pendiente'; let tipo = '';
  const cont = h('div');
  const fa = filtroAlumno(alumnos, () => pintar());
  const selEstado = sel([['', 'Todos los estados'], ...ESTADOS_TAREA], estado, { onchange: (e) => { estado = e.target.value; pintar(); }, 'aria-label': 'Estado' });
  const selTipo = sel([['', 'Tareas y material'], ...TIPOS], tipo, { onchange: (e) => { tipo = e.target.value; pintar(); }, 'aria-label': 'Tipo' });
  const hoy = hoyISO();

  function pintar() {
    const idA = fa.get();
    const lista = filas.filter((t) => (!idA || t.alumno_id === idA) && (!estado || t.estado === estado) && (!tipo || t.tipo === tipo));
    clear(cont, tabla([
      { t: 'Tipo', v: (t) => (t.tipo === 'material' ? 'Material' : 'Tarea') },
      { t: 'Título', v: (t) => h('strong', {}, t.titulo), s: (t) => t.titulo },
      { t: 'Alumno', v: (t) => nombreAlumno(porId.get(t.alumno_id)), s: (t) => nombreAlumno(porId.get(t.alumno_id)) },
      { t: 'Asignada', s: (t) => t.fecha_asignada, v: (t) => (t.fecha_asignada ? new Date(t.fecha_asignada).toLocaleDateString('es-ES') : '') },
      { t: 'Entrega', s: (t) => t.fecha_entrega || '', v: (t) => (t.fecha_entrega ? h('span', {}, new Date(t.fecha_entrega).toLocaleDateString('es-ES'), t.estado === 'pendiente' && t.fecha_entrega < hoy ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'vencida') : null) : '') },
      { t: 'Estado', v: (t) => pill(ESTADOS_TAREA.find(([k]) => k === t.estado)?.[1] || t.estado, ESTADO_PILL[t.estado]), s: (t) => t.estado },
      { t: 'Archivo', sin: true, v: (t) => (t.ruta ? h('button', { class: 'btn small ghost', type: 'button', onclick: (ev) => { ev.stopPropagation(); api.abrir(api.BUCKET_MATERIAL, t.ruta).catch((ex) => toast(ex.message, 'error')); } }, 'Abrir') : t.enlace ? h('a', { href: t.enlace, target: '_blank', rel: 'noopener', onclick: (ev) => ev.stopPropagation() }, 'Enlace') : '') },
      { t: 'Familia', v: (t) => familiaPill(t.visible_familia), s: (t) => (t.visible_familia ? 'visible' : 'interno') },
    ], lista, { onClick: editor ? (t) => abrir(t) : undefined, vacio: 'No hay tareas ni material con este filtro.' }));
  }

  async function abrir(t) {
    const gs = t ? [] : (await api.grupos(curso.id)).filter((g) => g.activo !== false).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
    const d = drawer({ titulo: t ? `${t.tipo === 'material' ? 'Material' : 'Tarea'} · ${nombreAlumno(porId.get(t.alumno_id))}` : 'Nueva tarea o material', ancho: 560 });
    const F = { tipo: sel(TIPOS, t?.tipo || 'tarea'), titulo: txt(t?.titulo, { placeholder: 'Unit 4 · repaso de verbos irregulares' }), desc: area(t?.descripcion), enlace: txt(t?.enlace, { placeholder: 'https://…' }),
      arch: h('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.doc,.docx,.mp3,.mp4' }), asig: fecha(t?.fecha_asignada || hoy), entrega: fecha(t?.fecha_entrega),
      estado: sel(ESTADOS_TAREA, t?.estado || 'pendiente'), prof: sel(profes.filter((p) => p.activa || p.id === t?.profesora_id).map((p) => [p.id, p.nombre]), t?.profesora_id || yo?.id, { vacio: '—' }), fam: casillaFamilia(t ? t.visible_familia : true),
      dest: sel([['alumno', 'Un alumno'], ['grupo', 'Todo un grupo']], 'alumno'), al: buscadorAlumno(alumnos, { soloActivos: true }), grupo: sel(gs.map((g) => [g.id, g.nombre]), '', { vacio: 'Elige grupo…' }) };
    const cDest = campo('Para', h('span', { class: 'al-dest' }, F.dest, F.al, F.grupo), { full: true });
    F.grupo.hidden = true;
    F.dest.addEventListener('change', () => { F.al.hidden = F.dest.value !== 'alumno'; F.grupo.hidden = F.dest.value !== 'grupo'; });
    d.cuerpo.append(h('div', { class: 'form-section' }, t ? null : cDest, campo('Tipo', F.tipo), campo('Estado', F.estado), campo('Título', F.titulo, { full: true, req: true }), campo('Descripción', F.desc, { full: true }),
      campo('Enlace', F.enlace, { full: true }), campo(t?.ruta ? 'Cambiar archivo' : 'Archivo (PDF, imagen, audio…)', F.arch, { full: true }), campo('Asignada', F.asig), campo('Entrega', F.entrega), campo('Profesora', F.prof), h('div', { class: 'full' }, F.fam)),
      t?.lote ? h('div', { class: 'small muted' }, 'Esta tarea se asignó a todo un grupo; aquí cambias solo la de este alumno.') : null);
    d.pie.append(t ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      const otros = t.lote ? filas.filter((x) => x.lote === t.lote).length : 1;
      const todos = otros > 1 && await confirmar({ titulo: 'Quitar del grupo', texto: `Se asignó a ${otros} alumnos a la vez. «Quitar a todos» la borra de todos; si no, solo de este alumno.`, ok: 'Quitar a todos', peligro: true });
      if (!todos && !await confirmar({ titulo: 'Quitar', texto: `Se quitará «${t.titulo}» de este alumno.`, ok: 'Quitar', peligro: true })) return;
      try { if (todos) await api.delWhere('al_tareas_extra', 'lote', t.lote); else await api.del('al_tareas_extra', t.id); await api.quitarArchivo(api.BUCKET_MATERIAL, todos || otros <= 1 ? t.ruta : null); toast('Quitada'); d.cerrar(); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
    } }, 'Quitar') : null, guardarBoton('Guardar', async () => {
      if (!F.titulo.value.trim()) { toast('Pon un título.', 'error'); return; }
      let destinos;
      if (t) destinos = [porId.get(t.alumno_id)];
      else if (F.dest.value === 'grupo') {
        const g = gs.find((x) => x.id === F.grupo.value);
        if (!g) { toast('Elige un grupo.', 'error'); return; }
        destinos = g.miembros.filter((m) => !m.fecha_baja).map((m) => porId.get(m.alumno_id)).filter(Boolean);
        if (!destinos.length) { toast('Ese grupo no tiene alumnos.', 'error'); return; }
      } else { const a = F.al.getAlumno(); if (!a) { toast('Elige un alumno de la lista.', 'error'); return; } destinos = [a]; }
      try {
        const base = { tipo: F.tipo.value, titulo: F.titulo.value.trim(), descripcion: F.desc.value.trim() || null, enlace: F.enlace.value.trim() || null, fecha_asignada: F.asig.value || hoy, fecha_entrega: F.entrega.value || null, estado: F.estado.value, profesora_id: F.prof.value || null, visible_familia: F.fam.input.checked };
        const f = F.arch.files[0];
        if (f) { base.ruta = await api.subir(api.BUCKET_MATERIAL, destinos[0].id, f); base.nombre_archivo = f.name; }
        if (t) await api.upd('al_tareas_extra', t.id, base);
        else {
          const lote = destinos.length > 1 ? crypto.randomUUID() : null;
          const grupoId = F.dest.value === 'grupo' ? F.grupo.value : null;
          await api.insMany('al_tareas_extra', destinos.map((a) => ({ ...base, alumno_id: a.id, grupo_id: grupoId, lote })));
        }
        toast(t ? 'Guardada' : `Asignada a ${destinos.length} alumno${destinos.length === 1 ? '' : 's'}`); d.cerrar(); refrescar();
      } catch (ex) { toast(ex.message, 'error'); }
    }));
  }

  clear(view, cabecera('Tareas y material', 'Tareas extra y material didáctico para alumnos o grupos', editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrir(null) }, '+ Nueva') : null),
    h('div', { class: 'filters filters-3' }, fa.el, selTipo, selEstado), cont);
  pintar();
}
