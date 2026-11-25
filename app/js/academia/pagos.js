// Pagos: una fila por alumno y, por cada mes (y el welcome pack), la cuantía + «pagado» + «recibo hecho», como la hoja PAGOS del Excel.
// Se pueden seleccionar varias celdas (arrastrando, Ctrl/Cmd+clic o Mayús+clic) y cambiarlas de una vez desde la barra inferior.
import { h, clear, cargando, toast, fmtEUR2, hoyISO, normalizar, MESES, MESES_CORTO, capitalizar, confirmar } from '../ui.js';
import { ordenGuardado, guardarOrden } from '../orden-compartido.js';
import * as api from './api.js';
import { cabecera, sel, nombreAlumno, refrescar, drawer, numero, guardarBoton } from './kit.js';
import { abrirFicha } from './alumnos.js';
import { vista as vistaEstado, vincular, avisoFiltros, busqueda } from '../vista.js';

const mesActual = () => ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][new Date().getMonth()];
const COLS = [{ c: 'welcome_pack', m: '', t: 'WP' }, ...MESES.map((m, i) => ({ c: 'mensualidad', m, t: MESES_CORTO[i] }))];
const fmtN = (n) => Number(n || 0).toLocaleString('es-ES', { maximumFractionDigits: 2 });
const norm = (s) => normalizar(String(s || '').trim());
const SIMBOLO = { pagado: '✓', devuelto: '↩', exento: '–', pendiente: '' };

