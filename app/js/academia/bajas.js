// Bajas: registro de bajas con motivo, permanencia en la academia y resumen por motivo.
import { leerV, guardarV, crearAviso } from '../vista.js';
import { h, clear, cargando, toast, confirmar, fmtFecha, hoyISO, normalizar } from '../ui.js';
import * as api from './api.js';
import { campo, txt, area, fecha, sel, drawer, cabecera, tabla, nombreAlumno, guardarBoton, buscadorAlumno, refrescar } from './kit.js';
import { abrirFicha } from './alumnos.js';

const meses = (a, b) => { if (!a || !b) return null; const x = new Date(a), y = new Date(b); return Math.max(0, (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth()); };
export const permanencia = (a, b) => { const m = meses(a, b); return m === null ? '' : m >= 12 ? `${Math.floor(m / 12)} a ${m % 12} m` : `${m} meses`; };


// Un color por motivo (se reutiliza en la ficha del alumno). Los motivos nuevos reciben uno estable según su texto.
const COLORES = {
  'cambio residencia': '#2563eb', 'cambio de residencia': '#2563eb', 'incompatibilidad horaria': '#7c3aed', 'falta de aprendizaje': '#d97706',
  'problema con profesora': '#dc2626', 'problema con otros alumnos': '#be185d', 'problema con gestion': '#0891b2', 'no le gusta el metodo': '#ea580c',
  'precio': '#16a34a', 'problemas economicos': '#65a30d', 'motivos economicos': '#65a30d', 'problemas personales': '#0d9488', 'enfermedad': '#e11d48',
  'baja pero volvera': '#0ea5e9', 'cambio de actividad': '#a21caf', 'otros': '#78716c', 'sin motivos': '#6b7280', 'sin motivo': '#6b7280',
};
const EXTRA = ['#b45309', '#4338ca', '#047857', '#9d174d', '#0369a1', '#a16207'];
export const colorMotivo = (m) => { const k = normalizar(m || 'sin motivo'); if (COLORES[k]) return COLORES[k]; let x = 0; for (const c of k) x = (x * 31 + c.charCodeAt(0)) >>> 0; return EXTRA[x % EXTRA.length]; };
export const pillMotivo = (m) => h('span', { class: 'ac-motivo', style: `--c:${colorMotivo(m)}` }, m || 'Sin motivo');

export async function renderBajas(view, ctx) {
  clear(view, cargando());
  const [bajas, alumnos, ls] = await Promise.all([api.bajas(), api.alumnos(), api.listas()]);
  const editor = ctx.edita('ac_bajas');
  const recargar = () => { api.invalidar(); refrescar(); };
  const porMotivo = new Map();
  for (const b of bajas) { const m = b.motivo || 'Sin motivo'; porMotivo.set(m, (porMotivo.get(m) || 0) + 1); }
  const resumen = [...porMotivo.entries()].sort((a, b) => b[1] - a[1]);
  const sinEnlazar = bajas.filter((b) => !b.alumno).length;
  let filtro = leerV('bajas.motivo', '');
  if (filtro && !porMotivo.has(filtro)) filtro = '';
  const barra = h('div', { class: 'ac-barra-motivos' }, resumen.map(([m, n]) => h('span', { style: `flex:${n};--c:${colorMotivo(m)}`, title: `${m}: ${n}` })));
  const chips = h('div', { class: 'ac-motivos' });
  const zona = h('div');
  const aviso = crearAviso({ obtener: () => [['Motivo de la baja', filtro]], limpiar: () => { filtro = ''; guardarV('bajas.motivo', ''); pintaChips(); pintaTabla(); } });
  const pintaChips = () => clear(chips, resumen.map(([m, n]) => h('button', { type: 'button', class: 'ac-motivo ac-motivo-btn' + (filtro === m ? ' activo' : ''), style: `--c:${colorMotivo(m)}`, title: filtro === m ? 'Quitar filtro' : 'Ver solo este motivo',
    onclick: () => { filtro = filtro === m ? '' : m; guardarV('bajas.motivo', filtro); pintaChips(); pintaTabla(); } }, `${m} `, h('strong', {}, String(n)))));
  const pintaTabla = () => {
    aviso.actualizar();
    const filas = bajas.filter((b) => !filtro || (b.motivo || 'Sin motivo') === filtro).sort((a, b) => (b.fecha_baja || '').localeCompare(a.fecha_baja || ''));
    clear(zona, tabla([
      { t: 'ID', v: (b) => (b.alumno?.num ? String(Math.round(b.alumno.num)) : h('span', { class: 'muted' }, '—')) },
      { t: 'Alumno', v: (b) => h('span', {}, h('span', { class: 'ac-punto', style: `background:${colorMotivo(b.motivo)}` }), b.alumno ? h('strong', {}, nombreAlumno(b.alumno)) : h('span', { class: 'muted' }, 'Sin alumno enlazado')) },
      { t: 'Nivel', v: (b) => b.alumno?.nivel || '' }, { t: 'Alta', v: (b) => fmtFecha(b.fecha_alta) }, { t: 'Baja', v: (b) => fmtFecha(b.fecha_baja) },
      { t: 'Permanencia', v: (b) => permanencia(b.fecha_alta, b.fecha_baja) }, { t: 'Motivo', v: (b) => pillMotivo(b.motivo) }, { t: 'Comentarios', v: (b) => b.comentarios || '' },
    ], filas, { vacio: 'No hay bajas registradas.', clase: 'ac-tabla-bajas', onClick: (b) => { const a = alumnos.find((x) => x.id === b.alumno_id); if (a) abrirFicha(a, ctx, recargar); } }));
  };
  pintaChips(); pintaTabla();
  clear(view,
    cabecera('Bajas', `${bajas.length} bajas registradas`, editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrir({ alumnos, ls, recargar }) }, '+ Registrar baja') : null),
    sinEnlazar ? h('div', { class: 'banner warn' }, `${sinEnlazar} baja${sinEnlazar === 1 ? '' : 's'} sin alumno enlazado: no aparecen en la ficha de ningún alumno.`) : null,
    resumen.length ? h('div', { class: 'card ac-motivos-card' }, barra, chips) : null, aviso, zona);
  // llegada desde la ficha de un alumno («Dar de baja…»)
  let pre = null; try { pre = sessionStorage.getItem('ac.baja.alumno'); sessionStorage.removeItem('ac.baja.alumno'); } catch { /* */ }
  if (pre && editor) abrir({ alumnos, ls, recargar, alumnoId: pre });
}

