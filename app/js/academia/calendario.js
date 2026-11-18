// Calendario anual del curso: los 365 días de septiembre a agosto, con festivos, vacaciones, días sin clase y eventos editables.
// Clic en un día = marcarlo/editarlo; Mayús + clic en otro día = marcar todo el rango. Es el calendario de DÍAS; el horario semanal está en «Horarios».
import { h, clear, cargando, toast, confirmar } from '../ui.js';
import * as api from './api.js';
import { campo, sel, txt, fecha, drawer, cabecera, guardarBoton, refrescar } from './kit.js';

export const TIPOS = [
  ['festivo', 'Festivo', '#d64545'],
  ['vacaciones', 'Vacaciones', '#3f7ad9'],
  ['sin_clase', 'Sin clase (puente, jornada…)', '#e08a3c'],
  ['evento', 'Evento / reunión', '#8c6bc8'],
];
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
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const editor = ctx.edita('ac_calendario');
  const [ini, fin] = rangoCurso(curso);
  const dias = await api.calendarioDias(curso.id);
  const marca = new Map(dias.map((d) => [d.fecha, d]));
  const recargar = () => { api.invalidar(); refrescar(); };
  let ultimo = null; // último día pulsado (para marcar un rango con Mayús)

  // días con clase = lunes a viernes sin marcar
  const conClase = (f) => { const dsem = (aFecha(f).getUTCDay() + 6) % 7; return dsem < 5 && !marca.has(f); };
  const todos = rango(ini, fin);
  const cuentaTipo = (t) => dias.filter((d) => d.tipo === t && d.fecha >= ini && d.fecha <= fin).length;

  function mes(y, m) {
    const primero = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const nDias = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const offset = (aFecha(primero).getUTCDay() + 6) % 7;
    const celdas = [];
    for (let i = 0; i < offset; i++) celdas.push(h('span', { class: 'ac-ano-v' }));
    let lectivos = 0;
    for (let d = 1; d <= nDias; d++) {
      const f = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const fuera = f < ini || f > fin; const mk = marca.get(f); const dsem = (aFecha(f).getUTCDay() + 6) % 7;
      if (!fuera && conClase(f)) lectivos++;
      const el = h('button', { type: 'button', class: 'ac-ano-d' + (dsem >= 5 ? ' fin' : '') + (mk ? ' marcado' : '') + (fuera ? ' fuera' : ''), 'data-fecha': f, disabled: fuera || null,
        style: mk ? `--c:${COLOR[mk.tipo] || '#888'}` : null, title: mk ? `${largo(f)} · ${NOMBRE[mk.tipo] || mk.tipo}${mk.nombre ? ': ' + mk.nombre : ''}` : largo(f),
        onclick: (e) => { if (e.shiftKey && ultimo && ultimo !== f) abrirDia(ultimo < f ? ultimo : f, ultimo < f ? f : ultimo); else { ultimo = f; abrirDia(f, f); } } }, String(d));
      celdas.push(el);
    }
    return h('div', { class: 'ac-ano-mes card' }, h('h3', {}, `${MESES[m]} ${y}`, h('span', { class: 'small muted' }, `${lectivos} días con clase`)),
      h('div', { class: 'ac-ano-sem' }, DIAS_SEM.map((x) => h('span', {}, x))), h('div', { class: 'ac-ano-dias' }, celdas));
  }

  const meses = [];
  for (let y = Number(ini.slice(0, 4)), m = Number(ini.slice(5, 7)) - 1; `${y}-${String(m + 1).padStart(2, '0')}` <= fin.slice(0, 7); m++) { if (m > 11) { m = 0; y++; } meses.push(mes(y, m)); if (meses.length > 14) break; }

  // lista de días marcados (los consecutivos del mismo tipo y nombre se juntan)
  const marcados = dias.filter((d) => d.fecha >= ini && d.fecha <= fin).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const tramos = [];
  for (const d of marcados) { const t = tramos[tramos.length - 1]; if (t && t.tipo === d.tipo && (t.nombre || '') === (d.nombre || '') && sumar(t.hasta, 1) === d.fecha) t.hasta = d.fecha; else tramos.push({ desde: d.fecha, hasta: d.fecha, tipo: d.tipo, nombre: d.nombre }); }

  function abrirDia(desde, hasta) {
    if (!editor) return;
    const d = drawer({ titulo: desde === hasta ? largo(desde) : `${corto(desde)} → ${corto(hasta)}`, ancho: 460 });
    const m0 = marca.get(desde);
    const F = { tipo: sel([['', 'Día normal (con clase)'], ...TIPOS.map(([k, n]) => [k, n])], m0?.tipo || '', {}), nombre: txt(m0?.nombre || '', { placeholder: 'Navidad, puente, Open day…' }), desde: fecha(desde), hasta: fecha(hasta) };
    d.cuerpo.append(h('div', { class: 'form-section' }, campo('Qué es', F.tipo, { full: true }), campo('Nombre', F.nombre, { full: true }), campo('Desde', F.desde), campo('Hasta', F.hasta)),
      h('div', { class: 'small muted' }, 'Elige «Día normal» para quitar la marca. Para varios días seguidos cambia «Hasta» o usa Mayús + clic en el calendario.'));
    const guardar = guardarBoton('Guardar', async () => {
      const a = F.desde.value; const b = F.hasta.value || a;
      if (!a || b < a) { toast('Revisa las fechas: «Hasta» no puede ser anterior a «Desde».', 'error'); return; }
      const fs = rango(a, b); if (fs.length > 400) { toast('Demasiados días de golpe.', 'error'); return; }
      try {
        if (!F.tipo.value) { const ids = fs.map((f) => marca.get(f)?.id).filter(Boolean); if (ids.length) await api.delMany('ac_calendario_dias', ids); }
        else await api.insMany('ac_calendario_dias', fs.map((f) => ({ curso_id: curso.id, fecha: f, tipo: F.tipo.value, nombre: F.nombre.value.trim() || null })), { onConflict: 'curso_id,fecha' });
        toast('Calendario guardado'); d.cerrar(); recargar();
      } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
    });
    d.pie.append(h('span'), guardar);
  }

  async function anadirHabituales() {
    const nuevos = festivosHabituales(ini, fin).filter(([f]) => !marca.has(f));
    if (!nuevos.length) { toast('Los festivos habituales ya están marcados.'); return; }
    if (!await confirmar({ titulo: 'Añadir festivos habituales', texto: `Se marcarán ${nuevos.length} festivos de Cataluña (${nuevos.map(([f]) => corto(f)).join(', ')}). No se tocan los días que ya tienes marcados. Los festivos locales de tu municipio añádelos a mano. Revisa las fechas del curso.`, ok: 'Añadir' })) return;
    try { await api.insMany('ac_calendario_dias', nuevos.map(([f, n]) => ({ curso_id: curso.id, fecha: f, tipo: 'festivo', nombre: n })), { onConflict: 'curso_id,fecha', ignorar: true }); toast('Festivos añadidos'); recargar(); } catch (ex) { toast(ex.message, 'error'); }
  }

  const leyenda = h('div', { class: 'ac-leyenda small' }, TIPOS.map(([k, n, c]) => h('span', {}, h('span', { class: 'ac-punto', style: `background:${c}` }), `${n} (${cuentaTipo(k)})`)), h('span', { class: 'muted' }, `Días con clase (L–V): ${todos.filter(conClase).length}`));
  const lista = h('div', { class: 'card ac-ano-lista' }, h('h3', { class: 'sub-titulo' }, 'Días marcados'),
    tramos.length ? tramos.map((t) => h('div', { class: 'ac-fila ac-ano-tramo', onclick: editor ? () => abrirDia(t.desde, t.hasta) : null },
      h('span', { class: 'ac-punto', style: `background:${COLOR[t.tipo] || '#888'}` }), h('strong', {}, t.desde === t.hasta ? corto(t.desde) : `${corto(t.desde)} → ${corto(t.hasta)}`), h('span', {}, t.nombre || NOMBRE[t.tipo] || t.tipo), h('span', { class: 'small muted' }, NOMBRE[t.tipo] || ''))) : h('div', { class: 'muted small' }, 'Todavía no hay días marcados. Pulsa un día del calendario para marcarlo.'));
  clear(view, cabecera(`Calendario · ${curso.nombre}`, `${corto(ini)} ${ini.slice(0, 4)} – ${corto(fin)} ${fin.slice(0, 4)}`, editor ? h('button', { class: 'btn small', type: 'button', onclick: anadirHabituales }, 'Añadir festivos habituales') : null),
    editor ? h('div', { class: 'small muted' }, 'Clic en un día para marcarlo (festivo, vacaciones, sin clase, evento); Mayús + clic en otro día marca el rango.') : null, leyenda, h('div', { class: 'ac-ano' }, meses), lista);
}
