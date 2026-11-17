// Calendario de profesoras y uso de aulas: parrilla semanal por profesora o por aula, con detección de solapes.
import { h, clear, cargando } from '../ui.js';
import * as api from './api.js';
import { cabecera, sel, hhmm, DIAS } from './kit.js';

const aMin = (t) => { const [a, b] = hhmm(t).split(':').map(Number); return a * 60 + b; };
let modo = 'profesora';

export async function renderCalendario(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const [grupos, profes, aulas] = await Promise.all([api.grupos(curso.id), api.profesoras(), api.aulas()]);
  const pPor = new Map(profes.map((p) => [p.id, p])); const aPor = new Map(aulas.map((a) => [a.id, a]));
  const sesiones = grupos.filter((g) => g.activo).flatMap((g) => g.sesiones.map((s) => ({ g, s, prof: s.profesora_id || g.profesora_id, aula: s.aula_id || g.aula_id, ini: aMin(s.hora_inicio), fin: aMin(s.hora_fin) })));
  const cont = h('div', { class: 'ac-cal-cont' });
  const aviso = h('div');
  const selModo = sel([['profesora', 'Por profesora'], ['aula', 'Uso de aulas']], modo, { onchange: (e) => { modo = e.target.value; pintar(); } });

  function solapes(lista) {
    const out = new Set();
    for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) { const a = lista[i], b = lista[j]; if (a.s.dia === b.s.dia && a.ini < b.fin && b.ini < a.fin) { out.add(a); out.add(b); } }
    return out;
  }
  // sesiones que se pisan el mismo día: se colocan una al lado de otra
  function carriles(lista) {
    const info = new Map(); const porDia = {};
    lista.forEach((x) => (porDia[x.s.dia] ||= []).push(x));
    for (const l of Object.values(porDia)) {
      l.sort((a, b) => a.ini - b.ini || a.fin - b.fin);
      let grupo = []; let finMax = -1;
      const cerrar = () => { const fines = []; for (const x of grupo) { let k = fines.findIndex((f) => f <= x.ini); if (k < 0) { k = fines.length; fines.push(0); } fines[k] = x.fin; info.set(x, { lane: k }); } grupo.forEach((x) => { info.get(x).n = fines.length; }); grupo = []; finMax = -1; };
      for (const x of l) { if (grupo.length && x.ini >= finMax) cerrar(); grupo.push(x); finMax = Math.max(finMax, x.fin); }
      if (grupo.length) cerrar();
    }
    return info;
  }
  function rejilla(titulo, lista, color) {
    if (!lista.length) return null;
    const min = Math.floor(Math.min(...lista.map((x) => x.ini)) / 30) * 30; const max = Math.ceil(Math.max(...lista.map((x) => x.fin)) / 30) * 30;
    const filas = (max - min) / 30; const choque = solapes(lista); const car = carriles(lista);
    const g = h('div', { class: 'ac-cal', style: `grid-template-rows: 24px repeat(${filas}, 20px)` }, h('div', { class: 'ac-cal-h' }),
      [1, 2, 3, 4, 5, 6].map((d) => h('div', { class: 'ac-cal-h', style: `grid-column:${d + 1}` }, DIAS[d])));
    for (let r = 0; r < filas; r++) { const m = min + r * 30; g.append(h('div', { class: 'ac-cal-hora', style: `grid-row:${r + 2}` }, m % 60 === 0 ? `${String(m / 60).padStart(2, '0')}:00` : '')); }
    for (const x of lista) g.append(h('div', { class: 'ac-cal-ses' + (choque.has(x) ? ' choque' : ''), style: `grid-column:${x.s.dia + 1}; grid-row:${(x.ini - min) / 30 + 2} / ${(x.fin - min) / 30 + 2}; --c:${color(x)}; justify-self:start; width:calc(${100 / car.get(x).n}% - 2px); margin-left:${(100 / car.get(x).n) * car.get(x).lane}%`, title: `${x.g.nombre} ${hhmm(x.s.hora_inicio)}-${hhmm(x.s.hora_fin)} · ${pPor.get(x.prof)?.nombre || 'sin profesora'} · ${aPor.get(x.aula)?.nombre || 'sin aula'}` },
      h('strong', {}, x.g.nombre), h('span', {}, modo === 'profesora' ? (aPor.get(x.aula)?.nombre || '') : (pPor.get(x.prof)?.nombre || ''))));
    return h('div', { class: 'card ac-cal-card' }, h('h3', { class: 'sub-titulo' }, titulo, choque.size ? h('span', { class: 'pill warn', style: 'margin-left:8px' }, `${choque.size / 2 | 0 || 1} solape(s)`) : null), g);
  }
  function pintar() {
    const tarjetas = [];
    let hayChoque = false;
    if (modo === 'profesora') {
      for (const p of [...profes.filter((x) => x.activa), { id: null, nombre: 'Sin profesora asignada', color: '#8c8a81' }]) {
        const l = sesiones.filter((x) => (x.prof || null) === p.id); const r = rejilla(p.nombre, l, () => p.color); if (r) tarjetas.push(r); if (solapes(l).size) hayChoque = true;
      }
    } else {
      for (const a of [...aulas.filter((x) => x.activa), { id: null, nombre: 'Sin aula asignada' }]) {
        const l = sesiones.filter((x) => (x.aula || null) === a.id); const r = rejilla(a.nombre, l, (x) => pPor.get(x.prof)?.color || '#8c8a81'); if (r) tarjetas.push(r); if (solapes(l).size) hayChoque = true;
      }
    }
    clear(aviso, hayChoque ? h('div', { class: 'banner warn' }, `Hay sesiones solapadas (marcadas en rojo): ${modo === 'profesora' ? 'una profesora con dos clases a la vez' : 'dos grupos en la misma aula a la vez'}.`) : null);
    clear(cont, tarjetas.length ? tarjetas : h('div', { class: 'card empty' }, 'Todavía no hay sesiones con horario. Crea grupos y sus sesiones en «Grupos».'));
  }
  clear(view, cabecera(`Calendario · ${curso.nombre}`, 'Horario semanal de las profesoras y uso de las aulas', selModo), aviso, cont);
  pintar();
}
