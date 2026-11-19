// TRABAJADORES · Equipo: una fila por trabajador con su contrato en vigor, horas contratadas, saldo de la bolsa y documentos.
// Solo para quien tiene alcance «todo» en algún permiso de Trabajadores; cada dato aparece solo si tiene su permiso.
import { h, clear, cargando, fmtFecha, hoyISO } from '../ui.js';
import * as api from './api.js';
import { tabla, cabecera } from '../academia/kit.js';
import { NOM_CONTRATO, fmtHoras, claseSaldo, saldos, sumaHoras, vigente, diasHasta, nombreUsuario } from './util.js';

export async function renderEquipo(view, ctx) {
  clear(view, cargando());
  const hoy = hoyISO();
  const verC = ctx.ve('tr_contrato'); const verH = ctx.ve('tr_horas'); const verD = ctx.ve('ac_portal');
  const [eq, contratos, franjas, movs, docs] = await Promise.all([api.usuarios().catch(() => []), verC ? api.contratos() : [], verC ? api.horario() : [], verH ? api.horas() : [], verD ? api.portalDocs() : []]);
  const personas = eq.filter((u) => u.activo !== false).sort((a, b) => nombreUsuario(a).localeCompare(nombreUsuario(b), 'es'));
  const sal = saldos(movs);
  const roles = new Map((ctx.state.roles || []).map((r) => [r.rol, r.nombre]));
  const vigDe = (u) => vigente(contratos.filter((c) => c.profile_id === u.id), hoy);
  const cols = [
    { t: 'Trabajador', v: (u) => h('strong', {}, nombreUsuario(u)), s: nombreUsuario },
    { t: 'Rol', v: (u) => roles.get(u.rol) || (u.rol === 'admin' ? 'Administrador' : u.rol) },
    ...(verC ? [
      { t: 'Contrato', s: (u) => { const c = vigDe(u); return c ? NOM_CONTRATO[c.tipo] : ''; }, v: (u) => { const c = vigDe(u); return c ? `${NOM_CONTRATO[c.tipo]}${c.categoria ? ' · ' + c.categoria : ''}` : h('span', { class: 'muted' }, 'Sin contrato'); } },
      { t: 'Horas/semana', num: true, s: (u) => Number(vigDe(u)?.horas_semana || 0), v: (u) => { const c = vigDe(u); return c?.horas_semana == null ? '' : fmtHoras(c.horas_semana); } },
      { t: 'Horario', num: true, s: (u) => sumaHoras(franjas.filter((f) => f.profile_id === u.id)), v: (u) => { const n = sumaHoras(franjas.filter((f) => f.profile_id === u.id)); return n ? fmtHoras(n) : ''; } },
      { t: 'Fin de contrato', s: (u) => vigDe(u)?.fecha_fin || '', v: (u) => { const c = vigDe(u); if (!c?.fecha_fin) return ''; const d = diasHasta(c.fecha_fin, hoy); return h('span', { class: d <= 60 ? 'pill warn' : '' }, fmtFecha(c.fecha_fin)); } },
    ] : []),
    ...(verH ? [{ t: 'Bolsa de horas', num: true, s: (u) => sal.get(u.id) || 0, v: (u) => h('strong', { class: claseSaldo(sal.get(u.id) || 0) }, fmtHoras(sal.get(u.id) || 0, true)) }] : []),
    ...(verD ? [{ t: 'Documentos', num: true, s: (u) => docs.filter((d) => d.profile_id === u.id).length, v: (u) => String(docs.filter((d) => d.profile_id === u.id).length) }] : []),
  ];
  clear(view, cabecera('Equipo', `${personas.length} trabajadores. Los datos se editan en cada pestaña (Contrato y horario, Bolsa de horas, Documentos).`), tabla(cols, personas, { vacio: 'No hay trabajadores.' }));
}
