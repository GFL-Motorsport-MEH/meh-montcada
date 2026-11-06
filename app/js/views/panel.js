import { h, clear, fmtEUR, fmtEUR2, fmtPct, num, MESES, MESES_CORTO, capitalizar, tituloCategoria, mesDeFecha, cargando } from '../ui.js';
import { barrasAgrupadas, barrasClasificadas, esEstrecho } from '../charts.js';

const EXCLUIDAS = ['INVERSION', 'WELCOME PACK']; // igual que los gráficos del Excel
const LS_KEY = 'meh.panel.excluir';

function leerPref() { try { return localStorage.getItem(LS_KEY) !== '0'; } catch { return true; } }
function guardarPref(v) { try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch { /* sin almacenamiento */ } }

export function calcularResumen(gastos, ingresos, taxonomia) {
  const catPorId = new Map(taxonomia.map((c) => [c.id, c]));
  const res = {
    ingresos: 0, ingresosWP: 0, ingresosSinMes: 0, gastos: 0, gastosOperativos: 0,
    ingresosMes: Array(12).fill(0), gastosMes: Array(12).fill(0), gastosMesOperativos: Array(12).fill(0),
    porCategoria: new Map(),
  };
  for (const r of ingresos) {
    const v = num(r.cantidad);
    res.ingresos += v;
    if (/welcome/i.test(r.tipo || '')) res.ingresosWP += v;
    const i = MESES.indexOf((r.mes || '').trim().toLowerCase());
    if (i >= 0) res.ingresosMes[i] += v; else res.ingresosSinMes += v;
  }
  for (const g of gastos) {
    const v = num(g.cantidad);
    const cat = catPorId.get(g.categoria_id);
    const nombre = cat ? cat.nombre : 'SIN CATEGORÍA';
    const operativo = !EXCLUIDAS.includes(nombre);
    res.gastos += v;
    if (operativo) res.gastosOperativos += v;
    res.porCategoria.set(nombre, (res.porCategoria.get(nombre) || 0) + v);
    const i = MESES.indexOf(g.mes || mesDeFecha(g.fecha_pago || g.fecha_factura));
    if (i >= 0) {
      res.gastosMes[i] += v;
      if (operativo) res.gastosMesOperativos[i] += v;
    }
  }
  return res;
}

export async function renderPanel(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const [g0, i0] = await Promise.all([ctx.gastos(curso.id), ctx.ingresos(curso.id)]);
  const gastos = ctx.filtrarCentro(g0), ingresos = ctx.ingresosDelCentro(i0);
  const r = calcularResumen(gastos, ingresos, ctx.state.taxonomia);
  const balance = r.ingresos - r.gastos;

  const kpi = (label, value, sub, cls = '') => h('div', { class: 'card kpi' },
    h('div', { class: 'label' }, label), h('div', { class: 'value ' + cls }, value), h('div', { class: 'sub' }, sub));

  if (!gastos.length && !ingresos.length) {
    clear(view, h('div', { class: 'card empty' }, `El curso ${curso.nombre} todavía no tiene gastos ni ingresos.`));
    return;
  }

  const cats = [...r.porCategoria.entries()].map(([nombre, valor]) => ({ nombre: tituloCategoria(nombre), valor }))
    .filter((c) => c.valor !== 0).sort((a, b) => b.valor - a.valor);
  let excluir = leerPref();
  const chartHolder = h('div');
  const subMensual = h('div', { class: 'chart-sub' });
  const toggle = h('input', { type: 'checkbox', checked: excluir, onchange: () => { excluir = toggle.checked; guardarPref(excluir); pintarMensual(); } });

  function pintarMensual() {
    const gas = excluir ? r.gastosMesOperativos : r.gastosMes;
    subMensual.textContent = (excluir ? 'Gastos sin Inversión ni Welcome Pack' : 'Todos los gastos')
      + (r.ingresosSinMes > 0 ? ` · ${fmtEUR(r.ingresosSinMes)} de ingresos sin mes asignado (Welcome Pack) no salen aquí` : '');
    clear(chartHolder, barrasAgrupadas(MESES_CORTO, [
      { nombre: 'Ingresos', clase: 'bar-ing', valores: r.ingresosMes },
      { nombre: 'Gastos', clase: 'bar-gas', valores: gas },
    ], { etiquetasLargas: MESES.map(capitalizar), ariaLabel: `Ingresos y gastos por mes, curso ${curso.nombre}`, ancho: esEstrecho() ? 360 : 640 }));
  }
  pintarMensual();
  const catHolder = h('div');
  const pintarCategorias = () => clear(catHolder, barrasClasificadas(cats, { ariaLabel: `Gastos por categoría, curso ${curso.nombre}`, ancho: esEstrecho() ? 340 : 420 }));
  const mq = window.matchMedia('(max-width: 560px)');
  const alCambiar = () => { if (!view.isConnected && !chartHolder.isConnected) { mq.removeEventListener('change', alCambiar); return; } pintarMensual(); pintarCategorias(); };
  mq.addEventListener('change', alCambiar);

  clear(view,
    h('div', { class: 'kpi-row' },
      kpi('Ingresos', fmtEUR(r.ingresos), r.ingresosWP ? `incluye ${fmtEUR(r.ingresosWP)} de Welcome Pack` : `curso ${curso.nombre}`),
      kpi('Gastos', fmtEUR(r.gastos), `sin Inversión ni Welcome Pack: ${fmtEUR(r.gastosOperativos)}`),
      kpi('Balance', fmtEUR(balance), r.ingresos ? `margen ${fmtPct(balance / r.ingresos)} sobre ingresos` : 'ingresos − gastos', balance >= 0 ? 'good' : 'critical')),
    h('div', { class: 'chart-row' },
      h('div', { class: 'card chart-card' },
        h('div', { class: 'chart-head' },
          h('div', {}, h('h3', {}, 'Ingresos y gastos por mes'), subMensual),
          h('label', { class: 'check small' }, toggle, 'Sin Inversión ni WP')),
        h('div', { class: 'legend' },
          h('span', { class: 'legend-item' }, h('span', { class: 'legend-swatch', style: 'background:var(--accent-ing)' }), 'Ingresos'),
          h('span', { class: 'legend-item' }, h('span', { class: 'legend-swatch', style: 'background:var(--accent-gas)' }), 'Gastos')),
        chartHolder),
      h('div', { class: 'card chart-card' },
        h('h3', {}, 'Gastos por categoría'),
        h('div', { class: 'chart-sub' }, `Total del curso, de mayor a menor · ${fmtEUR2(r.gastos)}`),
        catHolder)));
  pintarCategorias();
}