function abrir({ alumnos, ls, recargar, alumnoId }) {
  const d = drawer({ titulo: 'Registrar baja', ancho: 540 });
  const b = buscadorAlumno(alumnos, { valorId: alumnoId, soloActivos: true }); const f = fecha(hoyISO()); const m = sel(ls.motivo_baja || ['Otros'], '', { vacio: 'Elige un motivo…' }); const c = area('', { rows: 3 });
  d.cuerpo.append(h('div', { class: 'form-section' }, campo('Alumno', b, { full: true, req: true }), campo('Fecha de baja', f), campo('Motivo', m), campo('Comentarios', c, { full: true })),
    h('div', { class: 'small muted' }, 'Pasa al alumno a estado «baja», le quita de sus grupos y desactiva su inscripción del curso.'));
  d.pie.append(h('span'), guardarBoton('Registrar baja', async () => {
    const a = b.getAlumno(); if (!a) { toast('Elige un alumno de la lista.', 'error'); return; }
    if (!await confirmar({ titulo: 'Confirmar baja', texto: `${nombreAlumno(a)} dejará de figurar como inscrito.`, ok: 'Dar de baja', peligro: true })) return;
    try {
      await api.ins('ac_bajas', { alumno_id: a.id, fecha_alta: a.fecha_entrada, fecha_baja: f.value || hoyISO(), motivo: m.value || null, comentarios: c.value.trim() || null });
      await api.upd('ac_alumnos', a.id, { estado: 'baja', fecha_baja: f.value || hoyISO() });
      const { supabase } = await import('../db.js');
      await supabase.from('ac_alumno_grupo').update({ fecha_baja: f.value || hoyISO() }).eq('alumno_id', a.id).is('fecha_baja', null);
      await supabase.from('ac_inscripciones').update({ activa: false }).eq('alumno_id', a.id).eq('activa', true);
      api.invalidar(); toast('Baja registrada'); d.cerrar(); recargar();
    } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
  }));
}
