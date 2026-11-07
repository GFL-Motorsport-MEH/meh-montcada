// Pestaña Balance: balance del curso, por subcategorías, comparar cursos e informes.
import { h, clear, fmtEUR, fmtEUR2, fmtPct, num, MESES, MESES_CORTO, capitalizar, tituloCategoria, cargando, descargarCSV } from '../ui.js';
import { calcularBalance, calcularSubcategorias, calcularInforme, calcularAnual, DIMENSIONES, GRUPOS_ING } from '../balance.js';
import { barrasAgrupadas, barrasClasificadas, barrasConSigno, esEstrecho } from '../charts.js';

const MODOS = [['curso', 'Balance del curso'], ['graficos', 'Gráficos'], ['subcat', 'Por subcategorías'], ['anual', 'Comparar cursos'], ['informe', 'Informes']];
const LS = 'meh.balance';
const pref = (k, def) => { try { return JSON.parse(localStorage.getItem(LS) || '{}')[k] ?? def; } catch { return def; } };
const guardarPref = (k, v) => { try { const o = JSON.parse(localStorage.getItem(LS) || '{}'); o[k] = v; localStorage.setItem(LS, JSON.stringify(o)); } catch { /* sin almacenamiento */ } };
const suma = (a) => a.reduce((s, v) => s + v, 0);
const eur = (v) => (Math.abs(v) < 0.005 ? '—' : fmtEUR2(v));
const signo = (v) => (v < -0.005 ? 'neg' : '');

// Tabla de números: filas = { label, valores[], total?, clase?, pct? }
function tabla({ cab, filas, claseTabla = '' }) {
  return h('div', { class: 'table-wrap' }, h('table', { class: `data balance ${claseTabla}` },
    h('thead', {}, h('tr', {}, cab.map((c, i) => h('th', { scope: 'col', class: i ? 'num' : 'sticky-col' }, c)))),
    h('tbody', {}, filas.map((f) => f.titulo
      ? h('tr', { class: 'titulo' }, h('th', { scope: 'rowgroup', colspan: cab.length, class: 'sticky-col' }, f.titulo))
      : h('tr', { class: f.clase || '' },
        h('th', { scope: 'row', class: 'sticky-col' }, f.label),
        f.valores.map((v) => h('td', { class: `num ${typeof v === 'number' ? signo(v) : ''}` }, typeof v === 'number' ? eur(v) : v)))))));
}

function csvDe(nombre, cab, filas) {
  const n2 = (v) => (typeof v === 'number' ? v.toFixed(2).replace('.', ',') : v ?? '');
  descargarCSV(nombre, [cab, ...filas.filter((f) => !f.titulo).map((f) => [f.label, ...f.valores.map(n2)])]);
}

