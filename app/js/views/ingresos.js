// Ingresos del curso: una cuadricula grupo/level/tipo x mes, como el resumen de las
// hojas "20xx.xx Ing" del Excel. Cada celda se edita y se guarda al salir de ella.
import { h, clear, ajustarAncho, fmtEUR, fmtEUR2, num, MESES, MESES_CORTO, capitalizar, cargando, toast, descargarCSV, grupoClase, normalizar, importeEscrito } from '../ui.js';
import { crearIngreso, actualizarIngreso } from '../db.js';
import { renderResumenIngresos } from './ingresos-resumen.js';
import * as api from '../academia/api.js';

const ORDEN_GRUPOS = ['Babies', 'Kids', 'Teens', 'Adultos', '1 to 1', 'Empresas', 'Activities'];
const esWP = (tipo) => /welcome/i.test(tipo || '');
const WP_TIPO = 'Welcome pack';

// «,» y «.» valen igual como decimal; "" -> 0 ; texto inválido -> NaN
export const leerImporte = (txt) => importeEscrito(txt) ?? 0;
const fmtCelda = (v) => (v ? new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(v) : '');

// Trimestre natural del mes dentro del curso: octubre del curso 2025.26 -> "4T 2025"
export function trimestreDe(cursoNombre, mes) {
  const i = MESES.indexOf(mes);
  if (i < 0) return null;
  const y1 = Number(String(cursoNombre).slice(0, 4));
  const mesNatural = ((i + 8) % 12) + 1; // septiembre = 9
  const anio = mesNatural >= 9 ? y1 : y1 + 1;
  return `${Math.ceil(mesNatural / 3)}T ${anio}`;
}

function ordenGrupo(g) { const i = ORDEN_GRUPOS.indexOf(g); return i < 0 ? 99 : i; }

export function construirFilas(registros) {
  const filas = new Map();
  const clave = (r) => `${r.grupo}|${r.level}|${r.tipo}`;
  for (const r of registros.filter((r) => !esWP(r.tipo))) {
    if (!filas.has(clave(r))) filas.set(clave(r), { grupo: r.grupo, level: r.level, tipo: r.tipo, celdas: {}, wp: null });
    const mes = (r.mes || '').trim().toLowerCase();
    if (MESES.includes(mes)) filas.get(clave(r)).celdas[mes] = r;
  }
  for (const r of registros.filter((r) => esWP(r.tipo))) {
    const destino = [...filas.values()].find((f) => f.grupo === r.grupo && f.level === r.level && !f.wp);
    if (destino) destino.wp = r;
    else filas.set(clave(r), { grupo: r.grupo, level: r.level, tipo: '', celdas: {}, wp: r });
  }
  return [...filas.values()].sort((a, b) => ordenGrupo(a.grupo) - ordenGrupo(b.grupo)
    || String(a.level).localeCompare(String(b.level), 'es', { numeric: true })
    || String(a.tipo).localeCompare(String(b.tipo)));
}

// Modalidad del grupo de Academia -> nombre de grupo de la cuadrícula (Adults -> Adultos…)
const nombreGrupo = (m) => { const n = normalizar(m).replace(/s$/, ''); return ORDEN_GRUPOS.find((g) => normalizar(g).replace(/s$/, '') === n || (n === 'adult' && g === 'Adultos')) || (m || 'Sin grupo'); };

