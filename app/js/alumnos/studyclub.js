// ALUMNOS · Study Club: sesiones de repaso de lunes a jueves (20:10-20:40, 6 plazas) con su temario, su profesora y los alumnos apuntados.
// El formulario público (StudyClub en GitHub Pages) reserva por funciones del servidor (studyclub_semana / studyclub_reservar), que controlan las plazas.
// Las sesiones futuras las crea el servidor solas (días y hora de Ajustes); aquí se les pone temario y profesora (por defecto la de Ajustes).
// Calendarios: vista semanal por profesora, botón «Añadir a Google Calendar» / .ics por sesión y calendario suscribible por profesora (Edge Function studyclub-ics).
import { h, clear, cargando, toast, confirmar } from '../ui.js';
import { leerV, guardarV } from '../vista.js';
import { SUPABASE_URL } from '../config.js';
import * as api from './api.js';
import { campo, sel, txt, area, fecha, numero, drawer, cabecera, tabla, guardarBoton, buscadorAlumno, nombreAlumno, refrescar, pill, avatarDe, DIAS } from '../academia/kit.js';

const ESTADOS = [['abierta', 'Abierta'], ['cerrada', 'Cerrada (no se puede reservar)'], ['cancelada', 'Cancelada']];
const ASISTENCIA = [['', '—'], ['asistio', 'Asistió'], ['falta', 'No vino']];
const LUGAR = 'My English House';
const hhmm = (t) => (t || '').slice(0, 5);
const hoyISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const aFecha = (s) => new Date(`${s}T00:00:00Z`);
const sumar = (s, n) => { const d = aFecha(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lunesDe = (s) => { const d = aFecha(s); const w = (d.getUTCDay() + 6) % 7; return sumar(s, -w); };
const larga = (s) => { const d = aFecha(s); return `${DIAS[((d.getUTCDay() + 6) % 7) + 1]} ${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })}`; };
const corta = (s) => aFecha(s).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const ymdhm = (f, hr) => f.replace(/-/g, '') + 'T' + hhmm(hr).replace(':', '') + '00';
const titulo = (s) => s.titulo || 'Temario por definir';

// ---------- calendario: enlaces y archivo .ics ----------
export function enlaceGoogle(s) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: 'Study Club' + (s.titulo ? ': ' + s.titulo : ''), dates: `${ymdhm(s.fecha, s.hora_inicio)}/${ymdhm(s.fecha, s.hora_fin)}`, ctz: 'Europe/Madrid',
    details: 'Sesión de Study Club.' + (s.titulo ? '\nTemario: ' + s.titulo : ''), location: LUGAR });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
function descargarIcs(s) {
  const e = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const ahora = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//My English House//Study Club//ES', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${s.id}@studyclub.myenglishhouse`, `DTSTAMP:${ahora}`,
    `DTSTART;TZID=Europe/Madrid:${ymdhm(s.fecha, s.hora_inicio)}`, `DTEND;TZID=Europe/Madrid:${ymdhm(s.fecha, s.hora_fin)}`, 'SUMMARY:' + e('Study Club' + (s.titulo ? ': ' + s.titulo : '')), 'LOCATION:' + e(LUGAR), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' })), download: 'study-club.ics' });
  document.body.append(a); a.click(); a.remove();
}
const urlFeed = (token) => `${SUPABASE_URL}/functions/v1/studyclub-ics?t=${token}`;
const urlSuscribirGoogle = (token) => 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(urlFeed(token).replace(/^https:/, 'webcal:'));

