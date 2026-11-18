// Pagos: matriz alumno × mes del curso (welcome pack + 12 mensualidades). Sustituye a la pestaña PAGOS del Excel.
import { h, clear, cargando, toast, fmtEUR, fmtEUR2, hoyISO, normalizar, MESES, MESES_CORTO, capitalizar } from '../ui.js';
import * as api from './api.js';
import { cabecera, sel, nombreAlumno, refrescar } from './kit.js';

const mesActual = () => ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][new Date().getMonth()];

export async function renderPagos(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const [alumnos, insc, cuotas] = await Promise.all([api.alumnos(), api.inscripciones(curso.id), api.cuotas(curso.id)]);
  const inscPor = new Map(insc.map((i) => [i.alumno_id, i]));
  const cuotaPor = new Map(cuotas.map((c) => [`${c.alumno_id}|${c.concepto}|${c.mes}`, c]));
  const editor = ctx.edita('ac_pagos');
  const f = { q: '', soloPend: false };
  const filasBase = alumnos.filter((a) => (inscPor.get(a.id)?.activa && a.estado !== 'baja') || (a.estado === 'inscrito' && inscPor.has(a.id)) || cuotas.some((c) => c.alumno_id === a.id));
  const sinInsc = alumnos.filter((a) => a.estado === 'inscrito' && !inscPor.has(a.id)).length;

  const totales = (c) => ({ pagado: c.filter((x) => x.estado === 'pagado').reduce((s, x) => s + Number(x.importe), 0), total: c.filter((x) => x.estado !== 'exento').reduce((s, x) => s + Number(x.importe), 0) });
  const kpis = totales(cuotas);
  const kpi = (l, v, sub) => h('div', { class: 'card kpi' }, h('div', { class: 'label' }, l), h('div', { class: 'value' }, v), sub ? h('div', { class: 'sub' }, sub) : null);

  const mesSel = sel(MESES.map((m) => [m, capitalizar(m)]), mesActual());
  const btnGen = h('button', { class: 'btn small', type: 'button', disabled: !editor, onclick: async () => {
    try { const n = await api.generarCuotas(curso.id, mesSel.value); toast(n ? `${n} mensualidades de ${mesSel.value} creadas.` : `No faltaba ninguna cuota de ${mesSel.value}.`); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
  } }, 'Generar mensualidad');
  const btnWp = h('button', { class: 'btn small', type: 'button', disabled: !editor, onclick: async () => {
    const filas = insc.filter((i) => i.activa && Number(i.welcome_pack) > 0).map((i) => ({ alumno_id: i.alumno_id, curso_id: curso.id, concepto: 'welcome_pack', mes: '', importe: i.welcome_pack }));
    try { const r = await api.insMany('ac_cuotas', filas, { onConflict: 'alumno_id,curso_id,concepto,mes', ignorar: true }); toast(r.length ? `${r.length} welcome packs creados.` : 'Todos los welcome packs ya estaban creados.'); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
  } }, 'Generar welcome pack');

  const cuerpo = h('tbody'); const pie = h('tfoot');
  const celda = (a, concepto, mes) => {
    const c = cuotaPor.get(`${a.id}|${concepto}|${mes}`);
    if (!c) return h('td', { class: 'ac-cel vacia' }, '·');
    const b = h('button', { type: 'button', class: `ac-pago ${c.estado}`, title: `${fmtEUR2(c.importe)} · ${c.estado}${editor ? ' · clic: pagado/pendiente · Alt+clic: devuelto · Mayús+clic: exento' : ''}`, disabled: !editor }, c.estado === 'pagado' ? '✓' : c.estado === 'devuelto' ? '↩' : c.estado === 'exento' ? '–' : fmtEUR(c.importe).replace(/\s?€/, ''));
    b.addEventListener('click', async (e) => {
      const nuevo = e.altKey ? 'devuelto' : e.shiftKey ? 'exento' : c.estado === 'pagado' ? 'pendiente' : 'pagado';
      b.disabled = true;
      try { Object.assign(c, await api.upd('ac_cuotas', c.id, { estado: nuevo, fecha_pago: nuevo === 'pagado' ? hoyISO() : null })); b.className = `ac-pago ${c.estado}`; b.textContent = c.estado === 'pagado' ? '✓' : c.estado === 'devuelto' ? '↩' : c.estado === 'exento' ? '–' : fmtEUR(c.importe).replace(/\s?€/, ''); pintarPie(); } catch (ex) { toast(ex.message, 'error'); } finally { b.disabled = !editor; }
    });
    return h('td', { class: 'ac-cel' }, b);
  };
  const inputCuota = (a, campo) => {
    const i = inscPor.get(a.id);
    const inp = h('input', { type: 'number', step: '0.01', class: 'cell ac-imp', value: i?.[campo] || '', disabled: !editor, 'aria-label': `${campo} de ${nombreAlumno(a)}` });
    inp.addEventListener('change', async () => {
      const v = Number(inp.value || 0);
      try {
        const cur = inscPor.get(a.id);
        if (cur) Object.assign(cur, await api.upd('ac_inscripciones', cur.id, { [campo]: v }));
        else inscPor.set(a.id, await api.ins('ac_inscripciones', { alumno_id: a.id, curso_id: curso.id, [campo]: v }));
        inp.classList.add('saved'); setTimeout(() => inp.classList.remove('saved'), 800);
      } catch (ex) { toast(ex.message, 'error'); }
    });
    return h('td', { class: 'num' }, inp);
  };
  function pintarPie() {
    const col = (c) => { const t = totales(c); return h('th', { class: 'num', title: `Cobrado ${fmtEUR2(t.pagado)} de ${fmtEUR2(t.total)}` }, fmtEUR(t.pagado), h('div', { class: 'muted small' }, `de ${fmtEUR(t.total)}`)); };
    clear(pie, h('tr', {}, h('th', { colspan: 3 }, 'Cobrado / total'), col(cuotas.filter((c) => c.concepto === 'welcome_pack')), MESES.map((m) => col(cuotas.filter((c) => c.concepto === 'mensualidad' && c.mes === m)))));
  }
  function pintar() {
    const q = normalizar(f.q);
    const filas = filasBase.filter((a) => (!q || normalizar(nombreAlumno(a)).includes(q)) && (!f.soloPend || cuotas.some((c) => c.alumno_id === a.id && c.estado === 'pendiente' && (c.mes === '' || MESES.indexOf(c.mes) <= MESES.indexOf(mesActual())))));
    clear(cuerpo, filas.map((a) => h('tr', {}, h('td', { class: 'ac-nom' }, nombreAlumno(a)), inputCuota(a, 'cuota_mensual'), inputCuota(a, 'welcome_pack'), celda(a, 'welcome_pack', ''), MESES.map((m) => celda(a, 'mensualidad', m)))));
    if (!filas.length) clear(cuerpo, h('tr', {}, h('td', { colspan: 16, class: 'empty' }, 'No hay alumnos con cuotas en este curso. Fija la cuota de cada alumno en su ficha (o aquí) y genera las mensualidades.')));
  }
  const tb = h('table', { class: 'data ac-matriz' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Alumno'), h('th', { class: 'num' }, 'Cuota'), h('th', { class: 'num' }, 'WP'), h('th', {}, 'WP'), MESES_CORTO.map((m) => h('th', {}, m)))), cuerpo, pie);
  pintar(); pintarPie();
  clear(view,
    cabecera(`Pagos · ${curso.nombre}`, 'Cuota pactada por alumno y cobro de cada mensualidad', mesSel, btnGen, btnWp, h('a', { class: 'btn small', href: '#/ac_pagos_importar' }, 'Importar del CRM')),
    sinInsc ? h('div', { class: 'banner warn' }, `${sinInsc} alumnos inscritos todavía no tienen cuota fijada en este curso: escribe su cuota en la fila (si no aparecen aquí, ábrelos desde Alumnos).`) : null,
    h('div', { class: 'kpi-row' }, kpi('Cobrado', fmtEUR2(kpis.pagado)), kpi('Pendiente', fmtEUR2(kpis.total - kpis.pagado), 'Cuotas generadas aún sin cobrar'), kpi('Alumnos', String(filasBase.length))),
    h('div', { class: 'filters filters-2' }, h('input', { type: 'search', placeholder: 'Buscar alumno…', oninput: (e) => { f.q = e.target.value; pintar(); } }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { f.soloPend = e.target.checked; pintar(); } }), ' Solo con pagos pendientes hasta este mes')),
    h('div', { class: 'table-wrap card-tabla' }, tb));
}