function vistaCurso(curso, gastos, ingresos, taxonomia, isPct) {
  const b = calcularBalance(gastos, ingresos, taxonomia, isPct);
  const fila = (label, meses, anual, clase) => ({ label, valores: [...meses, anual ?? suma(meses)], clase });
  const filas = [
    { titulo: 'Ingresos (sin Welcome Pack)' },
    ...[...b.ingGrupo.entries()].filter(([g, a]) => GRUPOS_ING.includes(g) || suma(a)).map(([g, a]) => fila(g, a)),
    fila('Total ingresos', b.totIng, null, 'total'),
    { titulo: 'Gastos (sin Inversión, Welcome Pack ni Impuesto de Sociedades)' },
    ...[...b.gasCat.entries()].map(([c, a]) => fila(tituloCategoria(c), a)),
    fila('Total gastos', b.totGas, null, 'total'),
    { titulo: 'Welcome Pack' },
    { label: 'Ingresos WP (por grupo)', valores: [...MESES.map(() => ''), b.wpIngTotal] },
    fila('Gastos WP', b.wpGas),
    { label: 'Margen WP', valores: [...MESES.map(() => ''), b.margenWP], clase: 'sub' },
    { titulo: 'Resultado' },
    fila('Balance operativo', b.operativo, b.anual.operativo, 'total'),
    fila(`After tax estimado (IS ${fmtPct(isPct)})`, b.estimado, b.anual.estimado, 'sub'),
    fila('Impuesto de Sociedades pagado', b.is),
    fila('After tax real', b.real, b.anual.real, 'total'),
    fila('Inversión', b.inv),
    fila('Balance final', b.final, b.anual.final, 'final'),
  ];
  const cab = ['', ...MESES_CORTO, 'Anual'];
  const wpDetalle = [...b.wpGrupo.entries()].filter(([, v]) => v).map(([g, v]) => `${g} ${fmtEUR(v)}`).join(' · ');
  return {
    kpis: [['Ingresos', b.anual.ingresos + b.wpIngTotal], ['Gastos', b.anual.gastos + b.anual.wpGastos + b.anual.is + b.anual.inversion], ['Balance operativo', b.anual.operativo], ['Balance final', b.anual.final]],
    nota: `El operativo anual incluye el margen del Welcome Pack (${fmtEUR2(b.margenWP)}). Welcome Pack por grupo: ${wpDetalle || '—'}.`
      + (b.ingSinMes || b.gasSinMes ? ` Sin mes asignado: ingresos ${fmtEUR2(b.ingSinMes)}, gastos ${fmtEUR2(b.gasSinMes)}.` : ''),
    el: tabla({ cab, filas, claseTabla: 'balance-curso' }),
    csv: () => csvDe(`balance_${curso.nombre}.csv`, ['Concepto', ...MESES.map(capitalizar), 'Anual'], filas),
  };
}

