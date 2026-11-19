// Solicitudes de tutoría de las familias (formulario público de la web o importadas del formulario de Google).
// El personal las revisa, enlaza el alumno y las convierte en una tutoría pendiente.
import { h, clear, toast, confirmar, fmtFecha, hoyISO, normalizar } from '../ui.js';
import * as api from './api.js';
import { campo, area, fecha, sel, drawer, tabla, pill, nombreAlumno, guardarBoton, buscadorAlumno } from './kit.js';

export const DIAS_SOL = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const ABREV = { Lunes: 'Lun', Martes: 'Mar', 'Miércoles': 'Mié', Jueves: 'Jue', Viernes: 'Vie', Sábado: 'Sáb', Domingo: 'Dom' };
const IDX = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

export const resumenDisponibilidad = (disp) => {
  const por = new Map();
  for (const d of disp || []) (por.get(d.dia) || por.set(d.dia, []).get(d.dia)).push(d.hora);
  return [...por].map(([dia, hs]) => `${ABREV[dia] || dia} ${hs.sort().join(', ')}`).join(' · ');
};
// próxima fecha (a partir de hoy) que cae en ese día de la semana
function proximaFecha(dia) {
  const n = IDX[normalizar(dia)]; if (n === undefined) return hoyISO();
  const d = new Date(); d.setHours(12, 0, 0, 0);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() !== n);
  return d.toISOString().slice(0, 10);
}
// alumno que mejor encaja con el nombre escrito por la familia (en cualquier orden); null si no hay coincidencia clara
export function mejorAlumno(texto, alumnos) {
  const q = new Set(normalizar(texto).split(/[\s,]+/).filter((w) => w.length > 1 && w !== 'y' && w !== 'de'));
  if (!q.size) return null;
  let mejor = null; let top = 0; let empate = false;
  for (const a of alumnos) {
    const toks = normalizar(`${a.nombre} ${a.apellidos}`).split(/\s+/).filter((w) => w.length > 1);
    if (!toks.length) continue;
    const comunes = toks.filter((w) => q.has(w)).length;
    const score = comunes / toks.length;
    if (comunes >= 2 && score > top + 1e-9) { top = score; mejor = a; empate = false; } else if (comunes >= 2 && Math.abs(score - top) < 1e-9) empate = true;
  }
  return top >= 0.6 && !empate ? mejor : null;
}

export function vistaSolicitudes(cont, { solicitudes, alumnos, profes, curso, ctx, recargar, editor }) {
  const f = { estado: 'nueva' };
  const filtro = sel([['', 'Todas'], ['nueva', 'Nuevas'], ['procesada', 'Procesadas'], ['descartada', 'Descartadas']], f.estado, { onchange: (e) => { f.estado = e.target.value; pintar(); } });
  const lista = h('div');
  const barra = h('div', { class: 'filters filters-2' }, filtro,
    h('button', { class: 'btn small', type: 'button', onclick: async () => { const url = `${location.origin}/solicitar-tutoria.html`; try { await navigator.clipboard.writeText(url); toast('Enlace copiado: ' + url); } catch { window.prompt('Copia este enlace:', url); } } }, 'Copiar enlace para familias'),
    editor ? h('button', { class: 'btn small', type: 'button', onclick: () => importar({ solicitudes, recargar }) }, 'Importar del formulario de Google') : null);
  function pintar() {
    const filas = solicitudes.filter((s) => !f.estado || s.estado === f.estado).sort((a, b) => b.created_at.localeCompare(a.created_at));
    clear(lista, tabla([
      { t: 'Recibida', v: (s) => fmtFecha(s.created_at.slice(0, 10)) },
      { t: 'Alumno', v: (s) => h('strong', {}, s.alumno ? nombreAlumno(s.alumno) : s.alumno_texto) },
      { t: 'Adulto', v: (s) => s.adulto_texto || '' },
      { t: 'Tema', v: (s) => s.tema || '' },
      { t: 'Profesora', v: (s) => (s.asiste_profesora === null ? '' : s.asiste_profesora ? 'Sí' : 'No') },
      { t: 'Disponibilidad', v: (s) => resumenDisponibilidad(s.disponibilidad) },
      { t: 'Estado', v: (s) => pill(s.estado, s.estado === 'procesada' ? 'ok' : s.estado === 'descartada' ? 'off' : 'warn') },
    ], filas, { onClick: (s) => abrir(s, { alumnos, profes, curso, ctx, recargar, editor }), vacio: 'No hay solicitudes con este filtro.' }));
  }
  clear(cont, barra, lista);
  pintar();
}