// Lo cobrado en Pagos (cuotas marcadas como pagadas) por grupo, level y mes: así se rellena el cuadro, como en el Excel.
// Cada alumno cuenta en su grupo activo del curso (modalidad y nivel del grupo); sin grupo va a «Sin grupo».
async function pagosDelCurso(cursoId) {
  const [cuotas, grupos, alumnos] = await Promise.all([api.cuotas(cursoId), api.grupos(cursoId), api.alumnos()]);
  const alu = new Map(alumnos.map((a) => [a.id, a]));
  // grupo del alumno (para el level): el activo; si no, el último en el que estuvo (las bajas conservan lo cobrado)
  const deAlumno = new Map();
  for (const g of grupos) for (const m of g.miembros || []) if (!m.fecha_baja && !deAlumno.has(m.alumno_id)) deAlumno.set(m.alumno_id, g);
  for (const g of grupos) for (const m of g.miembros || []) if (!deAlumno.has(m.alumno_id)) deAlumno.set(m.alumno_id, g);
  const esOtro = (a) => Number(a?.num) > 0 && Number(a?.num) < 1; // 0.x: Camps, Story Time…
  const grupoDe = (a) => (esOtro(a) ? 'Activities' : a?.modalidad ? nombreGrupo(a.modalidad) : null);
  const res = new Map();
  const metodos = {}; // METODO -> { mes: importe } (mensualidades + otros cobrados; sin welcome pack, como las filas "Modalidad Pago" del Excel)
  const nAlu = {}; // grupo -> { mes: Set(num) } alumnos con mensualidad ese mes
  const claveMetodo = (m) => { const n = normalizar(m || ''); if (n.startsWith('domicil')) return 'DOMICILIACION'; if (n.startsWith('transf')) return 'TRANSFERENCIA'; if (n.startsWith('tpv') || n.startsWith('tarjeta')) return 'TPV / TARJETA'; if (n.startsWith('efect')) return 'EFECTIVO'; return 'VARIOS'; };
  for (const c of cuotas) {
    if (c.estado === 'exento' || !num(c.importe)) continue;
    const a = alu.get(c.alumno_id); const g = deAlumno.get(c.alumno_id);
    const grupo = grupoDe(a) || (g ? nombreGrupo(g.modalidad) : 'Sin grupo');
    if (c.concepto !== 'welcome_pack' && MESES.includes(c.mes) && !esOtro(a) && c.concepto === 'mensualidad') {
      const s = ((nAlu[grupo] ||= {})[c.mes] ||= new Set()); s.add(a?.num ?? c.alumno_id);
    }
    if (c.estado !== 'pagado') continue;
    if (c.concepto !== 'welcome_pack' && MESES.includes(c.mes)) {
      const mk = claveMetodo(c.metodo_pago); const mm = (metodos[mk] ||= {}); mm[c.mes] = (mm[c.mes] || 0) + num(c.importe);
    }
    const level = (g?.nivel && !esOtro(a)) ? g.nivel : '';
    const k = `${grupo}|${level}`;
    if (!res.has(k)) res.set(k, { grupo, level, meses: {}, wp: null });
    const e = res.get(k);
    if (c.concepto === 'welcome_pack') e.wp = (e.wp || 0) + num(c.importe);
    else if ((c.concepto === 'mensualidad' || c.concepto === 'otro') && MESES.includes(c.mes)) e.meses[c.mes] = (e.meses[c.mes] || 0) + num(c.importe);
  }
  for (const e of res.values()) for (const m of Object.keys(e.meses)) e.meses[m] = Math.round(e.meses[m] * 100) / 100;
  for (const mm of Object.values(metodos)) for (const m of Object.keys(mm)) mm[m] = Math.round(mm[m] * 100) / 100;
  const alumnosMes = {}; for (const [g, mm] of Object.entries(nAlu)) alumnosMes[g] = Object.fromEntries(Object.entries(mm).map(([m, st]) => [m, st.size]));
  return { filas: [...res.values()], metodos, alumnos: alumnosMes };
}
// valor efectivo de una celda: lo de Pagos si hay pagos marcados; si no, lo guardado en Ingresos
const val = (f, mes) => (mes ? (f.pagos?.meses[mes] ?? num(f.celdas[mes]?.cantidad)) : (f.pagos?.wp ?? num(f.wp?.cantidad)));
const deriva = (f, mes) => (mes ? f.pagos?.meses[mes] != null : f.pagos?.wp != null);

