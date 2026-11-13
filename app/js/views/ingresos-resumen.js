// Resumen de las hojas "20xx.xx Ing" que no sale de la cuadricula de ingresos:
//  - cobros por modalidad de pago y mes (domiciliacion, transferencia, TPV, efectivo, varios)
//  - numero de alumnos por grupo y mes
// Las dos tablas son editables (se guarda al salir de la celda), igual que la cuadricula.
import { h, clear, ajustarAncho, fmtEUR, fmtPct, num, MESES, MESES_CORTO, capitalizar, toast, descargarCSV } from '../ui.js';
import * as db from '../db.js';

export const METODOS = ['DOMICILIACION', 'TRANSFERENCIA', 'TPV / TARJETA', 'EFECTIVO', 'VARIOS'];
const METODO_LABEL = { DOMICILIACION: 'Domiciliación', TRANSFERENCIA: 'Transferencia', 'TPV / TARJETA': 'TPV / tarjeta', EFECTIVO: 'Efectivo', VARIOS: 'Varios' };
export const GRUPOS_ALUMNOS = ['Babies', 'Kids', 'Teens', 'Adultos', '1 to 1', 'Empresas'];

const fmt2 = (v) => (v ? new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(v) : '');
const fmtInt = (v) => (v ? String(v) : '');

// "1.234,50" | "1234,5" -> 1234.5 ; "" -> 0 ; invalido -> NaN. Con entero=true solo admite enteros >= 0.
export function leerValor(txt, entero = false) {
  let s = String(txt ?? '').trim().replace(/\s|€/g, '');
  if (s === '') return 0;
  if (entero) return /^\d+$/.test(s) ? Number(s) : NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? Math.round(Number(s) * 100) / 100 : NaN;
}

// Tabla editable fila x mes. registros: array de la BD (se modifica al guardar).
function tablaEditable({ titulo, sub, clase, filas, campoFila, campoValor, entero, registros, crear, actualizar, curso, extras }) {
  const tbody = h('tbody');
  const tfoot = h('tfoot');
  const buscar = (fila, mes) => registros.find((r) => r[campoFila] === fila && r.mes === capitalizar(mes));
  const fmt = entero ? fmtInt : fmt2;

  function pie() {
    const porMes = MESES.map((m) => filas.reduce((s, f) => s + num(buscar(f, m)?.[campoValor]), 0));
    const anual = porMes.reduce((a, b) => a + b, 0);
    const filasPie = [h('tr', {}, h('th', { scope: 'row', class: 'sticky-col' }, 'Total'),
      porMes.map((v) => h('td', { class: 'num' }, v ? (entero ? String(v) : fmtEUR(v)) : '—')),
      h('td', { class: 'num total-col' }, entero ? (anual ? `media ${Math.round(anual / Math.max(1, porMes.filter(Boolean).length))}` : '—') : fmtEUR(anual)))];
    if (extras) filasPie.push(...extras(porMes));
    clear(tfoot, filasPie);
    for (const f of filas) {
      const t = MESES.reduce((s, m) => s + num(buscar(f, m)?.[campoValor]), 0);
      const td = tbody.querySelector(`td[data-total="${CSS.escape(f)}"]`);
      if (!td) continue;
      if (entero) td.textContent = t ? `media ${Math.round(t / Math.max(1, MESES.filter((m) => num(buscar(f, m)?.[campoValor])).length))}` : '—';
      else clear(td, fmtEUR(t), anual ? h('span', { class: 'line2' }, fmtPct(t / anual)) : null); // el % debajo, para que quepa
    }
  }

  async function guardar(fila, mes, input) {
    const valor = leerValor(input.value, entero);
    const actual = buscar(fila, mes);
    if (Number.isNaN(valor)) {
      input.classList.add('invalid');
      toast(entero ? 'Escribe un número entero de alumnos' : 'Importe no válido: usa por ejemplo 1234,50', 'error');
      return;
    }
    input.classList.remove('invalid');
    if (num(actual?.[campoValor]) === valor) { input.value = fmt(valor); return; }
    if (!actual && valor === 0) { input.value = ''; return; }
    input.classList.add('saving');
    try {
      if (actual) Object.assign(actual, await actualizar(actual.id, { [campoValor]: valor }));
      else registros.push(await crear({ curso_id: curso.id, mes: capitalizar(mes), [campoFila]: fila, [campoValor]: valor }));
      input.value = fmt(valor);
      input.classList.add('saved'); setTimeout(() => input.classList.remove('saved'), 900);
      pie();
    } catch (ex) {
      input.classList.add('invalid'); toast('No se ha guardado: ' + ex.message, 'error');
    } finally { input.classList.remove('saving'); }
  }

  function celda(fila, mes, etiqueta) {
    const leer = () => num(buscar(fila, mes)?.[campoValor]);
    const input = h('input', { class: 'cell', type: 'text', inputmode: entero ? 'numeric' : 'decimal', 'aria-label': `${etiqueta} · ${capitalizar(mes)}`, value: fmt(leer()) });
    input.addEventListener('focus', () => { const v = leer(); input.value = v ? String(v).replace('.', ',') : ''; input.select(); });
    input.addEventListener('blur', () => guardar(fila, mes, input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = fmt(leer()); input.blur(); }
    });
    return h('td', { class: 'cell-td' }, input);
  }

  clear(tbody, filas.map((f) => {
    const etiqueta = METODO_LABEL[f] || f;
    return h('tr', {}, h('th', { scope: 'row', class: 'sticky-col' }, etiqueta),
      MESES.map((m) => celda(f, m, etiqueta)), h('td', { class: 'num total-col', 'data-total': f }));
  }));
  pie();

  function exportar() {
    const cab = [entero ? 'Grupo' : 'Modalidad', ...MESES.map(capitalizar)];
    const cuerpo = filas.map((f) => [METODO_LABEL[f] || f, ...MESES.map((m) => {
      const v = num(buscar(f, m)?.[campoValor]); return v ? (entero ? String(v) : v.toFixed(2).replace('.', ',')) : '';
    })]);
    descargarCSV(`${clase}_${curso.nombre}.csv`, [cab, ...cuerpo]);
  }

  const el = h('section', { class: 'card resumen-ing', 'aria-label': titulo },
    h('div', { class: 'section-head' },
      h('div', {}, h('h3', {}, titulo), h('div', { class: 'count' }, sub)),
      h('div', { class: 'section-actions' }, h('button', { class: 'btn', onclick: exportar }, 'Exportar CSV'))),
    h('div', { class: 'table-wrap' },
      ajustarAncho(h('table', { class: `data grid-ing grid-mini ${clase}` },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'sticky-col' }, entero ? 'Grupo' : 'Modalidad'),
          MESES_CORTO.map((m) => h('th', { scope: 'col', class: 'num' }, m)), h('th', { scope: 'col', class: 'num' }, entero ? 'Media' : 'Total'))),
        tbody, tfoot))));
  return { el, pie };
}

