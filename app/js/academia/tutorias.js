// Tutorías: cada una cuelga de un alumno y, al marcarla como hecha, deja una anotación en su seguimiento.
import { h, clear, cargando, toast, confirmar, fmtFecha, hoyISO, normalizar } from '../ui.js';
import * as api from './api.js';
import { vistaSolicitudes } from './tutorias_solicitudes.js';
import { campo, txt, area, fecha, sel, drawer, cabecera, tabla, pill, nombreAlumno, hhmm, guardarBoton, buscadorAlumno, refrescar } from './kit.js';

export async function renderTutorias(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const [tutorias, alumnos, profes] = await Promise.all([api.tutorias(), api.alumnos(), api.profesoras()]);
  const verSol = ctx.ve('ac_tutorias'); // solicitudes de familias: solo con acceso a todas las tutorías
  const solicitudes = verSol ? await api.solicitudesTutorias() : [];
  const nuevas = solicitudes.filter((x) => x.estado === 'nueva').length;
  const propio = !ctx.ve('ac_tutorias'); // con «lo suyo» solo ve y crea tutorías a su nombre, con sus alumnos
  const yo = propio ? ctx.miProfesora(profes) : null;
  const editor = ctx.edita('ac_tutorias') && (!propio || !!yo);
  const recargar = () => { api.invalidar(); refrescar(); };
  const f = { q: '', estado: 'pendiente', vista: 'tut' };
  const hoy = hoyISO();
  const cont = h('div');
  function pintar() {
    if (f.vista === 'sol') { vistaSolicitudes(cont, { solicitudes, alumnos, profes, curso, ctx, recargar, editor: ctx.edita('ac_tutorias') }); return; }
    const q = normalizar(f.q);
    const filas = tutorias.filter((t) => (!f.estado || t.estado === f.estado) && (!q || normalizar(`${nombreAlumno(t.alumno)} ${t.motivo || ''}`).includes(q))).sort((a, b) => (f.estado === 'pendiente' ? a.fecha.localeCompare(b.fecha) : b.fecha.localeCompare(a.fecha)));
    clear(cont, tabla([
      { t: 'Fecha', v: (t) => h('span', {}, fmtFecha(t.fecha), t.hora ? ` ${hhmm(t.hora)}` : '', t.estado === 'pendiente' && t.fecha < hoy ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'vencida') : null) },
      { t: 'Alumno', v: (t) => h('strong', {}, nombreAlumno(t.alumno)) }, { t: 'Con', v: (t) => t.profesora?.nombre || '' }, { t: 'Formato', v: (t) => t.formato },
      { t: 'Motivo', v: (t) => t.motivo || '' }, { t: 'Estado', v: (t) => pill(t.estado, t.estado === 'hecha' ? 'ok' : t.estado === 'cancelada' ? 'off' : 'warn') },
    ], filas, { onClick: (t) => abrir(t, { alumnos, profes, curso, ctx, recargar }), vacio: 'No hay tutorías con este filtro.' }));
  }
  const filtros = h('div', { class: 'filters filters-2' }, h('input', { type: 'search', placeholder: 'Buscar alumno o motivo…', oninput: (e) => { f.q = e.target.value; pintar(); } }), sel([['', 'Todas'], ['pendiente', 'Pendientes'], ['hecha', 'Hechas'], ['cancelada', 'Canceladas']], f.estado, { onchange: (e) => { f.estado = e.target.value; pintar(); } }));
  clear(view, cabecera('Tutorías', propio ? 'Tus reuniones con familias' : 'Reuniones con familias, enlazadas al seguimiento de cada alumno', editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrir(null, { alumnos, profes, curso, ctx, recargar }) }, '+ Nueva tutoría') : null),
    propio && !yo ? h('div', { class: 'banner warn' }, 'Tu usuario todavía no está enlazado a una ficha de profesora, así que no se te asigna ninguna tutoría. Pide a un administrador que lo enlace en Usuarios.') : null,
    verSol ? h('div', { class: 'segmented', role: 'tablist' }, [['tut', 'Tutorías'], ['sol', nuevas ? `Solicitudes (${nuevas})` : 'Solicitudes']].map(([k, l]) => h('button', { class: 'seg-btn', role: 'tab', type: 'button', 'aria-selected': String(f.vista === k), onclick: (e) => { f.vista = k; e.target.parentNode.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-selected', String(b === e.target))); filtros.hidden = k === 'sol'; pintar(); } }, l))) : null,
    filtros, cont);
  pintar();
}

function abrir(t, { alumnos, profes, curso, ctx, recargar }) {
  const d = drawer({ titulo: t ? `Tutoría · ${nombreAlumno(t.alumno)}` : 'Nueva tutoría', ancho: 580 });
  const propio = !ctx.ve('ac_tutorias'); const yo = propio ? ctx.miProfesora(profes) : null; // con «lo suyo» la tutoría se guarda a su nombre
  const F = { al: buscadorAlumno(alumnos, { valorId: t?.alumno?.id }), fecha: fecha(t?.fecha || hoyISO()), hora: h('input', { type: 'time', value: hhmm(t?.hora) }),
    prof: propio ? sel(yo ? [[yo.id, yo.nombre]] : [], yo?.id, { disabled: true, title: 'Con tu rol las tutorías se guardan a tu nombre' })
      : sel(profes.filter((p) => p.activa || p.id === t?.profesora?.id).map((p) => [p.id, p.nombre]), t?.profesora?.id, { vacio: '—' }), formato: sel([['presencial', 'Presencial'], ['telefono', 'Teléfono'], ['online', 'Online']], t?.formato || 'presencial'),
    estado: sel([['pendiente', 'Pendiente'], ['hecha', 'Hecha'], ['cancelada', 'Cancelada']], t?.estado || 'pendiente'), motivo: area(t?.motivo), acuerdos: area(t?.acuerdos), prox: fecha(t?.proxima_fecha) };
  d.cuerpo.append(h('div', { class: 'form-section' }, campo('Alumno', F.al, { full: true, req: true }), campo('Fecha', F.fecha), campo('Hora', F.hora), campo('Profesora', F.prof), campo('Formato', F.formato), campo('Estado', F.estado), campo('Próximo seguimiento', F.prox),
    campo('Motivo', F.motivo, { full: true }), campo('Acuerdos / resultado', F.acuerdos, { full: true })),
    h('div', { class: 'small muted' }, 'Al marcarla como «hecha» se guarda una anotación de tipo tutoría en el seguimiento del alumno.'));
  const guardar = guardarBoton('Guardar', async () => {
    const a = t?.alumno ? alumnos.find((x) => x.id === t.alumno.id) : F.al.getAlumno();
    const elegido = F.al.getAlumno() || a;
    if (!elegido) { toast('Elige un alumno de la lista.', 'error'); return; }
    const fila = { alumno_id: elegido.id, curso_id: curso.id, fecha: F.fecha.value || hoyISO(), hora: F.hora.value || null, profesora_id: F.prof.value || null, formato: F.formato.value, estado: F.estado.value, motivo: F.motivo.value.trim() || null, acuerdos: F.acuerdos.value.trim() || null, proxima_fecha: F.prox.value || null };
    try {
      const tut = t ? await api.upd('ac_tutorias', t.id, fila) : await api.ins('ac_tutorias', fila);
      if (fila.estado === 'hecha') {
        const texto = [fila.motivo && `Motivo: ${fila.motivo}`, fila.acuerdos && `Acuerdos: ${fila.acuerdos}`].filter(Boolean).join('\n') || 'Tutoría realizada.';
        const previas = (await api.anotaciones(elegido.id)).filter((n) => n.tutoria_id === tut.id);
        if (previas.length) await api.upd('ac_anotaciones', previas[0].id, { texto, fecha: fila.fecha, profesora_id: fila.profesora_id });
        else await api.ins('ac_anotaciones', { alumno_id: elegido.id, tipo: 'tutoría', texto, fecha: fila.fecha, profesora_id: fila.profesora_id, tutoria_id: tut.id });
      }
      toast('Tutoría guardada'); d.cerrar(); recargar();
    } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
  });
  guardar.disabled = !ctx.edita('ac_tutorias') || (propio && !yo);
  const borrar = t && ctx.esAdmin() ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Borrar tutoría', texto: nombreAlumno(t.alumno), ok: 'Borrar', peligro: true })) { try { await api.del('ac_tutorias', t.id); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } } }, 'Borrar') : h('span');
  d.pie.append(borrar, guardar);
}
