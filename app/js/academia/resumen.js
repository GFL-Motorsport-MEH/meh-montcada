// Resumen del módulo Academia: cifras del curso y lo que requiere atención.
import { h, clear, cargando, fmtEUR2, fmtFecha, hoyISO, MESES } from '../ui.js';
import * as api from './api.js';
import { cabecera, pill, nombreAlumno } from './kit.js';

export async function renderResumen(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const dinero = ctx.ve('ac_pagos'); // las cuotas solo se enseñan con el permiso de Pagos
  const [alumnos, grupos, cuotas, tutorias, tareas, bajas] = await Promise.all([api.alumnos(), api.grupos(curso.id), dinero ? api.cuotas(curso.id) : Promise.resolve([]), api.tutorias(), api.tareas(), api.bajas()]);
  const hoy = hoyISO();
  const inscritos = alumnos.filter((a) => a.estado === 'inscrito');
  const sinGrupo = new Set(); const enGrupo = new Set(grupos.flatMap((g) => g.miembros.filter((m) => !m.fecha_baja).map((m) => m.alumno_id)));
  for (const a of inscritos) if (!enGrupo.has(a.id)) sinGrupo.add(a.id);
  const pend = cuotas.filter((c) => c.estado === 'pendiente'); const mesIdx = MESES.indexOf(['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][new Date().getMonth()]);
  const vencidas = pend.filter((c) => c.concepto === 'welcome_pack' || MESES.indexOf(c.mes) <= mesIdx);
  const tutPend = tutorias.filter((t) => t.estado === 'pendiente').sort((a, b) => a.fecha.localeCompare(b.fecha));
  const tarPend = tareas.filter((t) => !t.hecha);
  const bajasCurso = bajas.filter((b) => (!curso.fecha_inicio || b.fecha_baja >= curso.fecha_inicio) && (!curso.fecha_fin || b.fecha_baja <= curso.fecha_fin));
  const kpi = (l, v, sub, href) => h(href ? 'a' : 'div', { class: 'card kpi' + (href ? ' kpi-link' : ''), href }, h('div', { class: 'label' }, l), h('div', { class: 'value' }, v), sub ? h('div', { class: 'sub' }, sub) : null);

  clear(view,
    cabecera(`Academia · ${curso.nombre}`, 'Resumen del curso'),
    alumnos.length ? null : h('div', { class: 'banner warn' }, h('strong', {}, 'Todavía no hay alumnos cargados. '), h('a', { href: '#/ac_importar' }, 'Importa el Excel «Control Alumnos»'), ' para empezar (o crea alumnos a mano desde Alumnos).'),
    h('div', { class: 'kpi-row kpi-4' },
      kpi('Alumnos inscritos', String(inscritos.length), `${alumnos.filter((a) => a.estado === 'prematricula').length} en pre-matrícula`, '#/ac_alumnos'),
      kpi('Grupos activos', String(grupos.filter((g) => g.activo).length), sinGrupo.size ? `${sinGrupo.size} inscritos sin grupo` : 'Todos los inscritos tienen grupo', '#/ac_grupos'),
      dinero ? kpi('Cuotas por cobrar', fmtEUR2(vencidas.reduce((s, c) => s + Number(c.importe), 0)), `${vencidas.length} cuotas hasta este mes`, '#/ac_pagos')
        : kpi('Tutorías pendientes', String(tutPend.length), `${tutPend.filter((t) => t.fecha < hoy).length} vencidas`, ctx.veAlgo('ac_tutorias') ? '#/ac_tutorias' : null),
      kpi('Bajas del curso', String(bajasCurso.length), `${bajas.length} en total`, '#/ac_bajas')),
    h('div', { class: 'ac-dos-col' },
      !ctx.ve('ac_tutorias') ? null : h('div', { class: 'card' }, h('h3', { class: 'sub-titulo' }, 'Tutorías pendientes'),
        tutPend.length ? tutPend.slice(0, 6).map((t) => h('div', { class: 'ac-fila' }, h('span', {}, fmtFecha(t.fecha), ' · ', h('strong', {}, nombreAlumno(t.alumno))), t.fecha < hoy ? pill('vencida', 'warn') : null)) : h('div', { class: 'muted small' }, 'Ninguna pendiente.'),
        h('a', { class: 'btn small', href: '#/ac_tutorias' }, 'Ver tutorías')),
      !ctx.ve('ac_tareas') ? null : h('div', { class: 'card' }, h('h3', { class: 'sub-titulo' }, 'Tareas pendientes'),
        tarPend.length ? tarPend.sort((a, b) => b.prioridad - a.prioridad || (a.vence || '9999').localeCompare(b.vence || '9999')).slice(0, 6).map((t) => h('div', { class: 'ac-fila' }, h('span', {}, t.titulo), t.vence ? pill(fmtFecha(t.vence), t.vence < hoy ? 'warn' : 'off') : null)) : h('div', { class: 'muted small' }, 'Todo al día.'),
        h('a', { class: 'btn small', href: '#/ac_tareas' }, 'Ver tareas'))));
}
