// Módulo Academia (en desarrollo): gestión diaria de la academia.
// De momento muestra lo que ya se puede saber con los datos existentes y el plan del módulo.
import { h, clear, cargando, fmtEUR, normalizar } from '../ui.js';
import * as db from '../db.js';

const PLAN = [
  ['Alumnos', 'Ficha de cada alumno: datos de contacto, tutores, grupo, nivel, descuentos (AMPA, antiguo alumno, hermanos) y estado (activo / baja).'],
  ['Grupos y horarios', 'Grupos por nivel y edad, aula, profesor y horario semanal. Vista de calendario por centro.'],
  ['Pagos', 'Cuotas mensuales por alumno, recibos emitidos y pendientes de cobro, enlazados con Facturación (CRM).'],
  ['Asistencia', 'Pasar lista por grupo y día; avisos de faltas repetidas.'],
  ['Profesores', 'Horas por profesor y grupo, para cruzar con nóminas y el coste por hora.'],
];

export async function renderAcademia(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  if (!ctx.state.facturacion) {
    try { ctx.state.facturacion = await db.getFacturacion(); } catch { ctx.state.facturacion = []; }
  }
  const lineas = ctx.state.facturacion.filter((l) => l.fecha_pago && (!curso.fecha_inicio || l.fecha_pago >= curso.fecha_inicio) && (!curso.fecha_fin || l.fecha_pago <= curso.fecha_fin));
  const alumnos = new Set(lineas.map((l) => normalizar(l.alumno || '').trim()).filter(Boolean));
  const total = lineas.reduce((s, l) => s + Number(l.cantidad || 0), 0);
  const kpi = (label, valor, sub) => h('div', { class: 'card kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, valor), sub ? h('div', { class: 'sub' }, sub) : null);

  clear(view,
    h('div', { class: 'banner' }, h('span', {}, h('strong', {}, 'Módulo en desarrollo. '), 'Aquí irá la gestión diaria de la academia. Mientras tanto, estas cifras salen de la facturación importada del CRM.')),
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, `Academia · ${curso.nombre}`), h('div', { class: 'count' }, 'Resumen del curso a partir de los recibos'))),
    h('div', { class: 'kpi-row' },
      kpi('Alumnos con recibos', String(alumnos.size), 'Alumnos distintos con algún recibo en el curso'),
      kpi('Recibos', String(new Set(lineas.map((l) => l.num_recibo).filter(Boolean)).size)),
      kpi('Facturado', fmtEUR(total))),
    h('h3', { class: 'sub-titulo' }, 'Lo que tendrá este módulo'),
    h('div', { class: 'plan-academia' }, PLAN.map(([t, d]) => h('div', { class: 'card plan-item' }, h('h3', {}, t), h('p', { class: 'small muted' }, d)))));
}
