// TRABAJADORES · Mi portal: lo mío de un vistazo (contrato en vigor, horario, bolsa de horas y últimos documentos).
// Solo se enseña cada bloque si el rol tiene el permiso correspondiente; cada bloque enlaza a su pestaña.
import { h, clear, cargando, fmtFecha, hoyISO } from '../ui.js';
import * as api from './api.js';
import { cabecera } from '../academia/kit.js';
import { abrir } from './documentos.js';
import { NOM_CONTRATO, NOM_HORAS, fmtHoras, claseSaldo, sumaHoras, vigente, diasHasta, semana } from './util.js';

const NOM_DOC = { nomina: 'Nómina', contrato: 'Contrato', certificado: 'Certificado', otro: 'Otro' };

export async function renderPortal(view, ctx) {
  clear(view, cargando());
  const yo = ctx.state.perfil;
  const hoy = hoyISO();
  const conContrato = ctx.veAlgo('tr_contrato'); const conHoras = ctx.veAlgo('tr_horas'); const conDocs = ctx.veAlgo('ac_portal');
  const [contratos, franjas, movs, docs] = await Promise.all([
    conContrato ? api.contratos() : [], conContrato ? api.horario() : [], conHoras ? api.horas() : [], conDocs ? api.portalDocs() : []]);
  const mios = (l) => l.filter((x) => x.profile_id === yo.id);
  const enlace = (ruta, texto) => h('a', { class: 'link-btn', href: `#/${ruta}` }, texto);
  const bloques = [];

  if (conContrato) {
    const cs = mios(contratos); const vig = vigente(cs, hoy);
    const fin = vig?.fecha_fin ? diasHasta(vig.fecha_fin, hoy) : null;
    bloques.push(h('div', { class: 'card tr-card' }, h('h3', {}, 'Mi contrato'),
      vig ? h('dl', { class: 'tr-datos' },
        h('dt', {}, 'Contrato'), h('dd', {}, NOM_CONTRATO[vig.tipo] || vig.tipo),
        vig.categoria ? [h('dt', {}, 'Puesto'), h('dd', {}, vig.categoria)] : null,
        h('dt', {}, 'Jornada'), h('dd', {}, `${vig.jornada === 'completa' ? 'Completa' : 'Parcial'}${vig.horas_semana != null ? ` · ${fmtHoras(vig.horas_semana)} a la semana` : ''}`),
        h('dt', {}, 'Desde'), h('dd', {}, fmtFecha(vig.fecha_inicio)),
        h('dt', {}, 'Hasta'), h('dd', {}, vig.fecha_fin ? `${fmtFecha(vig.fecha_fin)}${fin <= 60 ? ` (en ${fin} días)` : ''}` : 'Sin fecha de fin')) : h('div', { class: 'muted' }, 'No hay ningún contrato en vigor registrado.'),
      h('div', { style: 'margin-top:8px' }, enlace('tr_contrato', 'Ver contrato y horario →'))));
    const fr = mios(franjas);
    bloques.push(h('div', { class: 'card tr-card', style: 'grid-column: 1 / -1' }, h('h3', {}, `Mi horario de contrato${fr.length ? ` · ${fmtHoras(sumaHoras(fr))} a la semana` : ''}`),
      fr.length ? semana(fr) : h('div', { class: 'muted' }, 'No hay horario de contrato registrado.')));
  }
  if (conHoras) {
    const m = mios(movs); const saldo = m.reduce((s, x) => s + Number(x.horas), 0);
    bloques.push(h('div', { class: 'card tr-card' }, h('h3', {}, 'Mi bolsa de horas'), h('div', { class: `tr-saldo ${claseSaldo(saldo)}` }, fmtHoras(saldo, true)),
      m.length ? h('ul', { class: 'tr-lista', style: 'margin-top:8px' }, m.slice(0, 3).map((x) => h('li', {}, h('span', {}, `${fmtFecha(x.fecha)} · ${x.concepto || NOM_HORAS[x.tipo]}`), h('strong', { class: claseSaldo(Number(x.horas)) }, fmtHoras(x.horas, true))))) : h('div', { class: 'muted', style: 'margin-top:6px' }, 'Sin movimientos todavía.'),
      h('div', { style: 'margin-top:8px' }, enlace('tr_horas', 'Ver bolsa de horas →'))));
  }
  if (conDocs) {
    const d = mios(docs).slice(0, 5);
    bloques.push(h('div', { class: 'card tr-card' }, h('h3', {}, 'Mis últimos documentos'),
      d.length ? h('ul', { class: 'tr-lista' }, d.map((x) => h('li', {}, h('span', {}, h('strong', {}, x.titulo), h('span', { class: 'muted' }, ` · ${NOM_DOC[x.tipo] || x.tipo}${x.periodo ? ' · ' + x.periodo : ''}`)),
        h('button', { class: 'btn small', type: 'button', onclick: () => abrir(x.ruta) }, 'Abrir')))) : h('div', { class: 'muted' }, 'Todavía no tienes documentos.'),
      h('div', { style: 'margin-top:8px' }, enlace('tr_documentos', 'Ver todos mis documentos →'))));
  }
  clear(view, cabecera('Mi portal', `Hola, ${yo.nombre || yo.email}. Aquí tienes tus cosas: solo las ves tú${ctx.ve('tr_horas') || ctx.ve('tr_contrato') || ctx.ve('ac_portal') ? ' (la gestión del equipo está en la pestaña Equipo)' : ''}.`),
    bloques.length ? h('div', { class: 'tr-grid' }, bloques) : h('div', { class: 'card empty' }, 'Tu rol todavía no tiene nada activo en este módulo.'));
}