export async function renderStudyClub(view, ctx) {
  clear(view, cargando());
  const editor = ctx.edita('al_studyclub');
  const cfg0 = await api.scConfig();
  // el servidor crea las sesiones de las próximas semanas (idempotente); solo lo pide quien puede editar
  if (editor && cfg0) { try { await api.scGenerar(hoyISO(), sumar(hoyISO(), cfg0.semanas_adelante * 7)); } catch { /* sin permiso o sin conexión: se muestran las existentes */ } }
  const [cfg, sesiones, reservas, profes, alumnos, tokens] = await Promise.all([api.scConfig(), api.scSesiones(), api.scReservas(), api.profesoras(), api.alumnos(), api.scTokens().catch(() => [])]);
  const yo = ctx.miProfesora(profes);
  const pPor = new Map(profes.map((p) => [p.id, p]));
  const aPor = new Map(alumnos.map((a) => [a.id, a]));
  const activas = (sid) => reservas.filter((r) => r.sesion_id === sid && r.estado === 'apuntado');
  const mia = (s) => !!yo && s.profesora_id === yo.id;
  let vista = leerV('sc.vista', yo && !editor ? 'calendario' : 'sesiones'); if (!['sesiones', 'calendario', 'ajustes'].includes(vista)) vista = 'sesiones';
  let semana = lunesDe(hoyISO());
  let verPasadas = false; let soloMias = !!yo && !editor;
  const cont = h('div');

  // ---------- 1) lista de sesiones ----------
  function pintarLista() {
    const hoy = hoyISO();
    const lista = sesiones.filter((s) => (verPasadas ? s.fecha < hoy : s.fecha >= hoy) && (!soloMias || mia(s)));
    const fil = h('div', { class: 'filters' },
      h('label', { class: 'al-check' }, h('input', { type: 'checkbox', checked: verPasadas, onchange: (e) => { verPasadas = e.target.checked; pintar(); } }), ' Ver sesiones pasadas'),
      yo ? h('label', { class: 'al-check' }, h('input', { type: 'checkbox', checked: soloMias, onchange: (e) => { soloMias = e.target.checked; pintar(); } }), ' Solo las mías') : null);
    clear(cont, fil, tabla([
      { t: 'Fecha', s: (s) => s.fecha, v: (s) => h('strong', {}, larga(s.fecha)) },
      { t: 'Hora', v: (s) => `${hhmm(s.hora_inicio)} - ${hhmm(s.hora_fin)}`, sin: true },
      { t: 'Temario', s: (s) => s.titulo || '', v: (s) => (s.titulo ? s.titulo : h('span', { class: 'muted' }, 'por definir')) },
      { t: 'Profesora', s: (s) => pPor.get(s.profesora_id)?.nombre || '', v: (s) => avatarDe(pPor.get(s.profesora_id)?.nombre, pPor.get(s.profesora_id)?.siglas) },
      { t: 'Apuntados', num: true, s: (s) => activas(s.id).length, v: (s) => { const n = activas(s.id).length; return h('span', {}, `${n} / ${s.plazas}`, n >= s.plazas ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'completa') : null); } },
      { t: 'Estado', s: (s) => s.estado, v: (s) => (s.estado === 'abierta' ? pill('abierta', 'ok') : s.estado === 'cerrada' ? pill('cerrada', 'warn') : pill('cancelada', 'off')) },
    ], lista, { onClick: (s) => abrir(s), vacio: verPasadas ? 'No hay sesiones pasadas.' : 'No hay sesiones próximas. Se crean solas según los días de «Ajustes».' }));
  }

  // ---------- 2) calendario semanal por profesora ----------
  function pintarCalendario() {
    const dias = (cfg?.dias || [1, 2, 3, 4]).slice().sort();
    const fechas = dias.map((d) => sumar(semana, d - 1));
    const delaSemana = sesiones.filter((s) => s.fecha >= semana && s.fecha <= sumar(semana, 6));
    const filas = [...profes.filter((p) => p.activa && (!soloMias || p.id === yo?.id)), ...(delaSemana.some((s) => !s.profesora_id) && !soloMias ? [{ id: null, nombre: 'Sin profesora', siglas: null }] : [])];
    const nav = h('div', { class: 'al-barra' },
      h('button', { class: 'btn small', type: 'button', onclick: () => { semana = sumar(semana, -7); pintar(); } }, '‹ Anterior'),
      h('strong', {}, `Semana del ${corta(semana)} al ${corta(sumar(semana, 6))}`),
      h('button', { class: 'btn small', type: 'button', onclick: () => { semana = sumar(semana, 7); pintar(); } }, 'Siguiente ›'),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => { semana = lunesDe(hoyISO()); pintar(); } }, 'Hoy'),
      yo ? h('label', { class: 'al-check' }, h('input', { type: 'checkbox', checked: soloMias, onchange: (e) => { soloMias = e.target.checked; pintar(); } }), ' Solo mi calendario') : null);
    const celda = (p, f) => {
      const l = delaSemana.filter((s) => s.fecha === f && (s.profesora_id || null) === p.id);
      return h('td', { style: 'vertical-align:top;min-width:150px' }, l.map((s) => h('button', { type: 'button', class: 'btn small ghost', style: `display:block;width:100%;text-align:left;margin-bottom:4px;${s.estado !== 'abierta' ? 'opacity:.55;' : ''}`, onclick: () => abrir(s) },
        h('div', {}, h('strong', {}, hhmm(s.hora_inicio)), ' ', titulo(s)), h('div', { class: 'small muted' }, `${activas(s.id).length}/${s.plazas} apuntados${s.estado !== 'abierta' ? ' · ' + s.estado : ''}`))));
    };
    clear(cont, nav, filas.length
      ? h('div', { class: 'card' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Profesora'), fechas.map((f) => h('th', {}, larga(f))))),
        h('tbody', {}, filas.map((p) => h('tr', {}, h('td', {}, avatarDe(p.nombre, p.siglas), ' ', p.nombre), fechas.map((f) => celda(p, f)))))))
      : h('div', { class: 'card empty' }, 'No hay profesoras activas.'));
  }

  // ---------- 3) ajustes + calendarios suscribibles ----------
  function pintarAjustes() {
    const F = { dias: DIAS.slice(1, 6).map((n, i) => [i + 1, n]), hi: h('input', { type: 'time', value: hhmm(cfg.hora_inicio) }), hf: h('input', { type: 'time', value: hhmm(cfg.hora_fin) }),
      plazas: h('input', { type: 'number', min: '1', step: '1', value: cfg.plazas }), prof: sel(profes.filter((p) => p.activa).map((p) => [p.id, p.nombre]), cfg.profesora_id, { vacio: '— sin profesora —' }),
      sem: h('input', { type: 'number', min: '1', max: '26', step: '1', value: cfg.semanas_adelante }) };
    const checks = F.dias.map(([d, n]) => h('label', { class: 'al-check', style: 'margin-right:10px' }, h('input', { type: 'checkbox', checked: (cfg.dias || []).includes(d), 'data-d': d, disabled: !editor }), ' ' + n));
    [F.hi, F.hf, F.plazas, F.prof, F.sem].forEach((i) => { i.disabled = !editor; });
    const filasTok = profes.filter((p) => p.activa).map((p) => ({ p, t: tokens.find((x) => x.profesora_id === p.id) })).filter((x) => editor || x.p.id === yo?.id);
    clear(cont,
      h('div', { class: 'card' }, h('h3', { class: 'sub-titulo' }, 'Sesiones automáticas'),
        h('p', { class: 'muted small' }, 'El servidor crea las sesiones de las próximas semanas con estos datos (salta los festivos del calendario). Las que ya existen no se tocan al cambiar los ajustes.'),
        h('div', { class: 'form-section' }, campo('Días', h('div', {}, checks), { full: true }), campo('Hora de inicio', F.hi), campo('Hora de fin', F.hf), campo('Plazas por sesión', F.plazas), campo('Profesora por defecto', F.prof), campo('Semanas por adelantado', F.sem)),
        editor ? h('div', { class: 'al-barra' }, guardarBoton('Guardar ajustes', async () => {
          const dias = checks.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => Number(i.dataset.d));
          if (!dias.length) { toast('Elige al menos un día.', 'error'); return; }
          try {
            await api.upd('al_studyclub_config', 1, { dias, hora_inicio: F.hi.value, hora_fin: F.hf.value, plazas: Number(F.plazas.value) || 6, profesora_id: F.prof.value || null, semanas_adelante: Number(F.sem.value) || 8 });
            toast('Ajustes guardados'); refrescar();
          } catch (ex) { toast(ex.message, 'error'); }
        })) : null),
      h('div', { class: 'card', style: 'margin-top:12px' }, h('h3', { class: 'sub-titulo' }, 'Calendario suscribible de cada profesora'),
        h('p', { class: 'muted small' }, 'Se suscribe una sola vez (Google Calendar, Apple o Outlook) y las sesiones nuevas aparecen solas. Es un enlace privado: quien lo tenga ve las sesiones de esa profesora (sin nombres de alumnos).'),
        filasTok.length ? h('table', { class: 'tbl' }, h('tbody', {}, filasTok.map(({ p, t }) => h('tr', {}, h('td', {}, avatarDe(p.nombre, p.siglas), ' ', p.nombre),
          h('td', {}, t ? h('span', { class: 'al-barra' },
            h('a', { class: 'btn small', href: urlSuscribirGoogle(t.token), target: '_blank', rel: 'noopener' }, 'Añadir a Google Calendar'),
            h('button', { class: 'btn small ghost', type: 'button', onclick: () => { navigator.clipboard?.writeText(urlFeed(t.token)); toast('Enlace copiado'); } }, 'Copiar enlace .ics'),
            editor || p.id === yo?.id ? h('button', { class: 'btn small ghost', type: 'button', onclick: async () => {
              if (!await confirmar({ titulo: 'Renovar enlace', texto: 'El enlace anterior dejará de funcionar y habrá que volver a suscribirse.', ok: 'Renovar' })) return;
              try { await api.scNuevoToken(p.id); toast('Enlace renovado'); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
            } }, 'Renovar') : null)
            : (editor || p.id === yo?.id ? h('button', { class: 'btn small', type: 'button', onclick: async () => { try { await api.scNuevoToken(p.id); refrescar(); } catch (ex) { toast(ex.message, 'error'); } } }, 'Crear enlace') : h('span', { class: 'muted' }, '—')))))))
          : h('div', { class: 'muted' }, 'No hay calendario para ti: tu usuario no está enlazado a una ficha de profesora.')));
  }

  // ---------- ficha de una sesión ----------
  async function abrir(s) {
    const puedeSesion = editor || mia(s);          // temario, notas y asistencia
    const d = drawer({ titulo: `Study Club · ${larga(s.fecha)}`, ancho: 760 });
    const F = { fecha: fecha(s.fecha, { disabled: !editor }), hi: h('input', { type: 'time', value: hhmm(s.hora_inicio), disabled: !editor }), hf: h('input', { type: 'time', value: hhmm(s.hora_fin), disabled: !editor }),
      titulo: txt(s.titulo, { placeholder: 'Past Simple', disabled: !puedeSesion }), prof: sel(profes.filter((p) => p.activa || p.id === s.profesora_id).map((p) => [p.id, p.nombre]), s.profesora_id, { vacio: '— sin profesora —', disabled: !editor }),
      plazas: h('input', { type: 'number', min: '1', step: '1', value: s.plazas, disabled: !editor }), estado: sel(ESTADOS, s.estado, { disabled: !editor }), notas: area(s.notas, { disabled: !puedeSesion }) };
    d.cuerpo.append(
      h('div', { class: 'form-section' }, campo('Temario que se repasa', F.titulo, { full: true }), campo('Profesora', F.prof), campo('Estado', F.estado), campo('Fecha', F.fecha), campo('Plazas', F.plazas), campo('Inicio', F.hi), campo('Fin', F.hf), campo('Notas internas', F.notas, { full: true })),
      h('div', { class: 'al-barra' }, h('a', { class: 'btn small', href: enlaceGoogle(s), target: '_blank', rel: 'noopener' }, 'Añadir a Google Calendar'), h('button', { class: 'btn small ghost', type: 'button', onclick: () => descargarIcs(s) }, 'Descargar .ics')));
    const bloque = h('div', { class: 'card', style: 'margin-top:12px' });
    d.cuerpo.append(bloque);

    function pintarApuntados() {
      const lista = reservas.filter((r) => r.sesion_id === s.id).sort((a, b) => (a.estado === b.estado ? a.created_at.localeCompare(b.created_at) : a.estado === 'apuntado' ? -1 : 1));
      const n = lista.filter((r) => r.estado === 'apuntado').length;
      const nom = h('input', { type: 'text', placeholder: 'Nombre del alumno', maxlength: '120' });
      const al = buscadorAlumno(alumnos, { soloActivos: true, placeholder: 'o elige un alumno de la academia…' });
      const enlazar = (r) => { const b = buscadorAlumno(alumnos, { valorId: r.alumno_id, placeholder: 'Enlazar a su ficha…' }); b.input.addEventListener('change', async () => {
        const a = b.getAlumno(); if (!a && b.input.value.trim()) return;
        try { await api.upd('al_studyclub_reservas', r.id, { alumno_id: a ? a.id : null }); r.alumno_id = a ? a.id : null; toast(a ? 'Enlazado con su ficha' : 'Desenlazado'); } catch (ex) { toast(ex.message, 'error'); } }); return b; };
      clear(bloque, h('h3', { class: 'sub-titulo' }, `Apuntados (${n} de ${s.plazas})`),
        editor ? h('div', { class: 'al-barra' }, nom, al, h('button', { class: 'btn small', type: 'button', onclick: async () => {
          const a = al.getAlumno(); const nombre = (a ? nombreAlumno(a) : nom.value).trim();
          if (!nombre) { toast('Escribe un nombre o elige un alumno.', 'error'); return; }
          if (n >= s.plazas && !await confirmar({ titulo: 'Sesión completa', texto: 'Ya están todas las plazas ocupadas. ¿Apuntarlo igualmente?', ok: 'Apuntar' })) return;
          try { const r = await api.ins('al_studyclub_reservas', { sesion_id: s.id, nombre, alumno_id: a?.id || null, origen: 'manual' }); reservas.push(r); toast('Apuntado'); pintarApuntados(); } catch (ex) { toast(ex.message, 'error'); }
        } }, 'Apuntar')) : null,
        lista.length ? h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Alumno', 'Contacto', 'Ficha', 'Asistencia', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, lista.map((r) => h('tr', { style: r.estado === 'cancelado' ? 'opacity:.5' : '' },
            h('td', {}, h('strong', {}, r.nombre), r.tema ? h('div', { class: 'small muted' }, 'Quiere repasar: ' + r.tema) : null, r.estado === 'cancelado' ? pill('cancelado', 'off') : null),
            h('td', { class: 'small' }, r.email || '', r.telefono ? h('div', {}, r.telefono) : null),
            h('td', {}, editor ? enlazar(r) : (r.alumno_id ? nombreAlumno(aPor.get(r.alumno_id)) : h('span', { class: 'muted' }, '—'))),
            h('td', {}, sel(ASISTENCIA, r.asistencia || '', { disabled: !puedeSesion, onchange: async (e) => { try { await api.upd('al_studyclub_reservas', r.id, { asistencia: e.target.value || null }); r.asistencia = e.target.value || null; } catch (ex) { e.target.value = r.asistencia || ''; toast(ex.message, 'error'); } } })),
            h('td', {}, editor ? h('button', { class: 'btn small ghost', type: 'button', onclick: async () => {
              try { const nuevo = r.estado === 'apuntado' ? 'cancelado' : 'apuntado'; await api.upd('al_studyclub_reservas', r.id, { estado: nuevo }); r.estado = nuevo; pintarApuntados(); } catch (ex) { toast(ex.message, 'error'); }
            } }, r.estado === 'apuntado' ? 'Cancelar plaza' : 'Reactivar') : null)))))
          : h('div', { class: 'muted' }, 'Nadie apuntado todavía.'));
    }
    pintarApuntados();

    if (puedeSesion) d.pie.append(guardarBoton('Guardar', async () => {
      const parche = { titulo: F.titulo.value.trim() || null, notas: F.notas.value.trim() || null };
      if (editor) Object.assign(parche, { fecha: F.fecha.value, hora_inicio: F.hi.value, hora_fin: F.hf.value, profesora_id: F.prof.value || null, plazas: Number(F.plazas.value) || s.plazas, estado: F.estado.value });
      try { await api.upd('al_studyclub_sesiones', s.id, parche); toast('Sesión guardada'); d.cerrar(); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
    }));
  }

  // ---------- cabecera y pestañas internas ----------
  const seg = h('div', { class: 'segmented', role: 'tablist' }, [['sesiones', 'Sesiones'], ['calendario', 'Calendario por profesora'], ['ajustes', 'Ajustes y calendarios']].map(([k, l]) =>
    h('button', { class: 'seg-btn', role: 'tab', type: 'button', 'aria-selected': String(vista === k), onclick: () => { vista = k; guardarV('sc.vista', k); seg.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-selected', String(b.textContent === l))); pintar(); } }, l)));
  function pintar() { if (!cfg) { clear(cont, h('div', { class: 'card empty' }, 'Study Club no está configurado todavía.')); return; } (vista === 'calendario' ? pintarCalendario : vista === 'ajustes' ? pintarAjustes : pintarLista)(); }
  const proximas = sesiones.filter((s) => s.fecha >= hoyISO() && s.estado === 'abierta');
  clear(view, cabecera('Study Club', `${proximas.length} sesiones próximas · ${reservas.filter((r) => r.estado === 'apuntado').length} reservas en total`, seg), cont);
  pintar();
}