export async function renderIngresos(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const registros = await ctx.ingresos(curso.id); // array compartido con el Panel
  let filas = construirFilas(registros);
  let hayPagos = false; let derivado = null;
  try {
    const pc = await pagosDelCurso(curso.id); derivado = { metodos: pc.metodos, alumnos: pc.alumnos };
    for (const e of pc.filas) {
      let f = filas.find((x) => x.grupo === e.grupo && x.level === e.level && !/extra/i.test(x.tipo) && x.tipo);
      if (!f) { f = { grupo: e.grupo, level: e.level, tipo: 'Mensualidad', celdas: {}, wp: null }; filas.push(f); }
      f.pagos = e; hayPagos = true;
    }
    filas = filas.sort((a, b) => ordenGrupo(a.grupo) - ordenGrupo(b.grupo) || String(a.level).localeCompare(String(b.level), 'es', { numeric: true }) || String(a.tipo).localeCompare(String(b.tipo)));
  } catch { /* sin acceso a Pagos: se ve lo guardado */ }

  const kpiVals = {};
  const kpi = (id, label) => {
    kpiVals[id] = h('div', { class: 'value' });
    return h('div', { class: `card kpi kpi-c-${id}` }, h('div', { class: 'label' }, label), kpiVals[id]);
  };
  const totalesMes = {}; let totalWP; let totalGeneral;
  const tbody = h('tbody');

  function totalFila(f) {
    return MESES.reduce((s, m) => s + val(f, m), 0) + val(f, null);
  }
  function recalcular() {
    let total = 0, wp = 0, extras = 0;
    for (const m of MESES) totalesMes[m].textContent = '';
    const porMes = Object.fromEntries(MESES.map((m) => [m, 0]));
    for (const f of filas) {
      for (const m of MESES) porMes[m] += val(f, m);
      wp += val(f, null);
      const t = totalFila(f);
      total += t;
      if (/extra/i.test(f.tipo)) extras += t - val(f, null);
      if (f._celdaTotal) f._celdaTotal.textContent = fmtEUR2(t);
    }
    for (const m of MESES) totalesMes[m].textContent = porMes[m] ? fmtEUR(porMes[m]) : '—';
    totalWP.textContent = wp ? fmtEUR(wp) : '—';
    totalGeneral.textContent = fmtEUR2(total);
    kpiVals.total.textContent = fmtEUR(total);
    kpiVals.mensualidades.textContent = fmtEUR(total - wp - extras);
    kpiVals.wp.textContent = fmtEUR(wp);
    kpiVals.extras.textContent = fmtEUR(extras);
    if (resumen) resumen.refrescar();
  }
  // mensualidades (sin extras ni welcome pack) por mes y welcome pack: es lo que se compara con Pagos
  function totalesPorMes() {
    return MESES.map((m) => filas.reduce((s, f) => s + val(f, m), 0));
  }
  let resumen = null;
  const resumenCont = h('div', { class: 'resumen-cont' });

  async function guardar(f, mes, input) {
    const valor = leerImporte(input.value);
    const actual = mes ? f.celdas[mes] : f.wp;
    if (Number.isNaN(valor)) {
      input.classList.add('invalid'); toast('Importe no válido: usa por ejemplo 1234,50', 'error'); return;
    }
    input.classList.remove('invalid');
    if (num(actual?.cantidad) === valor) { input.value = fmtCelda(valor); return; }
    if (!actual && valor === 0) { input.value = ''; return; }
    input.classList.add('saving');
    try {
      let reg;
      if (actual) reg = await actualizarIngreso(actual.id, { cantidad: valor });
      else {
        reg = await crearIngreso({
          curso_id: curso.id, grupo: f.grupo, level: f.level,
          tipo: mes ? (f.tipo || 'Mensualidad') : WP_TIPO,
          mes: mes ? capitalizar(mes) : null, trimestre: mes ? trimestreDe(curso.nombre, mes) : null,
          cantidad: valor,
        });
        registros.push(reg);
      }
      if (actual) Object.assign(actual, reg);
      if (mes) f.celdas[mes] = actual || reg; else f.wp = actual || reg;
      if (!f.tipo && mes) f.tipo = reg.tipo;
      input.value = fmtCelda(valor);
      input.classList.add('saved'); setTimeout(() => input.classList.remove('saved'), 900);
      recalcular();
    } catch (ex) {
      input.classList.add('invalid'); toast('No se ha guardado: ' + ex.message, 'error');
    } finally { input.classList.remove('saving'); }
  }

  function celda(f, mes) {
    const reg = mes ? f.celdas[mes] : f.wp;
    const etiqueta = `${f.grupo} ${f.level}${f.tipo ? ' ' + f.tipo : ''} · ${mes ? capitalizar(mes) : 'Welcome pack'}`;
    if (deriva(f, mes)) { // viene de los pagos marcados en Pagos: no se edita aquí
      return h('td', { class: 'cell-td' }, h('input', { class: 'cell desde-pagos', type: 'text', readonly: true, tabindex: -1, 'aria-label': `${etiqueta} (desde Pagos)`, title: 'Suma de los pagos marcados como pagados en Pagos', value: fmtCelda(val(f, mes)) }));
    }
    const input = h('input', { class: 'cell', type: 'text', inputmode: 'decimal', 'aria-label': etiqueta, value: fmtCelda(num(reg?.cantidad)) });
    input.addEventListener('focus', () => { const v = num((mes ? f.celdas[mes] : f.wp)?.cantidad); input.value = v ? String(v).replace('.', ',') : ''; input.select(); });
    input.addEventListener('blur', () => guardar(f, mes, input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = fmtCelda(num((mes ? f.celdas[mes] : f.wp)?.cantidad)); input.blur(); }
    });
    return h('td', { class: 'cell-td' }, input);
  }

  function pintarFilas() {
    let grupoAnterior = null;
    clear(tbody, filas.map((f) => {
      f._celdaTotal = h('td', { class: 'num total-col' });
      const nuevoGrupo = f.grupo !== grupoAnterior; grupoAnterior = f.grupo;
      return h('tr', { class: `gcolor ${grupoClase(f.grupo)}${nuevoGrupo ? ' grupo-inicio' : ''}` },
        h('th', { scope: 'row', class: 'sticky-col' }, h('span', { class: 'grupo' }, f.grupo), h('span', { class: 'line2' }, [f.level, f.tipo].filter(Boolean).join(' · '))),
        celda(f, null),
        MESES.map((m) => celda(f, m)),
        f._celdaTotal);
    }));
    recalcular();
  }

  function anadirFila() {
    const grupos = [...new Set([...ORDEN_GRUPOS, ...filas.map((f) => f.grupo)])];
    const fGrupo = h('input', { list: 'dl-grupos', required: true });
    const fLevel = h('input', { list: 'dl-levels', required: true });
    const fTipo = h('select', {}, h('option', { value: 'Mensualidad' }, 'Mensualidad'), h('option', { value: 'Extra' }, 'Extra'));
    const err = h('div', { class: 'field-error', hidden: true });
    const cerrar = () => overlay.remove();
    const overlay = h('div', { class: 'overlay modal-center', onclick: (e) => { if (e.target === overlay) cerrar(); } },
      h('form', { class: 'dialog', onsubmit: (e) => {
        e.preventDefault();
        const g = fGrupo.value.trim(), l = fLevel.value.trim(), t = fTipo.value;
        if (!g || !l) { err.textContent = 'Indica grupo y level.'; err.hidden = false; return; }
        if (filas.some((f) => f.grupo === g && f.level === l && f.tipo === t)) { err.textContent = 'Esa fila ya existe.'; err.hidden = false; return; }
        filas.push({ grupo: g, level: l, tipo: t, celdas: {}, wp: null });
        filas = construirOrden(filas);
        cerrar(); pintarFilas();
        toast('Fila añadida: escribe los importes en sus celdas');
      } },
      h('h3', {}, 'Añadir fila de ingresos'),
      h('label', { class: 'field' }, 'Grupo', fGrupo),
      h('label', { class: 'field' }, 'Level', fLevel),
      h('label', { class: 'field' }, 'Tipo', fTipo),
      err,
      h('datalist', { id: 'dl-grupos' }, grupos.map((g) => h('option', { value: g }))),
      h('datalist', { id: 'dl-levels' }, [...new Set(filas.map((f) => f.level))].map((l) => h('option', { value: l }))),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: cerrar }, 'Cancelar'), h('button', { class: 'btn primary', type: 'submit' }, 'Añadir'))));
    document.body.append(overlay);
    fGrupo.focus();
  }
  const construirOrden = (lista) => [...lista].sort((a, b) => ordenGrupo(a.grupo) - ordenGrupo(b.grupo)
    || String(a.level).localeCompare(String(b.level), 'es', { numeric: true }) || String(a.tipo).localeCompare(String(b.tipo)));

  function exportar() {
    const cab = ['Grupo', 'Level', 'Tipo', 'Welcome pack', ...MESES.map(capitalizar), 'Total'];
    const n2 = (v) => (v ? num(v).toFixed(2).replace('.', ',') : '');
    const cuerpo = filas.map((f) => [f.grupo, f.level, f.tipo, n2(val(f, null)), ...MESES.map((m) => n2(val(f, m))), n2(totalFila(f))]);
    descargarCSV(`ingresos_${curso.nombre}.csv`, [cab, ...cuerpo]);
  }

  for (const m of MESES) totalesMes[m] = h('td', { class: 'num' });
  totalWP = h('td', { class: 'num' }); totalGeneral = h('td', { class: 'num total-col' });

  clear(view,
    h('div', { class: 'banner' }, h('span', {}, h('strong', {}, 'Fase de pruebas: '), 'el Excel sigue siendo la referencia. Lo que cambies aquí no se copia al Excel.')),
    hayPagos ? h('div', { class: 'banner info-pagos' }, h('span', {}, h('strong', {}, 'Resumen de Pagos: '), 'los importes con este fondo se rellenan solos con los pagos marcados como pagados en ', h('a', { href: '#/ac_pagos' }, 'Pagos'), '. El resto son importes guardados (histórico), que sí puedes editar.')) : null,
    ctx.centroActual() && !ctx.centroActual().principal
      ? h('div', { class: 'banner warn' }, h('span', {}, 'Los ingresos todavía no se separan por centro: estos son los del centro principal (', ctx.tituloCentro(ctx.centroPrincipal()?.nombre), '). En Balance y Panel, este centro aparece sin ingresos.'))
      : null,
    h('div', { class: 'kpi-row kpi-4' }, kpi('total', 'Ingresos del curso'), kpi('mensualidades', 'Mensualidades'), kpi('wp', 'Welcome Pack'), kpi('extras', 'Extras (actividades, empresas)')),
    h('div', { class: 'section-head' },
      h('div', {}, h('h2', {}, `Ingresos · ${curso.nombre}`), h('div', { class: 'count' }, 'Haz clic en una celda, escribe el importe y pulsa Intro. Se guarda solo.')),
      h('div', { class: 'section-actions' },
        h('button', { class: 'btn', onclick: exportar }, 'Exportar CSV'),
        h('button', { class: 'btn primary', onclick: anadirFila }, '+ Añadir fila'))),
    h('div', { class: 'table-wrap' },
      ajustarAncho(h('table', { class: 'data grid-ing' },
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col', class: 'sticky-col' }, 'Grupo'),
          h('th', { scope: 'col', class: 'num' }, 'Welcome pack'),
          MESES_CORTO.map((m) => h('th', { scope: 'col', class: 'num' }, m)),
          h('th', { scope: 'col', class: 'num' }, 'Total'))),
        tbody,
        h('tfoot', {}, h('tr', {}, h('th', { scope: 'row', class: 'sticky-col' }, 'Total'), totalWP, MESES.map((m) => totalesMes[m]), totalGeneral))))),
    resumenCont);
  pintarFilas();
  resumen = await renderResumenIngresos(resumenCont, ctx, curso, totalesPorMes, derivado);
}
