// ALUMNOS · Ficha 360º: todo lo de un alumno en una pantalla (datos, grupo y horario, notas, tareas, informes, tutorías, biblioteca y mascotas,
// documentación, actividades, comunicaciones y próximas fechas del calendario). Cada tarjeta solo sale si el usuario tiene ese permiso.
// «Ver como la familia» enseña solo lo marcado como visible: es lo que mostrará el futuro portal.
import { h, clear, cargando, toast, fmtFecha, hoyISO } from '../ui.js';
import * as api from './api.js';
import { buscadorAlumno, nombreAlumno, cabecera, pill, edad, pillNivel, DIAS, hhmm } from '../academia/kit.js';
import { leerV, guardarV } from '../vista.js';
import { CLAVE_ALUMNO, irA, esActivo, nota, media, NOM_DOC, OBLIGATORIOS, ESTADOS_TAREA, diasDesde } from './util.js';

const ESTADO_AL = { inscrito: ['Inscrito', 'ok'], prematricula: ['Prematrícula', 'warn'], baja: ['Baja', 'off'] };

export async function renderFicha(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const alumnos = await api.alumnos();
  let id = leerV(CLAVE_ALUMNO, '');
  if (!alumnos.some((a) => a.id === id)) id = '';
  let familia = leerV('al.ficha.familia', false);
  const cont = h('div');
  const b = buscadorAlumno(alumnos, { valorId: id, placeholder: 'Busca un alumno por apellido o nombre…' });
  const elegir = () => { const a = b.getAlumno(); if (a && a.id !== id) { id = a.id; guardarV(CLAVE_ALUMNO, id); pintar(); } };
  b.input.addEventListener('change', elegir);
  const chkFam = h('input', { type: 'checkbox', checked: familia, onchange: (e) => { familia = e.target.checked; guardarV('al.ficha.familia', familia); pintar(); } });

  async function pintar() {
    if (!id) {
      clear(cont, h('div', { class: 'card empty' }, alumnos.length ? 'Elige un alumno para ver su ficha completa.' : 'Todavía no tienes alumnos asignados. Aparecerán aquí los de tus grupos y tutorías.'));
      return;
    }
    clear(cont, cargando());
    const a = alumnos.find((x) => x.id === id);
    const ve = (k) => ctx.veAlgo(k);
    const quiet = (p) => p.catch(() => []);
    const [evals, tareas, informes, msgs, docs, ins, acts, tuts, prest, anots, grupos, profes, aulas, marcas, recs] = await Promise.all([
      ve('al_notas') ? quiet(api.evaluaciones(id)) : [], ve('al_tareas') ? quiet(api.tareas(id)) : [], ve('al_informes') ? quiet(api.informes(id)) : [], ve('al_comunicaciones') ? quiet(api.mensajes(id)) : [],
      ve('al_documentos') ? quiet(api.docsFamilia(id)) : [], ve('al_actividades') ? quiet(api.inscritos({ alumnoId: id })) : [], ve('al_actividades') ? quiet(api.actividades()) : [],
      ve('ac_tutorias') ? quiet(api.tutorias()) : [], ve('ac_biblioteca') ? quiet(api.prestamos()) : [], quiet(api.anotaciones(id)),
      quiet(api.grupos(curso.id)), quiet(api.profesoras()), quiet(api.aulas()), quiet(api.calendarioDias(curso.id)), ve('ac_recogidas') ? quiet(api.recogidas(curso.id)) : [],
    ]);
    const pf = (l) => (familia ? l.filter((x) => x.visible_familia) : l);
    const card = (titulo, cuerpo, { ruta, txt = 'Ver todo →' } = {}) => h('section', { class: 'card al-card' },
      h('div', { class: 'al-card-h' }, h('h3', {}, titulo), ruta ? h('button', { class: 'link-btn', type: 'button', onclick: () => irA(ruta, id) }, txt) : null), cuerpo);
    const vacio = (t) => h('div', { class: 'muted' }, t);
    const lista = (items) => h('ul', { class: 'al-lista' }, items.map((x) => h('li', {}, x)));
    const cards = [];

    // --- datos ---
    const r = a.responsable;
    const [estTxt, estTipo] = ESTADO_AL[a.estado] || [a.estado, 'off'];
    cards.push(card('Datos', [h('dl', { class: 'al-datos' },
      h('dt', {}, 'Estado'), h('dd', {}, pill(estTxt, estTipo)),
      h('dt', {}, 'Edad'), h('dd', {}, a.fecha_nacimiento ? `${edad(a.fecha_nacimiento)} años · ${fmtFecha(a.fecha_nacimiento)}` : '—'),
      h('dt', {}, 'Nivel'), h('dd', {}, a.nivel ? pillNivel(a.nivel) : '—'),
      h('dt', {}, 'Modalidad'), h('dd', {}, a.modalidad || '—'),
      h('dt', {}, 'Colegio'), h('dd', {}, a.colegio || '—'),
      h('dt', {}, 'Intolerancias'), h('dd', {}, a.intolerancias || '—'),
      h('dt', {}, 'Imágenes (RRSS)'), h('dd', {}, a.autoriza_rrss === true ? 'Autorizadas' : a.autoriza_rrss === false ? 'No autorizadas' : '—'),
      h('dt', {}, 'Responsable'), h('dd', {}, r ? [`${r.nombre || ''} ${r.apellidos || ''}`.trim(), r.telefono ? ` · ${r.telefono}` : '', r.email ? [' · ', h('a', { href: `mailto:${r.email}` }, r.email)] : ''] : '—')),
      ve('ac_alumnos') ? h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn small ghost', type: 'button', onclick: () => { location.hash = '#/ac_alumnos'; } }, 'Abrir en Academia → Alumnos')) : null]));

    // --- grupo y horario ---
    const mios = grupos.filter((g) => g.miembros?.some((m) => m.alumno_id === id && !m.fecha_baja));
    const nProf = (pid) => profes.find((p) => p.id === pid)?.nombre || '';
    const nAula = (aid) => aulas.find((x) => x.id === aid)?.nombre || '';
    const sesiones = mios.flatMap((g) => (g.sesiones || []).map((s) => ({ g, s }))).sort((x, y) => x.s.dia - y.s.dia || hhmm(x.s.hora_inicio).localeCompare(hhmm(y.s.hora_inicio)));
    cards.push(card('Grupo y horario', mios.length ? [h('div', {}, mios.map((g) => h('span', { class: 'pill', style: 'margin-right:6px' }, g.nombre, nProf(g.profesora_id) ? ` · ${nProf(g.profesora_id)}` : ''))),
      sesiones.length ? lista(sesiones.map(({ g, s }) => [h('strong', {}, `${DIAS[s.dia] || ''} ${hhmm(s.hora_inicio)}–${hhmm(s.hora_fin)}`), ` · ${g.nombre}`, nAula(s.aula_id || g.aula_id) ? ` · ${nAula(s.aula_id || g.aula_id)}` : ''])) : vacio('El grupo todavía no tiene horario.')] : vacio(`No está en ningún grupo del curso ${curso.nombre || ''}.`),
      ve('ac_grupos') ? { ruta: 'ac_horarios', txt: 'Ver horarios →' } : {}));

    // --- notas ---
    if (ve('al_notas')) {
      const ev = pf(evals);
      const pers = [...new Set(ev.map((e) => e.periodo))];
      cards.push(card('Notas', ev.length ? [h('div', { class: 'al-chips' }, pers.map((p) => { const m = media(ev.filter((e) => e.periodo === p)); return h('span', { class: 'pill' }, `${p}: `, h('strong', {}, m === null ? '—' : nota(Math.round(m * 100) / 100))); })),
        lista(ev.slice(0, 5).map((e) => [h('strong', {}, `${e.periodo} · ${e.area}`), e.nota !== null ? ` — ${nota(e.nota)}` : '', e.valoracion ? ` · ${e.valoracion}` : '']))] : vacio('Sin notas todavía.'), { ruta: 'al_notas' }));
    }
    // --- tareas y material ---
    if (ve('al_tareas')) {
      const t = pf(tareas);
      const pend = t.filter((x) => x.estado === 'pendiente');
      cards.push(card('Tareas y material', t.length ? [h('div', { class: 'small muted' }, `${pend.length} pendiente${pend.length === 1 ? '' : 's'} de ${t.length}`),
        lista(t.slice(0, 5).map((x) => [h('strong', {}, x.titulo), ` · ${x.tipo === 'material' ? 'material' : 'tarea'}`, x.fecha_entrega ? ` · entrega ${fmtFecha(x.fecha_entrega)}` : '', ` · ${ESTADOS_TAREA.find(([k]) => k === x.estado)?.[1] || x.estado}`]))] : vacio('Sin tareas ni material.'), { ruta: 'al_tareas' }));
    }
    // --- informes y notas de profesoras ---
    if (ve('al_informes')) {
      const inf = familia ? informes.filter((x) => x.estado === 'publicado') : informes;
      const an = pf(anots);
      cards.push(card('Informes y notas de profesoras', [inf.length ? lista(inf.slice(0, 4).map((x) => [h('strong', {}, x.titulo), ` · ${x.periodo}`, x.estado === 'borrador' ? ' · borrador' : ''])) : vacio('Sin informes.'),
        an.length ? h('div', { style: 'margin-top:8px' }, h('div', { class: 'small muted' }, 'Últimas notas'), lista(an.slice(0, 3).map((n) => [h('span', { class: 'muted' }, `${fmtFecha(n.fecha)} · `), (n.texto || '').slice(0, 110)]))) : null], { ruta: 'al_informes' }));
    }
    // --- tutorías ---
    if (ve('ac_tutorias') && !familia) {
      const t = tuts.filter((x) => x.alumno_id === id || x.alumno?.id === id).sort((x, y) => y.fecha.localeCompare(x.fecha));
      const prox = t.filter((x) => x.estado === 'pendiente').sort((x, y) => x.fecha.localeCompare(y.fecha))[0];
      cards.push(card('Tutorías', t.length ? [prox ? h('div', {}, 'Próxima: ', h('strong', {}, fmtFecha(prox.fecha)), prox.hora ? ` ${hhmm(prox.hora)}` : '', prox.profesora?.nombre ? ` con ${prox.profesora.nombre}` : '') : h('div', { class: 'muted' }, 'Sin tutoría pendiente.'),
        lista(t.filter((x) => x.estado === 'hecha').slice(0, 3).map((x) => [h('span', { class: 'muted' }, `${fmtFecha(x.fecha)} · `), x.acuerdos || x.motivo || 'Tutoría realizada']))] : vacio('Sin tutorías.'), { ruta: 'ac_tutorias' }));
    }
    // --- biblioteca y mascotas ---
    if (ve('ac_biblioteca') && !familia) {
      const p = prest.filter((x) => x.alumno_id === id).sort((x, y) => String(y.fecha_salida || '').localeCompare(String(x.fecha_salida || '')));
      const fuera = p.filter((x) => !x.fecha_devolucion);
      cards.push(card('Biblioteca y mascotas', p.length ? [fuera.length ? h('div', {}, fuera.map((x) => h('span', { class: 'pill warn', style: 'margin-right:6px' }, `${x.tipo === 'mascota' ? '🐾' : '📖'} ${x.libro || x.tipo}`, x.fecha_salida && diasDesde(x.fecha_salida) > 14 ? ` · ${diasDesde(x.fecha_salida)} días fuera` : ''))) : h('div', { class: 'muted' }, 'Nada pendiente de devolver.'),
        lista(p.filter((x) => x.fecha_devolucion).slice(0, 4).map((x) => [`${x.tipo === 'mascota' ? '🐾' : '📖'} ${x.libro || x.tipo}`, h('span', { class: 'muted' }, ` · devuelto ${fmtFecha(x.fecha_devolucion)}`)]))] : vacio('Sin préstamos de libros ni mascotas.'), { ruta: 'ac_biblioteca', txt: 'Abrir biblioteca →' }));
    }
    // --- documentación ---
    if (ve('al_documentos')) {
      const rec = recs.find((x) => x.alumno_id === id);
      const tiene = (t) => docs.some((d) => d.alumno_id === id && d.tipo === t && d.estado !== 'rechazado') || (t === 'autorizacion_recogida' && !!rec?.doc_autorizacion) || (t === 'dni_responsable' && !!rec?.doc_dni_padres);
      const d2 = familia ? docs.filter((d) => d.visible_familia) : docs;
      cards.push(card('Documentación', [lista(OBLIGATORIOS.map((t) => [tiene(t) ? pill('✓', 'ok') : pill('falta', 'warn'), ' ', NOM_DOC[t]])),
        d2.length ? h('div', { class: 'small muted', style: 'margin-top:6px' }, `${d2.length} documento${d2.length === 1 ? '' : 's'} en el archivo`) : null], { ruta: 'al_documentos' }));
    }
    // --- actividades ---
    if (ve('al_actividades')) {
      const l = ins.filter((x) => x.estado !== 'cancelado').map((x) => ({ x, act: acts.find((y) => y.id === x.actividad_id) })).filter((y) => y.act);
      cards.push(card('Actividades', l.length ? lista(l.map(({ x, act }) => [h('strong', {}, act.nombre), act.fecha ? ` · ${fmtFecha(act.fecha)}` : '', ' · ', x.estado === 'lista_espera' ? pill('lista de espera', 'warn') : pill('apuntado/a', 'ok')])) : vacio('No está apuntado a ninguna actividad.'), { ruta: 'al_actividades' }));
    }
    // --- comunicaciones ---
    if (ve('al_comunicaciones')) {
      const m = pf(msgs);
      cards.push(card('Comunicaciones', m.length ? lista(m.slice(0, 5).map((x) => [h('span', { class: 'muted' }, `${new Date(x.created_at).toLocaleDateString('es-ES')} ${x.sentido === 'a_familia' ? '→' : '←'} `), x.asunto, x.sentido === 'de_familia' && !x.leido_at ? pill('sin leer', 'warn') : ''])) : vacio('Sin comunicaciones.'), { ruta: 'al_comunicaciones' }));
    }
    // --- calendario escolar ---
    const hoy = hoyISO();
    const prox = marcas.filter((x) => x.fecha >= hoy).sort((x, y) => x.fecha.localeCompare(y.fecha)).slice(0, 6);
    cards.push(card('Próximas fechas del calendario', prox.length ? lista(prox.map((x) => [h('strong', {}, fmtFecha(x.fecha)), ` · ${x.tipo}${x.nombre ? ' · ' + x.nombre : ''}`])) : vacio('No hay fechas marcadas por delante.'), ve('ac_calendario') ? { ruta: 'ac_calendario', txt: 'Ver calendario →' } : {}));

    clear(cont, familia ? h('div', { class: 'banner' }, 'Estás viendo solo lo que la familia verá en el portal: notas, tareas, informes publicados y notas marcadas como visibles.') : null, h('div', { class: 'al-grid' }, cards));
  }

  clear(view, cabecera('Ficha del alumno', 'Todo lo de un alumno en una sola pantalla', h('label', { class: 'al-check', title: 'Muestra solo lo que verá la familia en el portal' }, chkFam, ' Ver como la familia')),
    h('div', { class: 'filters' }, b), cont);
  pintar();
}
