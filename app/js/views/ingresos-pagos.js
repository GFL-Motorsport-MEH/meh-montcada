// Vínculo entre Pagos e Ingresos: por cada mes compara lo que la cuadrícula de Ingresos dice que entró
// con lo que figura como cobrado en Pagos (cuotas de los alumnos), y enseña lo pendiente y lo devuelto.
// Es solo lectura: no cambia ningún dato. Lo ve quien tenga permiso sobre Pagos (ac_pagos).
import { h, clear, ajustarAncho, fmtEUR, num, MESES, MESES_CORTO } from '../ui.js';
import * as api from '../academia/api.js';

const suma = (lista) => lista.reduce((s, c) => s + num(c.importe), 0);

// ingresosMes(): mensualidades de la cuadrícula por mes (array de 12, sin extras ni welcome pack)
// ingresosWP(): welcome pack de la cuadrícula
export async function renderPagosVsIngresos(cont, ctx, curso, ingresosMes, ingresosWP) {
  if (!ctx.ve('ac_pagos')) { clear(cont); return { refrescar() {} }; }
  let cuotas;
  try { cuotas = await api.cuotas(curso.id); } catch { clear(cont); return { refrescar() {} }; }

  const delMes = (m, estado) => cuotas.filter((c) => c.concepto === 'mensualidad' && c.mes === m && c.estado === estado);
  const wp = (estado) => cuotas.filter((c) => c.concepto === 'welcome_pack' && c.estado === estado);
  const cobMes = MESES.map((m) => suma(delMes(m, 'pagado')));
  const pendMes = MESES.map((m) => suma(delMes(m, 'pendiente')));
  const devMes = MESES.map((m) => suma(delMes(m, 'devuelto')));
  const cobWP = suma(wp('pagado')), pendWP = suma(wp('pendiente')), devWP = suma(wp('devuelto'));
  const tot = (a) => a.reduce((x, y) => x + y, 0);

  const tbody = h('tbody');
  const kpis = h('div', { class: 'vinculo-kpis' });

  // celda de importe (vacía si es 0) con una clase opcional
  const td = (v, clase = '') => h('td', { class: `num ${clase}`.trim() }, v ? fmtEUR(v) : '—');
  // diferencia Pagos − Ingresos: verde si cuadra, ámbar si Pagos tiene más (falta pasarlo a Ingresos), rojo si Ingresos tiene más (sin respaldo en Pagos)
  const tdDif = (pagos, ingresos) => {
    if (!pagos && !ingresos) return h('td', { class: 'num dif-vacio' }, '—');
    const d = Math.round((pagos - ingresos) * 100) / 100;
    if (Math.abs(d) < 0.5) return h('td', { class: 'num dif-ok', title: 'Cuadra' }, '✓');
    return h('td', { class: `num ${d > 0 ? 'dif-mas' : 'dif-menos'}`, title: d > 0 ? 'Pagos tiene más cobrado que Ingresos' : 'Ingresos tiene más que lo cobrado en Pagos' }, `${d > 0 ? '+' : '−'}${fmtEUR(Math.abs(d))}`);
  };

  function pintar() {
    const ing = ingresosMes(); const ingWP = ingresosWP();
    const dif = (p, i) => Math.round((p - i) * 100) / 100;
    const totIng = tot(ing) + ingWP, totCob = tot(cobMes) + cobWP;
    const fila = (clase, titulo, sub, celdas) => h('tr', { class: clase }, h('th', { scope: 'row', class: 'sticky-col' }, h('span', { class: 'grupo' }, titulo), h('span', { class: 'line2' }, sub)), celdas);
    clear(tbody,
      fila('v-ing', 'Ingresos', 'según la cuadrícula', [td(ingWP), ing.map((v) => td(v)), td(totIng, 'total-col')]),
      fila('v-cob', 'Cobrado', 'según Pagos', [td(cobWP), cobMes.map((v) => td(v)), td(totCob, 'total-col')]),
      fila('v-dif', 'Diferencia', 'Pagos − Ingresos', [tdDif(cobWP, ingWP), cobMes.map((v, i) => tdDif(v, ing[i])), tdDif(totCob, totIng)]),
      fila('v-pen', 'Pendiente', 'cuotas aún sin cobrar', [td(pendWP, 'avisa'), pendMes.map((v) => td(v, 'avisa')), td(pendWP + tot(pendMes), 'total-col avisa')]),
      tot(devMes) + devWP ? fila('v-dev', 'Devuelto', 'recibos devueltos', [td(devWP, 'malo'), devMes.map((v) => td(v, 'malo')), td(devWP + tot(devMes), 'total-col malo')]) : null);
    const d = dif(totCob, totIng);
    clear(kpis,
      h('span', { class: 'vk vk-ing' }, 'Ingresos ', h('b', {}, fmtEUR(totIng))),
      h('span', { class: 'vk vk-cob' }, 'Cobrado en Pagos ', h('b', {}, fmtEUR(totCob))),
      h('span', { class: `vk ${Math.abs(d) < 0.5 ? 'vk-ok' : d > 0 ? 'vk-mas' : 'vk-menos'}` }, 'Diferencia ', h('b', {}, Math.abs(d) < 0.5 ? 'cuadra' : `${d > 0 ? '+' : '−'}${fmtEUR(Math.abs(d))}`)),
      h('span', { class: 'vk vk-pen' }, 'Pendiente ', h('b', {}, fmtEUR(pendWP + tot(pendMes)))));
  }

  const hayCuotas = cuotas.length > 0;
  const el = h('section', { class: 'card resumen-ing vinculo-pagos', 'aria-label': 'Pagos frente a Ingresos' },
    h('div', { class: 'section-head' },
      h('div', {}, h('h3', {}, 'Pagos frente a Ingresos'),
        h('div', { class: 'count' }, 'Lo cobrado a los alumnos en Pagos frente a lo anotado en la cuadrícula de Ingresos (mensualidades y welcome pack; los extras no están en Pagos).')),
      h('div', { class: 'section-actions' }, h('a', { class: 'btn', href: '#/ac_pagos' }, 'Ver Pagos →'))),
    hayCuotas ? kpis : h('div', { class: 'banner warn' }, 'Todavía no hay cuotas en Pagos para este curso. ', h('a', { href: '#/ac_pagos' }, 'Genera las mensualidades'), ' o ', h('a', { href: '#/ac_pagos_importar' }, 'importa los pagos del CRM'), ' para compararlas con Ingresos.'),
    hayCuotas ? h('div', { class: 'table-wrap' },
      ajustarAncho(h('table', { class: 'data grid-ing grid-mini grid-vinculo' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'sticky-col' }, ''), h('th', { scope: 'col', class: 'num' }, 'Welcome pack'), MESES_CORTO.map((m) => h('th', { scope: 'col', class: 'num' }, m)), h('th', { scope: 'col', class: 'num' }, 'Total'))),
        tbody))) : null);
  if (hayCuotas) pintar();
  clear(cont, el);
  return { refrescar: () => { if (hayCuotas) pintar(); } };
}
