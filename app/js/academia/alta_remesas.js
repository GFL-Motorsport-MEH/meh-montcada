// Cuando un alumno pasa a pagar por domiciliación (alta nueva, inscripción o cambio de modo de pago) se pregunta si se añade a las remesas:
//  1) a su remesa de la lista (Sabadell 1–21, BBVA…), que es lo que se envía al banco cada mes;
//  2) sus cuotas pendientes a las remesas mensuales abiertas (en borrador).
import { h, confirmar, toast, fmtEUR2 } from '../ui.js';
import * as api from './api.js';
import { sel, nombreAlumno } from './kit.js';

export const esDomi = (m) => /domicil|sepa|recibo/i.test(m || '');

export async function ofrecerRemesaGrupo(a, ctx) {
  if (!ctx.edita('ac_remesas')) return false;
  const [lista, domis] = await Promise.all([api.remesasLista(), api.domiciliaciones()]);
  const dom = domis.find((d) => d.alumno_id === a.id && !d.archivado);
  if (dom?.remesa_id) return false;
  const s = sel(lista.map((r) => [r.id, `${r.nombre} · ${r.banco === 'BBVA' ? 'BBVA' : 'Sabadell'}`]), '', { vacio: '— elige remesa —', 'aria-label': 'Remesa' });
  const ok = await confirmar({ titulo: 'Añadir a una remesa', texto: h('div', {}, h('p', {}, `${nombreAlumno(a)} paga por domiciliación. ¿La añado a una remesa? Elige cuál (puedes dejarlo para luego en Remesas).`), s), ok: 'Añadir a la remesa' });
  if (!ok) return false;
  if (!s.value) { toast('No has elegido remesa: queda sin añadir (puedes hacerlo en Remesas).'); return false; }
  if (dom) await api.upd('ac_domiciliaciones', dom.id, { remesa_id: s.value, archivado: false });
  else await api.ins('ac_domiciliaciones', { alumno_id: a.id, remesa_id: s.value });
  api.invalidar(); toast('Añadido a la remesa.');
  return true;
}

export async function ofrecerCuotasARemesas(a, ctx) {
  if (!ctx.edita('ac_remesas')) return false;
  const curso = ctx.cursoActual();
  const [remesas, cuotas] = await Promise.all([api.remesas(curso.id), api.cuotas(curso.id)]);
  const pend = cuotas.filter((c) => c.alumno_id === a.id && c.concepto === 'mensualidad' && c.estado === 'pendiente' && !c.remesa_id && Number(c.importe) > 0);
  if (!pend.length) return false;
  const abierta = (mes) => remesas.find((r) => r.mes === mes && r.estado === 'borrador');
  const metibles = pend.filter((c) => abierta(c.mes));
  if (!metibles.length) return false;
  const total = metibles.reduce((t, c) => t + Number(c.importe), 0);
  const meses = [...new Set(metibles.map((c) => c.mes))];
  if (!await confirmar({ titulo: 'Añadir cuotas a las remesas', texto: `¿Añado sus ${metibles.length} cuota${metibles.length === 1 ? '' : 's'} pendiente${metibles.length === 1 ? '' : 's'} (${fmtEUR2(total)}) a las remesas abiertas de ${meses.join(', ')}?`, ok: 'Añadir' })) return false;
  for (const mes of meses) await api.updMany('ac_cuotas', metibles.filter((c) => c.mes === mes).map((c) => c.id), { remesa_id: abierta(mes).id });
  api.invalidar(); toast('Cuotas añadidas a las remesas.');
  return true;
}

export async function ofrecerRemesas(a, ctx) { await ofrecerRemesaGrupo(a, ctx); await ofrecerCuotasARemesas(a, ctx); }