// totalesMes(): ingresos de la cuadricula por mes (array de 12), para la fila "Sin desglosar".
export async function renderResumenIngresos(cont, ctx, curso, totalesMes) {
  const [metodos, alumnos] = await Promise.all([db.getIngresosMetodo(curso.id), db.getAlumnosMes(curso.id)]);
  const filasMet = [...new Set([...METODOS, ...metodos.map((r) => r.metodo)])];
  const filasAlu = [...new Set([...GRUPOS_ALUMNOS, ...alumnos.map((r) => r.grupo)])];
  const tMet = tablaEditable({
    titulo: 'Cobros por modalidad de pago', clase: 'grid-metodos',
    sub: 'Como las filas "Modalidad Pago" de la hoja Ing. No incluye el Welcome pack ni todos los extras, por eso no suma el total del mes.',
    filas: filasMet, campoFila: 'metodo', campoValor: 'importe', registros: metodos, curso,
    crear: db.crearIngresoMetodo, actualizar: db.actualizarIngresoMetodo,
    extras: (porMes) => {
      const tot = totalesMes();
      const dif = tot.map((t, i) => t - porMes[i]);
      return [h('tr', { class: 'fila-info' }, h('th', { scope: 'row', class: 'sticky-col' }, 'Ingresos del mes (cuadrícula)'),
        tot.map((v) => h('td', { class: 'num' }, v ? fmtEUR(v) : '—')), h('td', { class: 'num total-col' }, fmtEUR(tot.reduce((a, b) => a + b, 0)))),
      h('tr', { class: 'fila-info' }, h('th', { scope: 'row', class: 'sticky-col' }, 'Sin desglosar'),
        dif.map((v, i) => h('td', { class: 'num' }, porMes[i] ? fmtEUR(v) : '—')), h('td', { class: 'num total-col' }, fmtEUR(dif.reduce((a, b, i) => a + (porMes[i] ? b : 0), 0))))];
    },
  });
  const tAlu = tablaEditable({
    titulo: 'Alumnos por grupo', clase: 'grid-alumnos', entero: true,
    sub: 'Número de alumnos de cada mes (filas "Nr Alumnos" de la hoja Ing).',
    filas: filasAlu, campoFila: 'grupo', campoValor: 'alumnos', registros: alumnos, curso,
    crear: db.crearAlumnosMes, actualizar: db.actualizarAlumnosMes,
  });
  clear(cont, tMet.el, tAlu.el);
  return { refrescar: tMet.pie };
}
