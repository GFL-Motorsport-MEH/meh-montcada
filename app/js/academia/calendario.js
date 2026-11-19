// Calendario del curso (como el PDF «Calendario MEH Montcada»): los días de septiembre a agosto con festivos, comienzo de clases, fun days,
// storytimes, fechas temáticas, camps, vacaciones, días sin clase y eventos. Un día puede tener varias marcas (p. ej. festivo dentro de un camp).
// Clic en un día = editarlo; Mayús + clic en otro día = marcar todo el rango. El horario semanal está en «Horarios».
// Segunda pestaña: el calendario de Google de la academia (se incrusta; hay que haber iniciado sesión en Google o tenerlo compartido).
import { leerV, guardarV } from '../vista.js';
import { h, clear, cargando, toast, confirmar } from '../ui.js';
import * as api from './api.js';
import { campo, sel, txt, fecha, drawer, guardarBoton } from './kit.js';

// orden = prioridad de color cuando un día tiene varias marcas
export const TIPOS = [
  ['festivo', 'Festivo', '#d64545'],
  ['inicio_clases', 'Comienzo de clases', '#2e9d5b'],
  ['fun_day', 'Fun Day', '#e0a21b'],
  ['storytime', 'Storytime', '#b05fc2'],
  ['camp', 'Camp', '#1f9bb0'],
  ['tematica', 'Fecha temática', '#e0709a'],
  ['vacaciones', 'Vacaciones', '#3f7ad9'],
  ['sin_clase', 'Sin clase (puente, jornada…)', '#e08a3c'],
  ['evento', 'Evento / reunión', '#8c6bc8'],
];
const SIN_CLASE = ['festivo', 'vacaciones', 'sin_clase']; // los días con estas marcas no hay clase
export const GOOGLE_CALENDAR = 'meh.montcada@gmail.com';
let vistaCal = 'curso';
const COLOR = Object.fromEntries(TIPOS.map(([k, , c]) => [k, c]));
const NOMBRE = Object.fromEntries(TIPOS.map(([k, n]) => [k, n]));
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_SEM = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const iso = (d) => d.toISOString().slice(0, 10);
const aFecha = (s) => new Date(`${s}T00:00:00Z`);
const sumar = (s, n) => { const d = aFecha(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const rango = (a, b) => { const out = []; for (let d = a; d <= b; d = sumar(d, 1)) out.push(d); return out; };
const largo = (s) => aFecha(s).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const corto = (s) => aFecha(s).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Domingo de Pascua (algoritmo anónimo gregoriano)
function pascua(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const hh = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const mes = Math.floor((hh + l - 7 * m + 114) / 31), dia = ((hh + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
// Festivos habituales en Cataluña dentro del curso (los locales de cada municipio no se incluyen: se añaden a mano)
export function festivosHabituales(ini, fin) {
  const y1 = Number(ini.slice(0, 4)); const y2 = y1 + 1;
  const p = pascua(y2);
  const lista = [[`${y1}-09-11`, 'Diada de Catalunya'], [`${y1}-10-12`, 'Fiesta Nacional'], [`${y1}-11-01`, 'Todos los Santos'], [`${y1}-12-06`, 'Día de la Constitución'], [`${y1}-12-08`, 'Inmaculada'], [`${y1}-12-25`, 'Navidad'], [`${y1}-12-26`, 'Sant Esteve'],
    [`${y2}-01-01`, 'Año Nuevo'], [`${y2}-01-06`, 'Reyes'], [sumar(p, -2), 'Viernes Santo'], [sumar(p, 1), 'Lunes de Pascua'], [`${y2}-05-01`, 'Fiesta del Trabajo'], [`${y2}-06-24`, 'Sant Joan'], [`${y2}-08-15`, 'Asunción']];
  return lista.filter(([f]) => f >= ini && f <= fin);
}
// rango de fechas del curso: las de la tabla de cursos o, si faltan, de septiembre a agosto según el nombre («2026.27»)
export function rangoCurso(curso) {
  if (curso.fecha_inicio && curso.fecha_fin) return [curso.fecha_inicio, curso.fecha_fin];
  const y = Number((curso.nombre || '').slice(0, 4)) || new Date().getFullYear();
  return [`${y}-09-01`, `${y + 1}-08-31`];
}

export async function renderCalendario(view, ctx) {
  vistaCal = leerV('calendario.vista', 'curso'); if (!['curso', 'google'].includes(vistaCal)) vistaCal = 'curso';
  const curso = ctx.cursoActual();
  const cuerpo = h('div', { class: 'ac-cal-cuerpo' });
  const seg = h('div', { class: 'segmented', role: 'tablist' }, [['curso', 'Calendario del curso'], ['google', 'Google Calendar']].map(([k, l]) =>
    h('button', { class: 'seg-btn', role: 'tab', type: 'button', 'aria-selected': String(vistaCal === k), onclick: () => { vistaCal = k; guardarV('calendario.vista', k); seg.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-selected', String(b.textContent === l))); pintar(); } }, l)));
  clear(view, h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, `Calendario · ${curso.nombre}`)), h('div', { class: 'section-actions' }, seg)), cuerpo);
  async function pintar() {
    if (vistaCal === 'google') { clear(cuerpo, googleCalendar()); return; }
    clear(cuerpo, cargando());
    try { clear(cuerpo, ...(await calendarioCurso(ctx, curso, pintar)).childNodes); } catch (ex) { clear(cuerpo, h('div', { class: 'banner error', role: 'alert' }, 'No se ha podido cargar el calendario: ', ex.message)); }
  }
  await pintar();
}

// ---------- pestaña Google Calendar ----------
function googleCalendar() {
  const src = encodeURIComponent(GOOGLE_CALENDAR);
  const url = `https://calendar.google.com/calendar/embed?src=${src}&ctz=Europe%2FMadrid&hl=es&mode=MONTH&showTitle=0&showPrint=0&showTz=0&wkst=2`;
  return h('div', { class: 'ac-gcal' },
    h('div', { class: 'small muted' }, `Calendario de Google de ${GOOGLE_CALENDAR}. Solo se ve si has iniciado sesión en Google en este navegador con una cuenta que tenga acceso, o si el calendario está compartido como público.`,
      ' ', h('a', { href: `https://calendar.google.com/calendar/u/0/r?cid=${src}`, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir en Google Calendar ↗')),
    h('iframe', { class: 'ac-gcal-marco', src: url, title: 'Google Calendar de la academia', loading: 'lazy', referrerpolicy: 'no-referrer-when-downgrade' }));
}

// ---------- pestaña Calendario del curso ----------
async function calendarioCurso(ctx, curso, repintar) {
  const editor = ctx.edita('ac_calendario');
  const [ini, fin] = rangoCurso(curso);
  const dias = await api.calendarioDias(curso.id);
  const prioridad = Object.fromEntries(TIPOS.map(([k], i) => [k, i]));
  const marcas = new Map(); // fecha -> [marca], la más importante primero
  for (const d of dias) (marcas.get(d.fecha) || marcas.set(d.fecha, []).get(d.fecha)).push(d);
  for (const l of marcas.values()) l.sort((a, b) => (prioridad[a.tipo] ?? 99) - (prioridad[b.tipo] ?? 99));
  const recargar = () => { api.invalidar(); repintar(); };
  let ultimo = null; // último día pulsado (para marcar un rango con Mayús)

  const sinClase = (f) => (marcas.get(f) || []).some((m) => SIN_CLASE.includes(m.tipo));
  const conClase = (f) => { const dsem = (aFecha(f).getUTCDay() + 6) % 7; return dsem < 5 && !sinClase(f); };
  const todos = rango(ini, fin);
  const cuentaTipo = (t) => dias.filter((d) => d.tipo === t && d.fecha >= ini && d.fecha <= fin).length;
  const textoMarcas = (f) => (marcas.get(f) || []).map((m) => `${NOMBRE[m.tipo] || m.tipo}${m.nombre ? ': ' + m.nombre : ''}`).join(' · ');

  function mes(y, m) {
    const primero = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const nDias = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const offset = (aFecha(primero).getUTCDay() + 6) % 7;
    const celdas = [];
    for (let i = 0; i < offset; i++) celdas.push(h('span', { class: 'ac-ano-v' }));
    let lectivos = 0;
    for (let d = 1; d <= nDias; d++) {
      const f = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const fuera = f < ini || f > fin; const mk = marcas.get(f) || []; const dsem = (aFecha(f).getUTCDay() + 6) % 7;
      if (!fuera && conClase(f)) lectivos++;
      const estilo = mk.length ? `--c:${COLOR[mk[0].tipo] || '#888'}${mk[1] ? `;--c2:${COLOR[mk[1].tipo] || '#888'}` : ''}` : null;
      celdas.push(h('button', { type: 'button', class: 'ac-ano-d' + (dsem >= 5 ? ' fin' : '') + (mk.length ? ' marcado' : '') + (mk[1] ? ' doble' : '') + (fuera ? ' fuera' : ''), 'data-fecha': f, disabled: fuera || null,
        style: estilo, title: mk.length ? `${largo(f)} · ${textoMarcas(f)}` : largo(f),
        onclick: (e) => { if (e.shiftKey && ultimo && ultimo !== f) abrirDia(ultimo < f ? ultimo : f, ultimo < f ? f : ultimo); else { ultimo = f; abrirDia(f, f); } } }, String(d)));
    }
    return h('div', { class: 'ac-ano-mes card' }, h('h3', {}, `${MESES[m]} ${y}`, h('span', { class: 'small muted' }, `${lectivos} días con clase`)),
      h('div', { class: 'ac-ano-sem' }, DIAS_SEM.map((x) => h('span', {}, x))), h('div', { class: 'ac-ano-dias' }, celdas));
  }

  const meses = [];
  for (let y = Number(ini.slice(0, 4)), m = Number(ini.slice(5, 7)) - 1; `${y}-${String(m + 1).padStart(2, '0')}` <= fin.slice(0, 7); m++) { if (m > 11) { m = 0; y++; } meses.push(mes(y, m)); if (meses.length > 14) break; }

  // lista de días marcados: los consecutivos (saltando fines de semana) con el mismo tipo y nombre se juntan
  const marcados = dias.filter((d) => d.fecha >= ini && d.fecha <= fin).sort((a, b) => a.tipo.localeCompare(b.tipo) || (a.nombre || '').localeCompare(b.nombre || '') || a.fecha.localeCompare(b.fecha));
  const siguiente = (f) => { let n = sumar(f, 1); while (((aFecha(n).getUTCDay() + 6) % 7) >= 5) n = sumar(n, 1); return n; };
  const tramos = [];
  for (const d of marcados) {
    const t = tramos[tramos.length - 1];
    if (t && t.tipo === d.tipo && (t.nombre || '') === (d.nombre || '') && (sumar(t.hasta, 1) === d.fecha || (d.tipo !== 'festivo' && siguiente(t.hasta) === d.fecha && d.fecha > t.hasta))) t.hasta = d.fecha;
    else tramos.push({ desde: d.fecha, hasta: d.fecha, tipo: d.tipo, nombre: d.nombre });
  }
  tramos.sort((a, b) => a.desde.localeCompare(b.desde) || (prioridad[a.tipo] ?? 99) - (prioridad[b.tipo] ?? 99));

  function abrirDia(desde, hasta) {
    if (!editor) return;
    const d = drawer({ titulo: desde === hasta ? largo(desde) : `${corto(desde)} → ${corto(hasta)}`, ancho: 460 });
    const existentes = desde === hasta ? marcas.get(desde) || [] : [];
    const F = { tipo: sel([['', 'Quitar todas las marcas de estos días'], ...TIPOS.map(([k, n]) => [k, n])], existentes[0]?.tipo || 'festivo', {}), nombre: txt(existentes[0]?.nombre || '', { placeholder: 'Navidad, puente, Open day…' }), desde: fecha(desde), hasta: fecha(hasta),
      lv: h('input', { type: 'checkbox', checked: desde !== hasta }) };
    const cajaEx = h('div');
    const pintarEx = () => clear(cajaEx, existentes.length ? h('div', { class: 'form-section' }, h('h3', {}, 'Marcas de este día'), h('div', { class: 'full' }, existentes.map((m) => h('div', { class: 'ac-fila' },
      h('span', { class: 'ac-punto', style: `background:${COLOR[m.tipo] || '#888'}` }), h('strong', {}, NOMBRE[m.tipo] || m.tipo), h('span', { class: 'muted small' }, m.nombre || ''),
      h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { try { await api.delMany('ac_calendario_marcas', [m.id]); toast('Marca quitada'); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } }, 'Quitar')))))
      : null);
    pintarEx();
    d.cuerpo.append(cajaEx, h('div', { class: 'form-section' }, h('h3', {}, existentes.length ? 'Añadir o cambiar una marca' : 'Marcar'), campo('Qué es', F.tipo, { full: true }), campo('Nombre', F.nombre, { full: true }), campo('Desde', F.desde), campo('Hasta', F.hasta),
      h('label', { class: 'check full' }, F.lv, ' Solo de lunes a viernes (para camps y semanas temáticas)')),
      h('div', { class: 'small muted' }, 'Si ya hay una marca del mismo tipo ese día se actualiza. Para varios días seguidos cambia «Hasta» o usa Mayús + clic en el calendario.'));
    const guardar = guardarBoton('Guardar', async () => {
      const a = F.desde.value; const b = F.hasta.value || a;
      if (!a || b < a) { toast('Revisa las fechas: «Hasta» no puede ser anterior a «Desde».', 'error'); return; }
      let fs = rango(a, b); if (fs.length > 400) { toast('Demasiados días de golpe.', 'error'); return; }
      if (F.lv.checked && a !== b) fs = fs.filter((f) => ((aFecha(f).getUTCDay() + 6) % 7) < 5);
      try {
        if (!F.tipo.value) { const ids = fs.flatMap((f) => (marcas.get(f) || []).map((m) => m.id)); if (ids.length) await api.delMany('ac_calendario_marcas', ids); }
        else await api.insMany('ac_calendario_marcas', fs.map((f) => ({ curso_id: curso.id, fecha: f, tipo: F.tipo.value, nombre: F.nombre.value.trim() || null })), { onConflict: 'curso_id,fecha,tipo' });
        toast('Calendario guardado'); d.cerrar(); recargar();
      } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
    });
    d.pie.append(h('span'), guardar);
  }

  async function anadirHabituales() {
    const nuevos = festivosHabituales(ini, fin).filter(([f]) => !(marcas.get(f) || []).some((m) => m.tipo === 'festivo'));
    if (!nuevos.length) { toast('Los festivos habituales ya están marcados.'); return; }
    if (!await confirmar({ titulo: 'Añadir festivos habituales', texto: `Se marcarán ${nuevos.length} festivos de Cataluña (${nuevos.map(([f]) => corto(f)).join(', ')}). No se tocan las marcas que ya tienes. Los festivos locales de tu municipio añádelos a mano. Revisa las fechas del curso.`, ok: 'Añadir' })) return;
    try { await api.insMany('ac_calendario_marcas', nuevos.map(([f, n]) => ({ curso_id: curso.id, fecha: f, tipo: 'festivo', nombre: n })), { onConflict: 'curso_id,fecha,tipo', ignorar: true }); toast('Festivos añadidos'); recargar(); } catch (ex) { toast(ex.message, 'error'); }
  }

  const leyenda = h('div', { class: 'ac-leyenda small' }, TIPOS.map(([k, n, c]) => h('span', {}, h('span', { class: 'ac-punto', style: `background:${c}` }), `${n} (${cuentaTipo(k)})`)), h('span', { class: 'muted' }, `Días con clase (L–V): ${todos.filter(conClase).length}`));
  const lista = h('div', { class: 'card ac-ano-lista' }, h('h3', { class: 'sub-titulo' }, 'Días marcados'),
    tramos.length ? tramos.map((t) => h('div', { class: 'ac-fila ac-ano-tramo', onclick: editor ? () => abrirDia(t.desde, t.hasta) : null },
      h('span', { class: 'ac-punto', style: `background:${COLOR[t.tipo] || '#888'}` }), h('strong', {}, t.desde === t.hasta ? corto(t.desde) : `${corto(t.desde)} → ${corto(t.hasta)}`), h('span', {}, t.nombre || NOMBRE[t.tipo] || t.tipo), h('span', { class: 'small muted' }, NOMBRE[t.tipo] || ''))) : h('div', { class: 'muted small' }, 'Todavía no hay días marcados. Pulsa un día del calendario para marcarlo.'));
  const raiz = h('div', { style: 'display:flex; flex-direction:column; gap:8px' });
  raiz.append(h('div', { class: 'section-actions' }, h('span', { class: 'small muted' }, `${corto(ini)} ${ini.slice(0, 4)} – ${corto(fin)} ${fin.slice(0, 4)}`), editor ? h('button', { class: 'btn small', type: 'button', onclick: anadirHabituales }, 'Añadir festivos habituales') : null),
    editor ? h('div', { class: 'small muted' }, 'Clic en un día para marcarlo; Mayús + clic en otro día marca el rango. Un día puede tener varias marcas (el color grande es la más importante, la franja de abajo es la segunda).') : null, leyenda, h('div', { class: 'ac-ano' }, meses), lista);
  return raiz;
}