// Gráficos del balance (misma estructura que la hoja: operativo sin Inversión/WP/IS, luego IS e Inversión)
async function vistaGraficos(ctx, curso, gastos, ingresos, isPct) {
  const b = calcularBalance(gastos, ingresos, ctx.state.taxonomia, isPct);
  const w = esEstrecho() ? 360 : 560, w2 = esEstrecho() ? 340 : 520;
  const tarjeta = (titulo, sub, grafico, leyenda) => h('div', { class: 'card chart-card' }, h('h3', {}, titulo), sub ? h('div', { class: 'chart-sub' }, sub) : null, leyenda || null, grafico);
  const leyenda = (items) => h('div', { class: 'legend' }, items.map(([t, color]) => h('span', { class: 'legend-item' }, h('span', { class: 'legend-swatch', style: `background:${color}` }), t)));
  const largas = MESES.map(capitalizar);
  const ingGrupo = [...b.ingGrupo.entries()].map(([g, a]) => ({ nombre: g, valor: suma(a) })).filter((x) => x.valor > 0);
  if (b.wpIngTotal) ingGrupo.push({ nombre: 'Welcome Pack', valor: b.wpIngTotal });
  ingGrupo.sort((x, y) => y.valor - x.valor);
  const gasCat = [...b.gasCat.entries()].map(([c, a]) => ({ nombre: tituloCategoria(c), valor: suma(a) }));
  if (b.anual.wpGastos) gasCat.push({ nombre: 'Welcome Pack', valor: b.anual.wpGastos });
  if (b.anual.inversion) gasCat.push({ nombre: 'Inversión', valor: b.anual.inversion });
  if (b.anual.is) gasCat.push({ nombre: 'Imp. Sociedades', valor: b.anual.is });
  gasCat.sort((x, y) => y.valor - x.valor);
  // comparación entre cursos
  const datos = [];
  for (const c of ctx.state.cursosVisibles) {
    const [g0, i0] = await Promise.all([ctx.gastos(c.id), ctx.ingresos(c.id)]);
    const g = ctx.filtrarCentro(g0), i = ctx.ingresosDelCentro(i0);
    if (g.length || i.length) datos.push({ curso: c, a: calcularAnual(g, i, ctx.state.taxonomia) });
  }
  const el = h('div', { class: 'graficos-balance' },
    h('div', { class: 'chart-row' },
      tarjeta('Ingresos y gastos por mes', 'Sin Welcome Pack, Inversión ni Impuesto de Sociedades (como el balance operativo)',
        barrasAgrupadas(MESES_CORTO, [{ nombre: 'Ingresos', clase: 'bar-ing', valores: b.totIng }, { nombre: 'Gastos', clase: 'bar-gas', valores: b.totGas }], { etiquetasLargas: largas, ariaLabel: `Ingresos y gastos por mes ${curso.nombre}`, ancho: w }),
        leyenda([['Ingresos', 'var(--accent-ing)'], ['Gastos', 'var(--accent-gas)']])),
      tarjeta('Balance final por mes', `Después de Impuesto de Sociedades e Inversión · la línea es el acumulado (${fmtEUR2(b.anual.final)} en el curso)`,
        barrasConSigno(MESES_CORTO, b.final, { etiquetasLargas: largas, nombre: 'Balance final', acumulado: true, ariaLabel: `Balance final por mes ${curso.nombre}`, ancho: w }))),
    h('div', { class: 'chart-row' },
      tarjeta('Ingresos por grupo', `Total del curso · ${fmtEUR2(b.anual.ingresos + b.wpIngTotal)}`, barrasClasificadas(ingGrupo, { ariaLabel: `Ingresos por grupo ${curso.nombre}`, ancho: w2 })),
      tarjeta('Gastos por categoría', `Total del curso · ${fmtEUR2(gasCat.reduce((s0, x) => s0 + x.valor, 0))}`, barrasClasificadas(gasCat, { ariaLabel: `Gastos por categoría ${curso.nombre}`, ancho: w2 }))),
    datos.length > 1 ? h('div', { class: 'chart-row' },
      tarjeta('Ingresos y gastos por curso', 'Totales anuales (gastos sin Inversión ni Impuesto de Sociedades)',
        barrasAgrupadas(datos.map((d) => d.curso.nombre), [{ nombre: 'Ingresos', clase: 'bar-ing', valores: datos.map((d) => d.a.totIng) }, { nombre: 'Gastos', clase: 'bar-gas', valores: datos.map((d) => d.a.totGas) }], { ariaLabel: 'Ingresos y gastos por curso', ancho: w }),
        leyenda([['Ingresos', 'var(--accent-ing)'], ['Gastos', 'var(--accent-gas)']])),
      tarjeta('Balance final por curso', null, barrasConSigno(datos.map((d) => d.curso.nombre), datos.map((d) => d.a.final), { nombre: 'Balance final', ariaLabel: 'Balance final por curso', ancho: w }))) : null);
  return { kpis: null, nota: 'Mismos cálculos que el balance del curso. Pasa el ratón (o toca) una barra para ver el importe.', el, csv: null, sinTarjeta: true };
}

function vistaSubcat(curso, gastos, taxonomia) {
  const cats = calcularSubcategorias(gastos, taxonomia);
  const total = suma(cats.map((c) => suma(c.meses)));
  const filas = [];
  for (const c of cats) {
    const tc = suma(c.meses);
    filas.push({ label: tituloCategoria(c.nombre), valores: [...c.meses, tc, total ? fmtPct(tc / total) : '—'], clase: 'total' });
    for (const s of c.subs) {
      const ts = suma(s.meses);
      filas.push({ label: s.nombre, valores: [...s.meses, ts, tc ? fmtPct(ts / tc) : '—'], clase: 'sub-indent' + (ts ? '' : ' vacia') });
    }
  }
  filas.push({ label: 'Total gastos', valores: [...MESES.map((_, i) => suma(cats.map((c) => c.meses[i]))), total, ''], clase: 'final' });
  const cab = ['', ...MESES_CORTO, 'Total', '%'];
  return {
    kpis: null,
    nota: 'Todos los gastos del curso (incluida Inversión y Welcome Pack). El % de cada categoría es sobre el total; el de cada subcategoría, sobre su categoría.',
    el: tabla({ cab, filas, claseTabla: 'balance-subcat' }),
    csv: () => csvDe(`balance_subcategorias_${curso.nombre}.csv`, ['Concepto', ...MESES.map(capitalizar), 'Total', '%'], filas),
  };
}