export async function renderPagos(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const [alumnos, insc, cuotas, precios, remesas, listas] = await Promise.all([api.alumnos(), api.inscripciones(curso.id), api.cuotas(curso.id), api.wpPrecios(curso.id), api.remesas(curso.id), api.listas()]);
  const remPor = new Map(remesas.map((r) => [r.id, r]));
  const dondeCargo = (c) => { const r = remPor.get(c.remesa_id); return r ? ` · en ${r.nombre || capitalizar(r.mes)}${r.banco ? ' (' + r.banco + ')' : ''}` : (c.concepto === 'mensualidad' ? ' · sin remesa' : ''); };
  const inscPor = new Map(insc.map((i) => [i.alumno_id, i]));
  const cuotaPor = new Map(cuotas.map((c) => [`${c.alumno_id}|${c.concepto}|${c.mes}`, c]));
  const editor = ctx.edita('ac_pagos');
  const f = vistaEstado('pagos.f', { q: '', soloPend: false, modo: '', nivel: '', recibo: '' });
  const orden = { k: 'nombre', dir: 1 };
  { const g = ordenGuardado('pagos'); if (g && g.k) { orden.k = g.k; orden.dir = g.dir === -1 ? -1 : 1; } }
  const RANGO = { pendiente: 0, devuelto: 1, pagado: 2, exento: 3 };
  const esOtro = (a) => Number(a.num) > 0 && Number(a.num) < 1; // filas 0.x del Excel: Camps, Scape Room, Story Time, Other, Recogidas
  const NOMBRES_OTROS = { 0.1: 'Camp Easter', 0.2: 'Camp Summer', 0.3: 'Camp Xmass', 0.4: 'Scape Room', 0.5: 'Story Time', 0.6: 'Other Activities', 0.7: 'Recogidas Mas Rampinyo' };
  const nombreFila = (a) => (esOtro(a) ? NOMBRES_OTROS[Number(a.num)] || nombreAlumno(a) : nombreAlumno(a));
  const filasBase = alumnos.filter((a) => esOtro(a) || (inscPor.get(a.id)?.activa && a.estado !== 'baja') || (a.estado === 'inscrito' && inscPor.has(a.id)) || cuotas.some((c) => c.alumno_id === a.id));
  const sinInsc = alumnos.filter((a) => a.estado === 'inscrito' && !inscPor.has(a.id)).length;
  const precioWp = (a) => { const p = precios.find((x) => norm(x.nivel) === norm(a.nivel) && norm(a.nivel)); return p ? Number(p.importe) : null; };
  const importeDefecto = (a, col) => (col.c === 'welcome_pack' ? precioWp(a) ?? Number(inscPor.get(a.id)?.welcome_pack || 0) : Number(inscPor.get(a.id)?.cuota_mensual || 0));
  const cuotaDe = (a, ci) => cuotaPor.get(`${a.id}|${COLS[ci].c}|${COLS[ci].m}`);

  let rows = []; const celdas = new Map(); const seleccion = new Set();
  let ancla = null; let arrastrando = false;

  // ---------- totales ----------
  const totales = (c) => ({ pagado: c.filter((x) => x.estado === 'pagado').reduce((s, x) => s + Number(x.importe), 0), total: c.filter((x) => x.estado !== 'exento').reduce((s, x) => s + Number(x.importe), 0) });
  const kv = {};
  const kpi = (k, l, sub) => { kv[k] = h('div', { class: 'value' }); return h('div', { class: 'card kpi' }, h('div', { class: 'label' }, l), kv[k], sub ? h('div', { class: 'sub' }, sub) : null); };
  const kpisEl = h('div', { class: 'kpi-row kpi-4' }, kpi('cob', 'Cobrado'), kpi('pen', 'Pendiente', 'Cuotas generadas aún sin cobrar'), kpi('rec', 'Recibos por hacer', 'Cobradas sin «recibo hecho»'), kpi('al', 'Alumnos'));
  function pintarKpis() {
    const t = totales(cuotas);
    kv.cob.textContent = fmtEUR2(t.pagado); kv.pen.textContent = fmtEUR2(t.total - t.pagado);
    kv.rec.textContent = String(cuotas.filter((c) => c.estado === 'pagado' && !c.recibo_hecho).length); kv.al.textContent = String(filasBase.length);
  }
  const resumen = h('tr', { class: 'ac-resumen' });
  function pintarPie() {
    const col = (c) => { const t = totales(c); return h('th', { class: 'num', title: `Cobrado ${fmtEUR2(t.pagado)} de ${fmtEUR2(t.total)} · pendiente ${fmtEUR2(t.total - t.pagado)}` }, h('b', {}, fmtN(t.pagado)), h('span', { class: 'ac-de' }, `/${fmtN(t.total)}`)); };
    clear(resumen, h('th', { colspan: 5, class: 'l' }, 'Cobrado / total (€)'), COLS.map((k) => col(cuotas.filter((c) => c.concepto === k.c && c.mes === k.m))));
  }

  // ---------- celdas ----------
  const claveSel = (a, ci) => `${a.id}|${ci}`;
  function pintaCelda(a, ci) {
    const td = celdas.get(claveSel(a, ci)); if (!td) return;
    const c = cuotaDe(a, ci);
    td.className = 'ac-cel' + (c ? ' ' + c.estado + (c.nota_cambio ? ' cambio' : '') : ' vacia') + (seleccion.has(claveSel(a, ci)) ? ' sel' : '');
    clear(td);
    if (!c) { td.append(h('span', { class: 'pc-vacio' }, '·')); return; }
    const tip = `${COLS[ci].c === 'welcome_pack' ? 'Welcome pack' : capitalizar(c.mes)} · ${fmtEUR2(c.importe)} · ${c.estado}${dondeCargo(c)}${c.nota_cambio ? '\n⚠ ' + c.nota_cambio : ''}${c.nivel ? ' · nivel ' + c.nivel : ''}${c.importe_manual ? ' · importe manual' : ''}${editor ? ' · doble clic para cambiar el importe' : ''}`;
    const imp = h('span', { class: 'pc-imp' + (c.importe_manual ? ' manual' : ''), title: tip }, fmtN(c.importe));
    if (editor) imp.addEventListener('dblclick', (e) => { e.stopPropagation(); editarInline(a, ci, imp); });
    const p = h('button', { type: 'button', class: `pc-chk pc-p ${c.estado}`, disabled: !editor, title: c.estado === 'pagado' ? 'Pagado (clic: quitar)' : c.estado === 'devuelto' ? 'Devuelto (clic: marcar pagado)' : c.estado === 'exento' ? 'Exento (clic: marcar pagado)' : 'Sin pagar (clic: marcar pagado)', 'aria-label': 'Pagado' }, SIMBOLO[c.estado]);
    const r = h('button', { type: 'button', class: 'pc-chk pc-r' + (c.recibo_hecho ? ' on' : ''), disabled: !editor, title: c.recibo_hecho ? 'Recibo hecho (clic: quitar)' : 'Recibo sin hacer (clic: marcar hecho)', 'aria-label': 'Recibo hecho' }, c.recibo_hecho ? '✓' : '');
    p.addEventListener('click', (e) => { e.stopPropagation(); aplicarA(a, ci, (l) => ponEstado(l, c.estado === 'pagado' ? 'pendiente' : 'pagado')); });
    r.addEventListener('click', (e) => { e.stopPropagation(); aplicarA(a, ci, (l) => ponRecibo(l, !c.recibo_hecho)); });
    td.append(imp, p, r);
  }
  const repintar = (lista) => { const ids = new Set(lista.map((c) => c.id)); for (const a of rows) COLS.forEach((_, ci) => { const c = cuotaDe(a, ci); if (c && ids.has(c.id)) pintaCelda(a, ci); }); pintarPie(); pintarKpis(); };

  // ---------- acciones (sobre una celda o sobre toda la selección) ----------
  const selCuotas = () => [...seleccion].map((k) => { const [id, ci] = k.split('|'); return cuotaPor.get(`${id}|${COLS[ci].c}|${COLS[ci].m}`); }).filter(Boolean);
  async function aplicarA(a, ci, fn) {
    const c = cuotaDe(a, ci); if (!c) return;
    const lista = seleccion.has(claveSel(a, ci)) && seleccion.size > 1 ? selCuotas() : [c];
    try { await fn(lista); } catch (ex) { toast(ex.message, 'error'); }
  }
  async function ponEstado(lista, estado) {
    const hechos = lista.filter((c) => c.estado !== estado); if (!hechos.length) return;
    const parche = { estado, fecha_pago: estado === 'pagado' ? hoyISO() : null };
    await api.updMany('ac_cuotas', hechos.map((c) => c.id), parche);
    hechos.forEach((c) => Object.assign(c, parche)); repintar(hechos); pintarBarra();
  }
  async function ponRecibo(lista, v) {
    const hechos = lista.filter((c) => !!c.recibo_hecho !== v); if (!hechos.length) return;
    await api.updMany('ac_cuotas', hechos.map((c) => c.id), { recibo_hecho: v });
    hechos.forEach((c) => { c.recibo_hecho = v; }); repintar(hechos); pintarBarra();
  }
  async function ponImporte(lista, valor) {
    await api.updMany('ac_cuotas', lista.map((c) => c.id), { importe: valor, importe_manual: true });
    lista.forEach((c) => { c.importe = valor; c.importe_manual = true; }); repintar(lista); pintarBarra();
  }
  async function crearCeldas() {
    const nuevas = [];
    for (const k of seleccion) {
      const [id, ci] = k.split('|'); const a = rows.find((x) => x.id === id); const col = COLS[ci];
      if (!a || cuotaPor.has(`${id}|${col.c}|${col.m}`)) continue;
      nuevas.push({ alumno_id: id, curso_id: curso.id, concepto: col.c, mes: col.m, importe: importeDefecto(a, col), metodo_pago: a.metodo_pago || null, nivel: col.c === 'welcome_pack' ? a.nivel || null : null });
    }
    if (!nuevas.length) return;
    const creadas = await api.insMany('ac_cuotas', nuevas, { onConflict: 'alumno_id,curso_id,concepto,mes', ignorar: true });
    for (const c of creadas) { cuotas.push(c); cuotaPor.set(`${c.alumno_id}|${c.concepto}|${c.mes}`, c); }
    for (const a of rows) COLS.forEach((_, ci) => { if (seleccion.has(claveSel(a, ci))) pintaCelda(a, ci); });
    pintarPie(); pintarKpis(); pintarBarra(); toast(`${creadas.length} cuota${creadas.length === 1 ? '' : 's'} creada${creadas.length === 1 ? '' : 's'}.`);
  }
  function editarInline(a, ci, span) {
    const c = cuotaDe(a, ci); if (!c) return;
    const inp = h('input', { type: 'text', inputmode: 'decimal', 'data-punto': '1', autocomplete: 'off', step: '0.01', class: 'pc-edit', value: c.importe, 'aria-label': 'Importe' });
    let hecho = false;
    const fin = async (guardar) => {
      if (hecho) return; hecho = true;
      const v = Number(inp.value);
      if (guardar && inp.value !== '' && !Number.isNaN(v) && v !== Number(c.importe)) { try { await ponImporte([c], v); return; } catch (ex) { toast(ex.message, 'error'); } }
      pintaCelda(a, ci);
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') { e.stopPropagation(); fin(false); } });
    inp.addEventListener('blur', () => fin(true)); inp.addEventListener('mousedown', (e) => e.stopPropagation());
    span.replaceWith(inp); inp.focus(); inp.select();
  }
  function pedirImporte(lista) {
    const d = drawer({ titulo: `Cambiar importe de ${lista.length} cuota${lista.length === 1 ? '' : 's'}`, ancho: 380 });
    const n = numero(lista.length === 1 ? lista[0].importe : '', { placeholder: '€' });
    d.cuerpo.append(h('label', { class: 'field' }, h('span', {}, 'Nuevo importe (€)'), n), h('p', { class: 'small muted' }, 'Queda marcado como importe manual: ni el cambio de nivel ni los precios del welcome pack lo vuelven a tocar. Vale también para cuotas ya pagadas.'));
    d.pie.append(h('span'), guardarBoton('Aplicar', async () => {
      if (n.value === '' || Number.isNaN(Number(n.value))) { toast('Escribe un importe.', 'error'); return; }
      try { await ponImporte(lista, Number(n.value)); d.cerrar(); } catch (ex) { toast(ex.message, 'error'); }
    }));
    setTimeout(() => n.focus(), 50);
  }

  // ---------- barra inferior de selección ----------
  const barra = h('div', { class: 'ac-pg-barra', hidden: true });
  function pintarBarra() {
    const l = selCuotas(); const vacias = seleccion.size - l.length;
    barra.hidden = !seleccion.size;
    if (!seleccion.size) return;
    const b = (t, fn, cls = '') => h('button', { type: 'button', class: 'btn small ' + cls, disabled: !editor, onclick: async () => { try { await fn(); } catch (ex) { toast(ex.message, 'error'); } } }, t);
    clear(barra,
      h('strong', {}, `${seleccion.size} celda${seleccion.size === 1 ? '' : 's'}`), h('span', { class: 'muted small' }, ` · ${fmtEUR2(l.reduce((s, c) => s + Number(c.importe), 0))}${vacias ? ` · ${vacias} sin cuota` : ''}`),
      l.length ? [b('Pagado', () => ponEstado(l, 'pagado'), 'primary'), b('Sin pagar', () => ponEstado(l, 'pendiente')), b('Recibo hecho', () => ponRecibo(l, true)), b('Sin recibo', () => ponRecibo(l, false)),
        b('Devuelto', () => ponEstado(l, 'devuelto')), b('Exento', () => ponEstado(l, 'exento')), b('Importe…', () => pedirImporte(l))] : null,
      vacias ? b(`Crear ${vacias} cuota${vacias === 1 ? '' : 's'}`, crearCeldas) : null,
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => setSel(new Set()) }, 'Quitar selección (Esc)'));
  }

  // ---------- selección con el ratón ----------
  function setSel(nuevo) {
    const antes = new Set(seleccion); seleccion.clear(); nuevo.forEach((k) => seleccion.add(k));
    for (const k of new Set([...antes, ...seleccion])) if (antes.has(k) !== seleccion.has(k)) celdas.get(k)?.classList.toggle('sel', seleccion.has(k));
    pintarBarra();
  }
  const rect = (r1, c1, r2, c2) => { const s = new Set(); for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) if (rows[r]) s.add(claveSel(rows[r], c)); return s; };
  const posDe = (td) => ({ r: Number(td.dataset.r), c: Number(td.dataset.c) });
  const onUp = () => { arrastrando = false; };
  const onKey = (e) => { if (e.key === 'Escape' && seleccion.size && !document.querySelector('.overlay') && e.target.tagName !== 'INPUT') setSel(new Set()); };
  document.addEventListener('mouseup', onUp); document.addEventListener('keydown', onKey);
  const quitar = new MutationObserver(() => { if (!view.isConnected && !barra.isConnected) { document.removeEventListener('mouseup', onUp); document.removeEventListener('keydown', onKey); quitar.disconnect(); } });
  const zoomBox = h('span', { class: 'ac-zoom' });
  const cuerpo = h('tbody');
  cuerpo.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button,input,a')) return;
    const td = e.target.closest('td.ac-cel'); if (!td) return;
    const { r, c } = posDe(td); const k = claveSel(rows[r], c);
    if (e.shiftKey && ancla) setSel(rect(ancla.r, ancla.c, r, c));
    else if (e.ctrlKey || e.metaKey) { const n = new Set(seleccion); if (n.has(k)) n.delete(k); else n.add(k); ancla = { r, c }; setSel(n); }
    else { ancla = { r, c }; arrastrando = true; setSel(new Set([k])); }
    e.preventDefault();
  });
  cuerpo.addEventListener('mouseover', (e) => {
    if (!arrastrando) return; const td = e.target.closest('td.ac-cel'); if (!td) return;
    const { r, c } = posDe(td); setSel(rect(ancla.r, ancla.c, r, c));
  });

  // ---------- filtros y tabla ----------
  const modos = [...new Set(filasBase.map((a) => a.metodo_pago).filter(Boolean))].sort();
  const niveles = [...new Set(filasBase.map((a) => a.nivel).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'es', { numeric: true }));
  const txt = (x, y) => String(x || '').localeCompare(String(y || ''), 'es', { numeric: true });
  const porNombre = (x, y) => txt(x.apellidos, y.apellidos) || txt(x.nombre, y.nombre);
  function comparar(x, y) {
    const k = orden.k; let r = 0;
    if (k === 'num') r = Number(x.num || 1e9) - Number(y.num || 1e9);
    else if (k === 'nivel') r = txt(x.nivel, y.nivel);
    else if (k === 'modo') r = txt(x.metodo_pago, y.metodo_pago);
    else if (k === 'cuota') r = Number(inscPor.get(x.id)?.cuota_mensual || 0) - Number(inscPor.get(y.id)?.cuota_mensual || 0);
    else if (k.startsWith('c')) { const ci = Number(k.slice(1)); const rg = (a) => { const c = cuotaDe(a, ci); return c ? RANGO[c.estado] ?? 4 : 4; }; r = rg(x) - rg(y) || (Number(cuotaDe(x, ci)?.importe || 0) - Number(cuotaDe(y, ci)?.importe || 0)); }
    const o = esOtro(y) - esOtro(x); if (o) return o; // las filas 0.x siempre arriba, ordenadas por su número
    if (esOtro(x)) return Number(x.num) - Number(y.num);
    return (r || porNombre(x, y)) * (r ? orden.dir : 1);
  }
  const cabs = new Map();
  function ordenar(k) { orden.dir = orden.k === k ? -orden.dir : 1; orden.k = k; guardarOrden('pagos', { k: orden.k, dir: orden.dir }); pintarFlechas(); pintar(); }
  function pintarFlechas() { for (const [k, th] of cabs) { const fl = th.querySelector('.ac-fl'); fl.textContent = orden.k === k ? (orden.dir > 0 ? '▲' : '▼') : ''; th.setAttribute('aria-sort', orden.k === k ? (orden.dir > 0 ? 'ascending' : 'descending') : 'none'); } }
  function pintar() {
    const q = normalizar(f.q); const mi = MESES.indexOf(mesActual());
    rows = filasBase.filter((a) => (!q || normalizar(nombreAlumno(a)).includes(q) || String(a.num || '') === f.q.trim())
      && (!f.modo || a.metodo_pago === f.modo) && (!f.nivel || a.nivel === f.nivel)
      && (!f.soloPend || cuotas.some((c) => c.alumno_id === a.id && c.estado === 'pendiente' && (c.mes === '' || MESES.indexOf(c.mes) <= mi)))
      && (!f.recibo || cuotas.some((c) => c.alumno_id === a.id && c.estado === 'pagado' && !c.recibo_hecho)))
      .sort(comparar);
    celdas.clear(); seleccion.clear(); ancla = null; pintarBarra();
    clear(cuerpo, rows.map((a, r) => h('tr', {},
      h('td', { class: 'ac-id muted' }, a.num ? (esOtro(a) ? String(Number(a.num)) : String(Math.round(a.num))) : ''),
      h('td', { class: 'ac-nom', title: nombreFila(a) }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); abrirFicha(a, ctx, refrescar); } }, nombreFila(a))),
      h('td', { class: 'ac-niv', title: [a.modalidad, a.nivel].filter(Boolean).join(' · ') }, a.nivel || ''),
      modoPago(a),
      cuotaMensual(a),
      COLS.map((_, ci) => { const td = h('td', { class: 'ac-cel', 'data-r': String(r), 'data-c': String(ci) }); celdas.set(claveSel(a, ci), td); return td; }))));
    rows.forEach((a) => COLS.forEach((_, ci) => pintaCelda(a, ci)));
    if (!rows.length) clear(cuerpo, h('tr', {}, h('td', { colspan: 18, class: 'empty' }, 'No hay alumnos con estos filtros. Fija la cuota de cada alumno en su fila y genera las mensualidades.')));
  }
  // Modo de pago editable: cambia también la ficha del alumno (base de datos de Alumnos), así que pide permiso; si pasa a domiciliación, ofrece añadir sus cuotas pendientes a las remesas abiertas.
  const esDomi = (m) => /domicil|sepa|recibo/i.test(m || '');
  const MODOS = [...new Set([...(listas.metodo_pago || []), ...filasBase.map((x) => x.metodo_pago).filter(Boolean)])];
  function modoPago(a) {
    const td = h('td', { class: 'ac-modo', title: a.metodo_pago || '' });
    if (!editor || esOtro(a)) { td.textContent = a.metodo_pago || ''; return td; }
    const s = sel(MODOS.map((m) => [m, m]), a.metodo_pago || '', { vacio: '—', 'aria-label': `Modo de pago de ${nombreAlumno(a)}`, class: 'cell ac-modo-sel' });
    s.addEventListener('change', async () => {
      const nuevo = s.value || null; const antes = a.metodo_pago || null;
      if (nuevo === antes) return;
      if (!await confirmar({ titulo: 'Cambiar modo de pago', texto: `${nombreAlumno(a)}: de «${antes || 'sin modo'}» a «${nuevo || 'sin modo'}». Esto también cambia su ficha en Alumnos (es el mismo dato). ¿Continuar?`, ok: 'Cambiar' })) { s.value = antes || ''; return; }
      try {
        Object.assign(a, await api.upd('ac_alumnos', a.id, { metodo_pago: nuevo })); td.title = nuevo || '';
        toast('Modo de pago actualizado también en Alumnos.');
        if (esDomi(nuevo) && !esDomi(antes)) await ofrecerRemesas(a);
      } catch (ex) { s.value = antes || ''; toast(ex.message, 'error'); }
    });
    td.append(s); return td;
  }
  async function ofrecerRemesas(a) {
    const pend = cuotas.filter((c) => c.alumno_id === a.id && c.concepto === 'mensualidad' && c.estado === 'pendiente' && !c.remesa_id && Number(c.importe) > 0);
    if (!pend.length) return;
    const abierta = (mes) => remesas.find((r) => r.mes === mes && r.estado === 'borrador');
    const metibles = pend.filter((c) => abierta(c.mes)); const sinRem = [...new Set(pend.filter((c) => !abierta(c.mes)).map((c) => c.mes))];
    if (!metibles.length) { toast(`No hay remesa abierta (en borrador) para ${sinRem.join(', ')}: créala en Remesas y luego añade sus cargos.`); return; }
    const total = metibles.reduce((t, c) => t + Number(c.importe), 0);
    const texto = `Ahora es domiciliación. ¿Añado sus ${metibles.length} cuota${metibles.length === 1 ? '' : 's'} pendiente${metibles.length === 1 ? '' : 's'} (${fmtEUR2(total)}) a las remesas abiertas de ${[...new Set(metibles.map((c) => c.mes))].join(', ')}?${sinRem.length ? ` Sin remesa abierta: ${sinRem.join(', ')} (se quedan sin remesa).` : ''}`;
    if (!await confirmar({ titulo: 'Añadir a remesas', texto, ok: 'Añadir a remesas' })) return;
    for (const mes of new Set(metibles.map((c) => c.mes))) { const r = abierta(mes); const ids = metibles.filter((c) => c.mes === mes).map((c) => c.id); await api.updMany('ac_cuotas', ids, { remesa_id: r.id }); metibles.filter((c) => c.mes === mes).forEach((c) => { c.remesa_id = r.id; }); }
    rows.forEach((x) => COLS.forEach((_, ci) => pintaCelda(x, ci))); toast('Cuotas añadidas a las remesas.');
  }
  function cuotaMensual(a) {
    const i = inscPor.get(a.id);
    const inp = h('input', { type: 'text', inputmode: 'decimal', 'data-punto': '1', autocomplete: 'off', step: '0.01', class: 'cell ac-imp', value: i?.cuota_mensual || '', disabled: !editor, title: 'Cuota mensual pactada (las cuotas ya generadas no cambian: selecciónalas y usa «Importe…»)', 'aria-label': `Cuota de ${nombreAlumno(a)}` });
    inp.addEventListener('change', async () => {
      const v = Number(inp.value || 0);
      try {
        if (i) Object.assign(i, await api.upd('ac_inscripciones', i.id, { cuota_mensual: v }));
        else inscPor.set(a.id, await api.ins('ac_inscripciones', { alumno_id: a.id, curso_id: curso.id, cuota_mensual: v }));
        inp.classList.add('saved'); setTimeout(() => inp.classList.remove('saved'), 800);
        { // el servidor deja una nota en la cuota del mes en curso si aún no está pagada
          const nuevas = await api.cuotas(curso.id); let avisos = 0;
          for (const n of nuevas) { const c = cuotaPor.get(`${n.alumno_id}|${n.concepto}|${n.mes}`); if (c && n.nota_cambio !== c.nota_cambio) { Object.assign(c, n); avisos++; } }
          if (avisos) { toast('Cuota cambiada: se ha dejado una nota en el cargo de este mes para cuadrar importes.'); rows.forEach((x) => COLS.forEach((_, ci) => pintaCelda(x, ci))); }
        }
      } catch (ex) { toast(ex.message, 'error'); }
    });
    return h('td', { class: 'num' }, inp);
  }

  // ---------- cabecera ----------
  const mesSel = sel(MESES.map((m) => [m, capitalizar(m)]), mesActual());
  const btnGen = h('button', { class: 'btn small', type: 'button', disabled: !editor, onclick: async () => {
    try { const n = await api.generarCuotas(curso.id, mesSel.value); toast(n ? `${n} mensualidades de ${mesSel.value} creadas.` : `No faltaba ninguna cuota de ${mesSel.value}.`); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
  } }, 'Generar mensualidad');
  const btnWp = h('button', { class: 'btn small', type: 'button', disabled: !editor, onclick: async () => {
    const filas = insc.filter((i) => i.activa).map((i) => { const a = alumnos.find((x) => x.id === i.alumno_id); const imp = a ? precioWp(a) ?? Number(i.welcome_pack) : Number(i.welcome_pack); return { alumno_id: i.alumno_id, curso_id: curso.id, concepto: 'welcome_pack', mes: '', importe: imp, nivel: a?.nivel || null }; }).filter((x) => x.importe > 0);
    try { const r = await api.insMany('ac_cuotas', filas, { onConflict: 'alumno_id,curso_id,concepto,mes', ignorar: true }); toast(r.length ? `${r.length} welcome packs creados.` : 'Todos los welcome packs ya estaban creados.'); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
  } }, 'Generar welcome pack');
  const btnPrecios = h('button', { class: 'btn small', type: 'button', onclick: () => abrirPrecios() }, 'Precios WP por nivel');
  function abrirPrecios() {
    const d = drawer({ titulo: `Welcome pack por nivel · ${curso.nombre}`, ancho: 420 });
    const nivs = [...new Set([...niveles, ...precios.map((p) => p.nivel)])].sort((x, y) => x.localeCompare(y, 'es', { numeric: true }));
    const campos = nivs.map((n) => { const p = precios.find((x) => norm(x.nivel) === norm(n)); return { n, p, inp: numero(p?.importe ?? '', { placeholder: '—', disabled: !editor }) }; });
    const nuevoN = h('input', { type: 'text', placeholder: 'Nuevo nivel (p. ej. Level 3)' }); const nuevoI = numero('', { placeholder: '€' });
    d.cuerpo.append(h('p', { class: 'small muted' }, 'El welcome pack depende del nivel del alumno. Al cambiar de nivel, su WP sin pagar pasa al precio del nuevo nivel; uno ya pagado no cambia nunca. Al guardar un precio se actualizan los WP sin pagar de ese nivel (salvo importes manuales).'),
      h('div', { class: 'ac-pg-precios' }, campos.map((c) => h('label', { class: 'field' }, h('span', {}, c.n), c.inp)), editor ? h('div', { class: 'ac-pg-nuevo' }, nuevoN, nuevoI) : null));
    d.pie.append(h('span'), guardarBoton('Guardar precios', async () => {
      try {
        const todos = campos.map((c) => ({ n: c.n, p: c.p, v: c.inp.value })); if (nuevoN.value.trim() && nuevoI.value !== '') todos.push({ n: nuevoN.value.trim(), p: null, v: nuevoI.value });
        for (const x of todos) {
          if (x.v === '' || Number.isNaN(Number(x.v)) || (x.p && Number(x.p.importe) === Number(x.v))) continue;
          if (x.p) await api.upd('ac_wp_precios', x.p.id, { importe: Number(x.v) }); else await api.ins('ac_wp_precios', { curso_id: curso.id, nivel: x.n, importe: Number(x.v) });
        }
        toast('Precios guardados.'); d.cerrar(); refrescar();
      } catch (ex) { toast(ex.message, 'error'); }
    }));
  }

  const th = (k, t, cls, extra) => { const el = h('th', { class: 'ac-ord ' + (cls || ''), title: 'Clic para ordenar', onclick: () => ordenar(k) }, t, h('span', { class: 'ac-fl' }), extra || null); cabs.set(k, el); return el; };
  const tb = h('table', { class: 'data ac-pg' },
    h('colgroup', {}, ['38px', '210px', '60px', '96px', '54px'].map((w) => h('col', { style: `width:${w}` })), COLS.map(() => h('col'))),
    h('thead', {}, resumen, h('tr', {}, th('num', 'ID'), th('nombre', 'Alumno', 'l'), th('nivel', 'Nivel'), th('modo', 'Modo pago'), th('cuota', 'Cuota'),
      COLS.map((k, ci) => th('c' + ci, k.t, 'ac-mes', h('div', { class: 'ac-sub' }, '€ · P · R'))))), cuerpo);
  pintarFlechas();
  if (f.modo && !modos.includes(f.modo)) f.modo = '';
  if (f.nivel && !niveles.includes(f.nivel)) f.nivel = '';
  const ctlQ = vincular(f, 'q', h('input', { type: 'search', placeholder: 'Buscar alumno o ID…', oninput: (e) => { f.q = e.target.value; pintar(); } }));
  const ctlModo = vincular(f, 'modo', sel([['', 'Todos los modos de pago'], ...modos.map((m) => [m, m])], f.modo, { onchange: (e) => { f.modo = e.target.value; pintar(); } }));
  const ctlNivel = vincular(f, 'nivel', sel([['', 'Todos los niveles'], ...niveles.map((n) => [n, n])], f.nivel, { onchange: (e) => { f.nivel = e.target.value; pintar(); } }));
  const ctlRecibo = vincular(f, 'recibo', sel([['', 'Todos los recibos'], ['sin', 'Cobrados sin recibo hecho']], f.recibo, { onchange: (e) => { f.recibo = e.target.value; pintar(); } }));
  const ctlPend = vincular(f, 'soloPend', h('input', { type: 'checkbox', onchange: (e) => { f.soloPend = e.target.checked; pintar(); } }));
  const aviso = avisoFiltros(f, { claves: ['q', 'modo', 'nivel', 'recibo', 'soloPend'],
    etiquetas: { q: 'Búsqueda', modo: 'Modo de pago', nivel: 'Nivel', recibo: 'Recibos', soloPend: 'Solo con pagos pendientes hasta este mes' },
    formato: { q: busqueda, recibo: (v) => (v ? 'cobrados sin recibo hecho' : '') }, alLimpiar: () => pintar() });
  pintar(); pintarPie(); pintarKpis();
  clear(view,
    cabecera(`Pagos · ${curso.nombre}`, 'Por mes: cuantía · P (pagado) · R (recibo hecho). Arrastra o usa Ctrl/Mayús+clic para elegir varias celdas.', mesSel, btnGen, btnWp, btnPrecios, zoomBox, h('a', { class: 'btn small', href: '#/ac_pagos_importar' }, 'Importar del CRM'), ctx.veAlgo('fact') ? h('a', { class: 'btn small', href: '#/ingresos', title: 'El cuadro de Ingresos se rellena con los pagos marcados aquí' }, 'Ver Resumen de Pagos →') : null),
    sinInsc ? h('div', { class: 'banner warn' }, `${sinInsc} alumnos inscritos todavía no tienen cuota fijada en este curso: escribe su cuota en la fila (si no aparecen aquí, ábrelos desde Alumnos).`) : null,
    kpisEl,
    h('div', { class: 'filters filters-4' }, ctlQ, ctlModo, ctlNivel, ctlRecibo),
    h('label', { class: 'check ac-pg-chk' }, ctlPend, ' Solo con pagos pendientes hasta este mes'),
    aviso,
    h('div', { class: 'table-wrap card-tabla ac-pg-wrap' }, tb), barra);
  quitar.observe(document.body, { childList: true, subtree: true });
  // zoom de la tabla (botones, Ctrl+rueda); se recuerda en este navegador
  let zoom = Number((() => { try { return localStorage.getItem('ac_pagos_zoom'); } catch { return null; } })()) || 1;
  const aplicarZoom = (z) => { zoom = Math.min(1.8, Math.max(0.6, Math.round(z * 100) / 100)); tb.style.zoom = zoom; zoomEt.textContent = Math.round(zoom * 100) + '%'; try { localStorage.setItem('ac_pagos_zoom', String(zoom)); } catch { /* sin almacenamiento */ } };
  const zoomEt = h('span', { class: 'ac-zoom-et', title: 'Clic: 100%', onclick: () => aplicarZoom(1) });
  zoomBox.append(h('button', { type: 'button', class: 'btn small', title: 'Alejar (Ctrl+rueda)', onclick: () => aplicarZoom(zoom - 0.1) }, '−'), zoomEt, h('button', { type: 'button', class: 'btn small', title: 'Acercar (Ctrl+rueda)', onclick: () => aplicarZoom(zoom + 0.1) }, '+'));
  tb.parentElement.addEventListener('wheel', (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); aplicarZoom(zoom + (e.deltaY < 0 ? 0.1 : -0.1)); }, { passive: false });
  aplicarZoom(zoom);
}