function abrir(s, { alumnos, profes, curso, ctx, recargar, editor }) {
  const d = drawer({ titulo: `Solicitud · ${s.alumno_texto}`, ancho: 600 });
  const sugerido = s.alumno || mejorAlumno(s.alumno_texto, alumnos);
  const primera = (s.disponibilidad || [])[0];
  const F = { al: buscadorAlumno(alumnos, { valorId: sugerido?.id }), fecha: fecha(primera ? proximaFecha(primera.dia) : hoyISO()), hora: h('input', { type: 'time', value: primera?.hora || '' }),
    prof: sel(profes.filter((p) => p.activa).map((p) => [p.id, p.nombre]), '', { vacio: '—' }), formato: sel([['presencial', 'Presencial'], ['telefono', 'Teléfono'], ['online', 'Online']], 'presencial'),
    motivo: area([s.tema, s.asiste_profesora ? 'Quieren que asista la profesora.' : ''].filter(Boolean).join('\n')) };
  d.cuerpo.append(
    h('div', { class: 'form-section' },
      campo('Alumno (según la familia)', h('div', {}, s.alumno_texto), { full: true }), campo('Adulto', h('div', {}, s.adulto_texto || '—')), campo('Correo', h('div', {}, s.email || '—')),
      campo('¿Asiste la profesora?', h('div', {}, s.asiste_profesora === null ? '—' : s.asiste_profesora ? 'Sí' : 'No')), campo('Recibida', h('div', {}, fmtFecha(s.created_at.slice(0, 10)))),
      campo('Tema', h('div', { style: 'white-space:pre-wrap' }, s.tema || '—'), { full: true }), campo('Disponibilidad', h('div', {}, resumenDisponibilidad(s.disponibilidad) || '—'), { full: true })));
  if (s.estado === 'nueva' && editor) {
    d.cuerpo.append(h('h3', { style: 'font-size:15px;margin:16px 0 6px' }, 'Crear la tutoría'),
      h('div', { class: 'form-section' }, campo('Alumno', F.al, { full: true, req: true }), campo('Fecha', F.fecha), campo('Hora', F.hora), campo('Profesora', F.prof), campo('Formato', F.formato), campo('Motivo', F.motivo, { full: true })),
      h('div', { class: 'small muted' }, sugerido ? 'Alumno propuesto por coincidencia de nombre: compruébalo.' : 'No se ha encontrado el alumno con claridad: elígelo de la lista.'));
    const crear = guardarBoton('Crear tutoría', async () => {
      const al = F.al.getAlumno();
      if (!al) { toast('Elige un alumno de la lista.', 'error'); return; }
      try {
        const tut = await api.ins('ac_tutorias', { alumno_id: al.id, curso_id: curso.id, fecha: F.fecha.value || hoyISO(), hora: F.hora.value || null, profesora_id: F.prof.value || null, formato: F.formato.value, estado: 'pendiente', motivo: F.motivo.value.trim() || null });
        await api.upd('ac_tutorias_solicitudes', s.id, { estado: 'procesada', alumno_id: al.id, tutoria_id: tut.id });
        toast('Tutoría creada'); d.cerrar(); recargar();
      } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
    });
    const descartar = h('button', { class: 'btn', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Descartar solicitud', texto: s.alumno_texto, ok: 'Descartar' })) { try { await api.upd('ac_tutorias_solicitudes', s.id, { estado: 'descartada' }); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } } }, 'Descartar');
    d.pie.append(descartar, crear);
  } else if (editor && s.estado === 'descartada') {
    d.pie.append(h('span'), h('button', { class: 'btn', type: 'button', onclick: async () => { try { await api.upd('ac_tutorias_solicitudes', s.id, { estado: 'nueva' }); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } }, 'Volver a nuevas'));
  } else d.pie.append(h('span', { class: 'small muted' }, s.estado === 'procesada' ? 'Ya convertida en tutoría.' : ''));
}

// Importar el Excel de respuestas del formulario de Google (sin duplicar: la clave es fecha+correo).
async function importar({ solicitudes, recargar }) {
  const inp = h('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
  inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return;
    try {
      const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
      const cab = (filas[0] || []).map((x) => normalizar(String(x ?? '')));
      const col = (re) => cab.findIndex((c) => re.test(c));
      const iF = col(/marca temporal/), iE = col(/correo/), iA = col(/nombre alumno/), iD = col(/nombre adulto/), iT = col(/tema a tratar/), iP = col(/asista la profesora/);
      const franjas = cab.map((c, i) => [i, c.match(/\[(\d{1,2}:\d{2})\s*h\]/)?.[1]]).filter(([, hh]) => hh);
      if (iF < 0 || iA < 0 || !franjas.length) { toast('No parece el Excel de respuestas del formulario de tutorías.', 'error'); return; }
      const existentes = new Set(solicitudes.map((s) => s.origen_ref).filter(Boolean));
      const corte = '2026-09-01';
      const nuevas = [];
      for (const r of filas.slice(1)) {
        const fh = r[iF] instanceof Date ? r[iF] : null; if (!fh || !r[iA]) continue;
        const iso = fh.toISOString();
        const ref = `google:${iso}|${String(r[iE] || '').toLowerCase()}`;
        if (existentes.has(ref)) continue;
        const disp = [];
        for (const [i, hh] of franjas) for (const dia of String(r[i] ?? '').split(/[,;]/).map((x) => normalizar(x.trim())).filter(Boolean)) {
          const nombre = DIAS_SOL.find((n) => normalizar(n) === dia); if (nombre) disp.push({ dia: nombre, hora: hh.padStart(5, '0') });
        }
        nuevas.push({ created_at: iso, email: r[iE] ? String(r[iE]).trim() : null, alumno_texto: String(r[iA]).trim(), adulto_texto: r[iD] ? String(r[iD]).trim() : null, tema: r[iT] ? String(r[iT]).trim() : null,
          asiste_profesora: r[iP] == null ? null : /^s/i.test(String(r[iP]).trim()), disponibilidad: disp, origen: 'google', origen_ref: ref, estado: iso.slice(0, 10) < corte ? 'procesada' : 'nueva' });
      }
      if (!nuevas.length) { toast('No hay solicitudes nuevas que importar.'); return; }
      if (!(await confirmar({ titulo: 'Importar solicitudes', texto: `${nuevas.length} solicitudes nuevas. Las anteriores a septiembre de 2026 se marcan como procesadas.`, ok: 'Importar' }))) return;
      await api.insMany('ac_tutorias_solicitudes', nuevas);
      toast(`${nuevas.length} solicitudes importadas`); recargar();
    } catch (ex) { toast('No se ha importado: ' + ex.message, 'error'); }
  };
  inp.click();
}