async function vistaAnual(ctx) {
  const cursos = ctx.state.cursosVisibles;
  const datos = [];
  for (const c of cursos) {
    const [g0, i0] = await Promise.all([ctx.gastos(c.id), ctx.ingresos(c.id)]);
    const g = ctx.filtrarCentro(g0), i = ctx.ingresosDelCentro(i0);
    if (g.length || i.length) datos.push({ curso: c, a: calcularAnual(g, i, ctx.state.taxonomia) });
  }
  const gruposIng = [...new Set(datos.flatMap((d) => [...d.a.ing.keys()]))];
  const catsGas = [...new Set(datos.flatMap((d) => [...d.a.gas.keys()]))];
  const col = (fn) => datos.map((d) => fn(d.a));
  const filas = [
    { titulo: 'Ingresos' },
    ...gruposIng.map((g) => ({ label: g, valores: col((a) => a.ing.get(g) || 0) })),
    { label: 'Total ingresos', valores: col((a) => a.totIng), clase: 'total' },
    { titulo: 'Gastos (sin Inversión ni Impuesto de Sociedades)' },
    ...catsGas.map((c) => ({ label: tituloCategoria(c), valores: col((a) => a.gas.get(c) || 0) })),
    { label: 'Total gastos', valores: col((a) => a.totGas), clase: 'total' },
    { titulo: 'Resultado' },
    { label: 'Balance operativo', valores: col((a) => a.operativo), clase: 'total' },
    { label: 'Impuesto de Sociedades', valores: col((a) => a.is) },
    { label: 'After tax real', valores: col((a) => a.real), clase: 'total' },
    { label: 'Inversión', valores: col((a) => a.inversion) },
    { label: 'Balance final', valores: col((a) => a.final), clase: 'final' },
  ];
  const cab = ['', ...datos.map((d) => d.curso.nombre)];
  return {
    kpis: null, nota: 'Totales anuales de cada curso (hoja Balance Anual).',
    el: tabla({ cab, filas, claseTabla: 'balance-anual' }),
    csv: () => csvDe('balance_anual.csv', ['Concepto', ...datos.map((d) => d.curso.nombre)], filas),
  };
}

function vistaInforme(curso, gastos, taxonomia, dim, excluir) {
  const filasInf = calcularInforme(gastos, taxonomia, dim, { excluirInvWP: excluir });
  const total = suma(filasInf.map((f) => f.total));
  const filas = filasInf.map((f) => ({ label: dim === 'categoria' ? tituloCategoria(f.nombre) : f.nombre, valores: [...f.meses, f.total, total ? fmtPct(f.total / total) : ''] }));
  filas.push({ label: 'Total', valores: [...MESES.map((_, i) => suma(filasInf.map((f) => f.meses[i]))), total, ''], clase: 'final' });
  const cab = [DIMENSIONES[dim].label, ...MESES_CORTO, 'Total', '%'];
  return {
    kpis: null, nota: `${filasInf.length} filas · gastos ${excluir ? 'sin Inversión ni Welcome Pack' : 'de todas las categorías'}, ordenados de mayor a menor.`,
    el: tabla({ cab, filas, claseTabla: 'balance-informe' }),
    csv: () => csvDe(`informe_${dim}_${curso.nombre}.csv`, [DIMENSIONES[dim].label, ...MESES.map(capitalizar), 'Total', '%'], filas),
  };
}

