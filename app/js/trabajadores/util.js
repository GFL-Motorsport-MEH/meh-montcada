// Funciones sencillas del módulo Trabajadores (fechas, horas, contrato vigente…).
import { h } from '../ui.js';
import { DIAS } from '../academia/kit.js';

export const TIPOS_CONTRATO = [['indefinido', 'Indefinido'], ['temporal', 'Temporal'], ['fijo_discontinuo', 'Fijo discontinuo'], ['practicas', 'Prácticas'], ['obra', 'Obra o servicio'], ['autonomo', 'Autónomo/a'], ['otro', 'Otro']];
export const NOM_CONTRATO = Object.fromEntries(TIPOS_CONTRATO);
export const TIPOS_HORAS = [['extra', 'Horas de más (a favor)'], ['compensacion', 'Horas devueltas / disfrutadas'], ['ajuste', 'Ajuste'], ['saldo_inicial', 'Saldo inicial']];
export const NOM_HORAS = Object.fromEntries(TIPOS_HORAS);
export const JORNADAS = [['completa', 'Completa'], ['parcial', 'Parcial']];
export const hhmm = (t) => (t || '').slice(0, 5);
export const nombreDia = (d) => DIAS[d] || '';

// «+3,5 h», «−2 h», «0 h»
export function fmtHoras(n, conSigno = false) {
  const v = Math.round(Number(n || 0) * 100) / 100;
  const t = Math.abs(v).toLocaleString('es-ES', { maximumFractionDigits: 2 });
  return `${v < 0 ? '−' : conSigno && v > 0 ? '+' : ''}${t} h`;
}
export const claseSaldo = (n) => (n > 0.004 ? 'tr-pos' : n < -0.004 ? 'tr-neg' : '');

const minutos = (t) => { const [a, b] = hhmm(t).split(':').map(Number); return a * 60 + (b || 0); };
export const horasFranja = (f) => (minutos(f.hora_fin) - minutos(f.hora_inicio)) / 60;
export const sumaHoras = (franjas) => franjas.reduce((s, f) => s + horasFranja(f), 0);

// contrato en vigor en una fecha (el de inicio más reciente que ya haya empezado y no haya terminado)
export function vigente(lista, fecha) {
  return lista.filter((c) => c.fecha_inicio <= fecha && (!c.fecha_fin || c.fecha_fin >= fecha)).sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio))[0] || null;
}
export const diasHasta = (iso, hoy) => Math.round((new Date(iso) - new Date(hoy)) / 86400000);

// saldo de la bolsa de horas por trabajador
export function saldos(movs) {
  const m = new Map();
  for (const x of movs) m.set(x.profile_id, Math.round(((m.get(x.profile_id) || 0) + Number(x.horas)) * 100) / 100);
  return m;
}

// horario semanal en una tabla de 7 columnas (lunes a domingo); solo pinta los días que tienen franjas (siempre L–V)
export function semana(franjas) {
  const dias = [1, 2, 3, 4, 5, ...[6, 7].filter((d) => franjas.some((f) => f.dia === d))];
  return h('div', { class: 'tr-semana', style: `grid-template-columns:repeat(${dias.length},minmax(0,1fr))` }, dias.map((d) => h('div', { class: 'tr-dia' },
    h('div', { class: 'tr-dia-t' }, nombreDia(d)),
    franjas.filter((f) => f.dia === d).sort((a, b) => hhmm(a.hora_inicio).localeCompare(hhmm(b.hora_inicio))).map((f) => h('div', { class: 'tr-franja', title: f.concepto || '' },
      h('strong', {}, `${hhmm(f.hora_inicio)}–${hhmm(f.hora_fin)}`), f.concepto ? h('span', { class: 'muted' }, ' ' + f.concepto) : null)),
    franjas.some((f) => f.dia === d) ? null : h('div', { class: 'muted tr-libre' }, '—'))));
}

// trabajadores que puede ver este usuario: todos los activos si tiene alcance «todo» en algún permiso de Trabajadores, si no solo él mismo
export async function personasVisibles(ctx, api, claves) {
  const yo = ctx.state.perfil;
  if (!claves.some((k) => ctx.ve(k))) return [yo];
  const eq = await api.usuarios().catch(() => []);
  const l = eq.filter((u) => u.activo !== false);
  if (!l.some((u) => u.id === yo.id)) l.push(yo);
  return l.sort((a, b) => (a.nombre || a.email || '').localeCompare(b.nombre || b.email || '', 'es'));
}
export const nombreUsuario = (u) => u?.nombre || u?.email || '—';
