// Bajas: registro de bajas con motivo, permanencia en la academia y resumen por motivo.
import { h, clear, cargando, toast, confirmar, fmtFecha, hoyISO } from '../ui.js';
import * as api from './api.js';
import { campo, txt, area, fecha, sel, drawer, cabecera, tabla, pill, nombreAlumno, guardarBoton, buscadorAlumno, refrescar } from './kit.js';

const meses = (a, b) => { if (!a || !b) return null; const x = new Date(a), y = new Date(b); return Math.max(0, (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth()); };
export const permanencia = (a, b) => { const m = meses(a, b); return m === null ? '' : m >= 12 ? `${Math.floor(m / 12)} a ${m % 12} m` : `${m} meses`; };

export async function renderBajas(view, ctx) {
  clear(view, cargando());
  const [bajas, alumnos, ls] = await Promise.all([api.bajas(), api.alumnos(), api.listas()]);
  const editor = ctx.puedeEditar();
  const recargar = () => { api.invalidar(); refrescar(); };
  const porMotivo = new Map();
  for (const b of bajas) { const m = b.motivo || 'Sin motivo'; porMotivo.set(m, (porMotivo.get(m) || 0) + 1); }
  const resumen = [...porMotivo.entries()].sort((a, b) => b[1] - a[1]);
  clear(view,
    cabecera('Bajas', `${bajas.length} bajas registradas`, editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrir({ alumnos, ls, recargar }) }, '+ Registrar baja') : null),
    resumen.length ? h('div', { class: 'chips' }, resumen.map(([m, n]) => h('span', { class: 'chip' }, `${m}: `, h('strong', {}, String(n))))) : null,
    tabla([
      { t: 'Alumno', v: (b) => h('strong', {}, nombreAlumno(b.alumno)) }, { t: 'Nivel', v: (b) => b.alumno?.nivel || '' }, { t: 'Alta', v: (b) => fmtFecha(b.fecha_alta) }, { t: 'Baja', v: (b) => fmtFecha(b.fecha_baja) },
      { t: 'Permanencia', v: (b) => permanencia(b.fecha_alta, b.fecha_baja) }, { t: 'Motivo', v: (b) => (b.motivo ? pill(b.motivo, 'warn') : '') }, { t: 'Comentarios', v: (b) => b.comentarios || '' },
    ], bajas.slice().sort((a, b) => (b.fecha_baja || '').localeCompare(a.fecha_baja || '')), { vacio: 'No hay bajas registradas.' }));
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