export async function renderBalance(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const [g0, i0] = await Promise.all([ctx.gastos(curso.id), ctx.ingresos(curso.id)]);
  const gastos = ctx.filtrarCentro(g0), ingresos = ctx.ingresosDelCentro(i0);
  let modo = pref('modo', 'curso');
  let isPct = pref('is', 0.25);
  let dim = pref('dim', 'categoria');
  let excluir = pref('excluir', true);
  const cuerpo = h('div', { class: 'balance-cuerpo' });
  const controles = h('div', { class: 'balance-controles' });
  let actual = null;

  const seg = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Tipo de balance' });
  function pintarSeg() {
    clear(seg, MODOS.map(([id, label]) => h('button', { class: 'seg-btn', role: 'tab', 'aria-selected': String(id === modo), onclick: () => { modo = id; guardarPref('modo', id); pintar(); } }, label)));
  }

  async function pintar() {
    pintarSeg();
    clear(cuerpo, cargando());
    const ctrls = [];
    if (modo === 'curso') {
      const inp = h('input', { type: 'number', min: 0, max: 100, step: 1, value: Math.round(isPct * 100), class: 'input-corto', 'aria-label': 'Impuesto de Sociedades (%)' });
      inp.addEventListener('change', () => { const v = Number(inp.value); if (v >= 0 && v <= 100) { isPct = v / 100; guardarPref('is', isPct); pintar(); } });
      ctrls.push(h('label', { class: 'check small' }, 'IS estimado', inp, '%'));
      actual = vistaCurso(curso, gastos, ingresos, ctx.state.taxonomia, isPct);
    } else if (modo === 'graficos') {
      actual = await vistaGraficos(ctx, curso, gastos, ingresos, isPct);
    } else if (modo === 'subcat') {
      actual = vistaSubcat(curso, gastos, ctx.state.taxonomia);
    } else if (modo === 'anual') {
      actual = await vistaAnual(ctx);
    } else {
      const sel = h('select', { 'aria-label': 'Agrupar por', class: 'select-inline', onchange: () => { dim = sel.value; guardarPref('dim', dim); pintar(); } },
        Object.entries(DIMENSIONES).map(([k, d]) => h('option', { value: k, selected: k === dim }, d.label)));
      const chk = h('input', { type: 'checkbox', checked: excluir, onchange: () => { excluir = chk.checked; guardarPref('excluir', excluir); pintar(); } });
      ctrls.push(h('label', { class: 'check small' }, 'Agrupar por', sel), h('label', { class: 'check small' }, chk, 'Sin Inversión ni WP'));
      actual = vistaInforme(curso, gastos, ctx.state.taxonomia, dim, excluir);
    }
    clear(controles, ctrls,
      actual.csv ? h('button', { class: 'btn', onclick: () => actual.csv() }, 'Exportar CSV') : null,
      h('button', { class: 'btn', onclick: () => window.print() }, 'Imprimir / PDF'));
    const centro = ctx.centroActual();
    const titulo = (modo === 'anual' ? 'Balance anual · todos los cursos' : `${MODOS.find((m) => m[0] === modo)[1]} · ${curso.nombre}`) + (centro ? ` · ${ctx.tituloCentro(centro.nombre)}` : '');
    clear(cuerpo,
      actual.kpis ? h('div', { class: 'kpi-row kpi-4' }, actual.kpis.map(([l, v]) => h('div', { class: 'card kpi' }, h('div', { class: 'label' }, l), h('div', { class: 'value ' + (v < 0 ? 'critical' : '') }, fmtEUR(v))))) : null,
      h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, titulo), h('div', { class: 'count' }, actual.nota))),
      actual.sinTarjeta ? actual.el : h('div', { class: 'card card-tabla' }, actual.el));
  }

  clear(view, h('div', { class: 'section-head no-print' }, seg, controles), cuerpo);
  await pintar();
}
