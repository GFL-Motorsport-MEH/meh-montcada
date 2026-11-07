// Control > FactCheck: cruza ingresos según control de alumnos (Ingresos), según facturas (Facturación del CRM)
// y según el banco (cobros de la conciliación o valores puestos a mano), por mes o por trimestre.
import { h, clear, cargando, toast, fmtEUR2, num, MESES, capitalizar, descargarCSV } from '../ui.js';
import * as db from '../db.js';
import { registrarSeccion } from './control.js';
import { fechaEnMes } from '../gastos-ops.js';
import { aNumero } from '../facturacion.js';

// método -> [valor en ingresos_metodo, valor en facturación, campo manual del banco]
const METODOS = [
  ['Domiciliaciones', 'DOMICILIACION', 'Domiciliacion bancaria', 'banco_domiciliacion'],
  ['TPV / tarjeta', 'TPV / TARJETA', 'Tarjeta', 'banco_tpv'],
  ['Transferencias', 'TRANSFERENCIA', 'Transferencia', 'banco_transferencia'],
  ['Efectivo', 'EFECTIVO', 'Efectivo', 'banco_efectivo'],
];

async function renderFactcheck(cont, ctx) {
  clear(cont, cargando());
  const { state } = ctx;
  const curso = ctx.cursoActual();
  const [ingresos, metodosIng, manual] = await Promise.all([ctx.ingresos(curso.id), db.getIngresosMetodo(curso.id), db.getFactcheckManual()]);
  if (!state.facturacion) state.facturacion = await db.getFacturacion();
  if (!state.movimientos) state.movimientos = await db.getMovimientos().catch(() => []);
  const ingCentro = ctx.ingresosDelCentro(ingresos);
  const periodos = MESES.map((m) => ({ mes: m, periodo: fechaEnMes(curso, m).slice(0, 7) }));
  const delPeriodo = new Set(periodos.map((p) => p.periodo));
  const valManual = (periodo, campo) => manual.find((x) => x.periodo === periodo && x.campo === campo)?.valor;

  // datos automáticos por mes natural (YYYY-MM)
  function calcular() {
    const d = new Map(periodos.map((p) => [p.periodo, { ing: 0, fact: 0, bancoAuto: 0, m: Object.fromEntries(METODOS.map(([k]) => [k, { ing: 0, fact: 0 }])) }]));
    for (const p of periodos) {
      const x = d.get(p.periodo);
      x.ing = ingCentro.filter((r) => (r.mes || '').toLowerCase() === p.mes && !/welcome/i.test(r.tipo || '')).reduce((s, r) => s + num(r.cantidad), 0);
      for (const [k, im] of METODOS) x.m[k].ing = ctx.ingresosDelCentro(metodosIng).filter((r) => (r.mes || '').toLowerCase() === p.mes && r.metodo === im).reduce((s, r) => s + num(r.importe), 0);
    }
    for (const l of state.facturacion) {
      const per = (l.fecha_pago || '').slice(0, 7);
      if (!delPeriodo.has(per)) continue;
      const x = d.get(per); x.fact += num(l.cantidad);
      const met = METODOS.find((m) => m[2] === l.metodo_pago); if (met) x.m[met[0]].fact += num(l.cantidad);
    }
    for (const mv of state.movimientos) {
      const per = (mv.fecha || '').slice(0, 7);
      if (!delPeriodo.has(per) || num(mv.importe) <= 0 || mv.estado === 'ignorado') continue;
      if (state.centroId && (mv.centro_id || ctx.centroPrincipal()?.id) !== state.centroId) continue;
      d.get(per).bancoAuto += num(mv.importe);
    }
    return d;
  }

  let modo = 'mes';
  const tabla = h('div');
  const nota = h('p', { class: 'muted small' });

  function celdaManual(periodo, campo, auto) {
    const v = valManual(periodo, campo);
    const input = h('input', { type: 'text', class: 'cell', inputmode: 'decimal', placeholder: auto ? fmtEUR2(auto).replace(/\s?€/, '') : '', value: v == null ? '' : String(v).replace('.', ','), 'aria-label': `${campo} ${periodo}` });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    input.addEventListener('blur', async () => {
      const t = input.value.trim();
      const nuevo = t === '' ? null : aNumero(t);
      if (t !== '' && (nuevo === null || Number.isNaN(nuevo))) { input.classList.add('invalid'); toast('Importe no válido', 'error'); return; }
      input.classList.remove('invalid');
      if ((nuevo ?? null) === (v ?? null)) return;
      try {
        const r = await db.guardarFactcheckManual(periodo, campo, nuevo);
        const i = manual.findIndex((x) => x.periodo === periodo && x.campo === campo);
        if (i >= 0) manual[i] = r; else manual.push(r);
        pintar();
      } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
    });
    return h('td', { class: 'cell-td manual' }, input);
  }

  function pintar() {
    const d = calcular();
    // filas: por mes (editable) o por trimestre (sumas)
    let filas;
    const bancoTotal = (per, x) => valManual(per, 'banco_total') ?? x.bancoAuto;
    if (modo === 'mes') {
      filas = periodos.map((p) => ({ label: `${capitalizar(p.mes)} ${p.periodo.slice(0, 4)}`, pers: [p.periodo] }));
    } else {
      const grupos = new Map();
      for (const p of periodos) {
        const t = `${Math.ceil(Number(p.periodo.slice(5)) / 3)}T ${p.periodo.slice(0, 4)}`;
        if (!grupos.has(t)) grupos.set(t, []);
        grupos.get(t).push(p.periodo);
      }
      filas = [...grupos.entries()].map(([t, pers]) => ({ label: t, pers }));
    }
    const sumar = (pers, fn) => pers.reduce((s, per) => s + num(fn(per, d.get(per))), 0);
    // diferencia a − b; si falta uno de los dos datos (0) no se compara
    const dif = (a, b) => (Math.abs(a) < 0.005 || Math.abs(b) < 0.005 ? h('td', { class: 'num muted' }, '—')
      : h('td', { class: `num dif ${Math.abs(a - b) >= 0.01 ? 'neg' : 'okdif'}` }, Math.abs(a - b) < 0.005 ? '✓' : fmtEUR2(a - b)));
    const eurTd = (v, cls = '') => h('td', { class: `num ${cls}` }, Math.abs(v) < 0.005 ? '—' : fmtEUR2(v));
    const cuerpo = filas.map((f) => {
      const ing = sumar(f.pers, (p, x) => x.ing), fact = sumar(f.pers, (p, x) => x.fact), banco = sumar(f.pers, (p, x) => bancoTotal(p, x));
      const editable = modo === 'mes';
      const per = f.pers[0];
      return h('tr', {}, h('th', { scope: 'row', class: 'sticky-col' }, f.label),
        eurTd(ing), eurTd(fact),
        editable ? celdaManual(per, 'banco_total', d.get(per).bancoAuto) : eurTd(banco),
        dif(fact, ing), dif(banco, fact),
        METODOS.flatMap(([k, , , campo]) => [eurTd(sumar(f.pers, (p, x) => x.m[k].ing), 'grupo-ini'), eurTd(sumar(f.pers, (p, x) => x.m[k].fact)),
          editable ? celdaManual(per, campo) : eurTd(sumar(f.pers, (p) => valManual(p, campo)))]));
    });
    const tot = (fn) => periodos.reduce((s, p) => s + num(fn(p.periodo, d.get(p.periodo))), 0);
    const tIng = tot((p, x) => x.ing), tFact = tot((p, x) => x.fact), tBanco = tot((p, x) => bancoTotal(p, x));
    clear(tabla, h('div', { class: 'table-wrap' }, h('table', { class: 'data balance tabla-factcheck' },
      h('thead', {},
        h('tr', {}, h('th', { class: 'sticky-col', rowspan: 2 }, modo === 'mes' ? 'Mes' : 'Trimestre'), h('th', { colspan: 5, class: 'grupo' }, 'Ingresos totales'),
          METODOS.map(([k]) => h('th', { colspan: 3, class: 'grupo grupo-ini' }, k))),
        h('tr', {}, ['Control alumnos', 'Facturación', 'Banco', 'Fact. − alumnos', 'Banco − fact.'].map((t) => h('th', { class: 'num' }, t)),
          METODOS.flatMap(() => [h('th', { class: 'num grupo-ini' }, 'Alumnos'), h('th', { class: 'num' }, 'Facturación'), h('th', { class: 'num' }, 'Banco')]))),
      h('tbody', {}, cuerpo),
      h('tfoot', {}, h('tr', { class: 'total' }, h('th', { scope: 'row', class: 'sticky-col' }, 'Total curso'), eurTd(tIng), eurTd(tFact), eurTd(tBanco), dif(tFact, tIng), dif(tBanco, tFact),
        METODOS.flatMap(([k, , , campo]) => [eurTd(tot((p, x) => x.m[k].ing), 'grupo-ini'), eurTd(tot((p, x) => x.m[k].fact)), eurTd(tot((p) => valManual(p, campo)))]))))));
    nota.textContent = 'Control alumnos = cuadrícula de Ingresos (sin Welcome pack) y cobros por modalidad. Facturación = líneas del CRM por fecha de pago (columna Cantidad). '
      + 'Banco = cobros importados en Conciliación bancaria; en vista mensual puedes escribir el importe a mano (sustituye al automático, que se ve en gris) y el desglose por método.';
    return { tIng, tFact, tBanco };
  }

  const seg = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Agrupar FactCheck' });
  const pintarSeg = () => clear(seg, [['mes', 'Por mes'], ['trimestre', 'Por trimestre']].map(([id, t]) => h('button', { class: 'seg-btn', role: 'tab', 'aria-selected': String(modo === id), onclick: () => { modo = id; pintarSeg(); pintar(); } }, t)));
  pintarSeg();
  function exportar() {
    const filas = [...tabla.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => (c.querySelector('input') ? c.querySelector('input').value : c.textContent)));
    descargarCSV(`factcheck_${curso.nombre}.csv`, filas);
  }
  clear(cont,
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, `FactCheck · ${curso.nombre}`), h('div', { class: 'count' }, 'Comprueba que cuadran ingresos, facturación y banco.')),
      h('div', { class: 'section-actions' }, seg, h('button', { class: 'btn', onclick: exportar }, 'Exportar CSV'))),
    tabla, nota);
  pintar();
}

registrarSeccion('factcheck', renderFactcheck);
