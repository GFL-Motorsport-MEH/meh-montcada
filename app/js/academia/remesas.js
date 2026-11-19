// Remesas: listado de domiciliaciones (como la hoja «Domiciliaciones» del Excel Control Alumnos).
// Una línea por alumno que paga por domiciliación, con su remesa (Sabadell 1–21 de hasta 20 cobros, BBVA con nombre), el importe
// de su cuota (resaltado si cambió entre el día 5 y el 25 del mes), el comentario y la referencia de mandato.
// Arriba, el resumen de remesas y el botón «REMESAS ENVIADAS - mes X», que guarda lo enviado al banco para comparar cuando entren los pagos.
import { h, clear, cargando, toast, confirmar, fmtEUR2, fmtFecha, hoyISO, normalizar, MESES, capitalizar, descargarCSV } from '../ui.js';
import * as api from './api.js';
import { cabecera, pill, sel, nombreAlumno } from './kit.js';

const esDomi = (m) => /domicil|sepa|recibo/i.test(m || '');
const NOMBRES_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// el mes que se envía al banco es el siguiente al actual (en octubre se envían las de noviembre)
const mesSiguiente = () => NOMBRES_MES[(new Date().getMonth() + 1) % 12];
const BANCOS = [['SABADELL', 'Sabadell Montcada'], ['BBVA', 'BBVA']];
const nombreBanco = (b) => (b === 'BBVA' ? 'BBVA' : 'Sabadell');
const cmp2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmtDif = (d) => (Math.abs(d) < 0.005 ? '0,00 €' : `${d > 0 ? '+' : ''}${fmtEUR2(d)}`);

export async function renderRemesas(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const editor = ctx.edita('ac_remesas') || ctx.edita('ac_pagos');
  const [lista0, doms0, alumnos, insc, cambios, envios0] = await Promise.all([api.remesasLista(), api.domiciliaciones(), api.alumnos(), api.inscripciones(curso.id), api.cuotaCambios(curso.id), api.remesaEnvios(curso.id)]);
  let lista = [...lista0]; let doms = [...doms0]; let envios = [...envios0];
  const alPor = new Map(alumnos.map((a) => [a.id, a]));
  const inscPor = new Map(insc.map((i) => [i.alumno_id, i]));
  const respIds = [...new Set(alumnos.filter((a) => a.responsable_id && (esDomi(a.metodo_pago) || doms.some((d) => d.alumno_id === a.id))).map((a) => a.responsable_id))];
  const priv = new Map();
  try { for (let i = 0; i < respIds.length; i += 100) for (const p of await api.privados(respIds.slice(i, i + 100))) priv.set(p.responsable_id, p); } catch { /* sin permiso de IBAN: se ven vacíos */ }

  // cambios de cuota del mes en curso entre el día 5 y el 25
  const hoy = hoyISO(); const mesHoy = hoy.slice(0, 7);
  const cambiosPor = new Map();
  for (const c of cambios) {
    if (!c.fecha || c.fecha.slice(0, 7) !== mesHoy) continue;
    const dia = Number(c.fecha.slice(8, 10)); if (dia < 5 || dia > 25) continue;
    if (!cambiosPor.has(c.alumno_id)) cambiosPor.set(c.alumno_id, []);
    cambiosPor.get(c.alumno_id).push(c);
  }

  const f = { q: '', remesa: '', banco: '', soloCambios: false, soloAvisos: false, envioId: '' };
  const envioOrden = () => [...envios].sort((a, b) => (b.enviado_el || '').localeCompare(a.enviado_el || ''));
  f.envioId = envioOrden()[0]?.id || '';
  let lineasEnvio = new Map(); // domiciliacion_id → importe enviado (solo si el envío guardó líneas)

  const remPor = () => new Map(lista.map((r) => [r.id, r]));
  const filasDe = () => {
    const rp = remPor();
    const out = doms.filter((d) => alPor.has(d.alumno_id)).map((d) => ({ dom: d, a: alPor.get(d.alumno_id) }));
    const con = new Set(doms.map((d) => d.alumno_id));
    for (const a of alumnos) if (a.estado === 'inscrito' && esDomi(a.metodo_pago) && !con.has(a.id)) out.push({ dom: null, a });
    for (const x of out) { x.rem = x.dom?.remesa_id ? rp.get(x.dom.remesa_id) : null; x.importe = Number(inscPor.get(x.a.id)?.cuota_mensual || 0); }
    return out.sort((x, y) => (x.rem ? x.rem.orden : 9999) - (y.rem ? y.rem.orden : 9999) || Number(x.a.num) - Number(y.a.num));
  };
  const cuentaRemesa = (filas, r) => filas.filter((x) => x.rem?.id === r.id && x.a.estado === 'inscrito');
  const avisosDe = (x) => {
    const av = [];
    if (!x.dom?.remesa_id) av.push('Sin remesa');
    if (x.a.estado !== 'inscrito') av.push('Alumno no inscrito: revisar');
    else if (!esDomi(x.a.metodo_pago)) av.push(`Método de pago: ${x.a.metodo_pago || 'vacío'}`);
    if (!priv.get(x.a.responsable_id)?.iban) av.push('Sin IBAN');
    if (!x.importe) av.push('Sin cuota');
    return av;
  };

  const resumenEl = h('div'); const gestionEl = h('div'); const listaEl = h('div'); const statsEl = h('div', { class: 'count' });
  let filas = filasDe();

  // ---------- resumen de remesas ----------
  async function cargarLineas() {
    lineasEnvio = new Map();
    if (!f.envioId) return;
    try { const l = await api.remesaEnvioLineas(f.envioId); for (const x of l) if (x.domiciliacion_id) lineasEnvio.set(x.domiciliacion_id, Number(x.importe)); } catch { /* sin líneas */ }
  }
  function pintarResumen() {
    const env = envios.find((e) => e.id === f.envioId);
    const guardado = new Map((env?.resumen || []).map((r) => [r.remesa_nombre, r]));
    const envSel = sel(envioOrden().map((e) => [e.id, `${capitalizar(e.mes)} · enviado ${fmtFecha((e.enviado_el || '').slice(0, 10))}`]), f.envioId, { vacio: envios.length ? '— sin comparar —' : 'Aún no hay envíos guardados' });
    envSel.addEventListener('change', async () => { f.envioId = envSel.value; await cargarLineas(); pintarResumen(); pintarLista(); });
    let tActual = 0; let tGuardado = 0; let nActual = 0;
    const lineas = lista.map((r) => {
      const l = cuentaRemesa(filas, r); const total = cmp2(l.reduce((s, x) => s + x.importe, 0)); const g = guardado.get(r.nombre);
      const llena = r.capacidad && l.length > r.capacidad;
      tActual += total; nActual += l.length; tGuardado += Number(g?.total || 0);
      const dif = g ? cmp2(total - Number(g.total)) : null;
      const ok = h('input', { type: 'checkbox', checked: !!g?.ok, disabled: !g || !editor, title: g ? 'Revisado: lo que entró en el banco coincide' : 'Solo en remesas del envío guardado' });
      ok.addEventListener('change', async () => { try { Object.assign(g, await api.upd('ac_remesa_envio_resumen', g.id, { ok: ok.checked })); } catch (ex) { ok.checked = !ok.checked; toast(ex.message, 'error'); } });
      const nota = h('input', { type: 'text', class: 'cell', value: g?.nota || '', disabled: !g || !editor, placeholder: g ? 'Nota…' : '', style: 'width:100%;min-width:140px' });
      nota.addEventListener('change', async () => { try { Object.assign(g, await api.upd('ac_remesa_envio_resumen', g.id, { nota: nota.value.trim() || null })); toast('Nota guardada'); } catch (ex) { toast(ex.message, 'error'); } });
      return h('tr', {},
        h('td', {}, h('strong', {}, r.nombre)), h('td', {}, pill(nombreBanco(r.banco), r.banco === 'BBVA' ? 'ok' : 'warn')),
        h('td', { class: 'num' }, llena ? h('span', { class: 'pill warn', title: `Pasa de ${r.capacidad} cobros` }, `${l.length}/${r.capacidad}`) : (r.capacidad ? `${l.length}/${r.capacidad}` : String(l.length))),
        h('td', { class: 'num' }, fmtEUR2(total)),
        h('td', { class: 'num' }, g ? fmtEUR2(g.total) : '—'),
        h('td', { class: `num ${dif && Math.abs(dif) >= 0.005 ? 'ac-dif' : ''}` }, dif === null ? '' : fmtDif(dif)),
        h('td', { class: 'center' }, ok), h('td', {}, nota));
    });
    const sinRem = filas.filter((x) => !x.rem && x.a.estado === 'inscrito' && esDomi(x.a.metodo_pago));
    clear(resumenEl, h('div', { class: 'card', style: 'padding:10px;margin-bottom:12px' },
      h('div', { class: 'ac-fila', style: 'justify-content:space-between;margin-bottom:6px' }, h('strong', {}, 'Resumen de remesas'), h('label', { class: 'small muted' }, 'Comparar con el envío de ', envSel)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, ['Remesa', 'Banco', 'Cobros', 'Suma actual', 'Suma enviada', 'Diferencia', 'OK', 'Nota'].map((t, i) => h('th', { class: [2, 3, 4, 5].includes(i) ? 'num' : '' }, t)))),
        h('tbody', {}, lineas),
        h('tfoot', {}, h('tr', {}, h('th', { colspan: 2 }, 'Total'), h('th', { class: 'num' }, String(nActual)), h('th', { class: 'num' }, fmtEUR2(tActual)), h('th', { class: 'num' }, env ? fmtEUR2(tGuardado) : ''), h('th', { class: 'num' }, env ? fmtDif(cmp2(tActual - tGuardado)) : ''), h('th', {}), h('th', {}, sinRem.length ? `${sinRem.length} alumnos domiciliados sin remesa (${fmtEUR2(sinRem.reduce((s, x) => s + x.importe, 0))})` : '')))))));
  }

  // ---------- gestionar remesas ----------
  function pintarGestion() {
    const nombre = h('input', { type: 'text', placeholder: 'Nombre (p. ej. 22 o BBVA 7 - VIER)', style: 'min-width:220px' });
    const banco = sel(BANCOS, 'SABADELL');
    const cap = h('input', { type: 'number', min: '1', placeholder: 'Máx. cobros', value: '20', style: 'width:100px' });
    banco.addEventListener('change', () => { cap.value = banco.value === 'SABADELL' ? '20' : ''; });
    const anadir = h('button', { class: 'btn primary small', type: 'button', disabled: !editor, onclick: async () => {
      const n = nombre.value.trim();
      if (!n) { toast('Escribe el nombre de la remesa', 'error'); return; }
      if (lista.some((r) => normalizar(r.nombre) === normalizar(n))) { toast('Ya existe una remesa con ese nombre', 'error'); return; }
      const mismos = lista.filter((r) => r.banco === banco.value).map((r) => r.orden);
      const orden = mismos.length ? Math.max(...mismos) + 1 : (banco.value === 'BBVA' ? 101 : 1);
      try { const r = await api.ins('ac_remesas_lista', { nombre: n, banco: banco.value, capacidad: cap.value ? Number(cap.value) : null, orden }); lista.push(r); lista.sort((a, b) => a.orden - b.orden); toast(`Remesa «${n}» añadida`); pintarTodo(); } catch (ex) { toast(ex.message, 'error'); }
    } }, 'Añadir remesa');
    const filasR = lista.map((r) => {
      const n = doms.filter((d) => d.remesa_id === r.id).length;
      const nom = h('input', { type: 'text', value: r.nombre, disabled: !editor, style: 'width:180px' });
      nom.addEventListener('change', async () => { const v = nom.value.trim(); if (!v || v === r.nombre) { nom.value = r.nombre; return; }
        try { Object.assign(r, await api.upd('ac_remesas_lista', r.id, { nombre: v })); toast('Nombre cambiado'); pintarResumen(); pintarLista(); } catch (ex) { nom.value = r.nombre; toast(ex.message, 'error'); } });
      const cp = h('input', { type: 'number', min: '1', value: r.capacidad ?? '', disabled: !editor, style: 'width:80px' });
      cp.addEventListener('change', async () => { try { Object.assign(r, await api.upd('ac_remesas_lista', r.id, { capacidad: cp.value ? Number(cp.value) : null })); pintarResumen(); } catch (ex) { toast(ex.message, 'error'); } });
      const bor = h('button', { class: 'btn danger small', type: 'button', disabled: !editor, onclick: async () => {
        if (!await confirmar({ titulo: `Eliminar la remesa ${r.nombre}`, texto: n ? `Sus ${n} líneas quedan «Sin remesa» (no se borra a nadie del listado).` : 'La remesa está vacía.', ok: 'Eliminar', peligro: true })) return;
        try { await api.del('ac_remesas_lista', r.id); lista = lista.filter((x) => x.id !== r.id); doms = doms.map((d) => (d.remesa_id === r.id ? { ...d, remesa_id: null } : d)); toast('Remesa eliminada'); pintarTodo(); } catch (ex) { toast(ex.message, 'error'); }
      } }, 'Eliminar');
      return h('tr', {}, h('td', {}, nom), h('td', {}, pill(nombreBanco(r.banco), r.banco === 'BBVA' ? 'ok' : 'warn')), h('td', { class: 'num' }, cp), h('td', { class: 'num' }, String(n)), h('td', {}, bor));
    });
    clear(gestionEl, h('details', { class: 'card', style: 'padding:10px;margin-bottom:12px' },
      h('summary', { style: 'cursor:pointer;font-weight:600' }, 'Gestionar remesas (añadir, renombrar, eliminar)'),
      h('div', { class: 'ac-fila', style: 'margin:10px 0;gap:8px;flex-wrap:wrap' }, nombre, banco, cap, anadir),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Remesa', 'Banco', 'Máx. cobros', 'Líneas', ''].map((t, i) => h('th', { class: [2, 3].includes(i) ? 'num' : '' }, t)))), h('tbody', {}, filasR)))));
  }

  // ---------- listado ----------
  function visibles() {
    const q = normalizar(f.q.trim());
    return filas.filter((x) => {
      if (f.remesa === '__sin' && x.rem) return false;
      if (f.remesa && f.remesa !== '__sin' && x.rem?.id !== f.remesa) return false;
      if (f.banco && x.rem?.banco !== f.banco) return false;
      if (f.soloCambios && !cambiosPor.has(x.a.id)) return false;
      if (f.soloAvisos && !avisosDe(x).length) return false;
      if (q) { const r = x.a.responsable; if (!normalizar(`${x.a.num} ${nombreAlumno(x.a)} ${r ? r.apellidos + ' ' + r.nombre : ''} ${x.dom?.comentario || ''} ${x.rem?.nombre || ''}`).includes(q)) return false; }
      return true;
    });
  }
  async function guardarDom(x, parche) {
    if (x.dom) { Object.assign(x.dom, await api.upd('ac_domiciliaciones', x.dom.id, parche)); }
    else { x.dom = await api.ins('ac_domiciliaciones', { alumno_id: x.a.id, ...parche }); doms.push(x.dom); }
    const rp = remPor(); x.rem = x.dom.remesa_id ? rp.get(x.dom.remesa_id) : null;
  }
  const opcionesRemesa = () => { const fl = filasDe(); return lista.map((r) => [r.id, `${r.nombre} (${cuentaRemesa(fl, r).length}${r.capacidad ? '/' + r.capacidad : ''})`]); };
  function pintarLista() {
    const vis = visibles(); const rows = [];
    const opc = opcionesRemesa();
    for (const x of vis) {
      const resp = x.a.responsable; const iban = priv.get(x.a.responsable_id)?.iban || '';
      const camb = cambiosPor.get(x.a.id);
      const enviado = x.dom ? lineasEnvio.get(x.dom.id) : undefined;
      const distinto = enviado !== undefined && Math.abs(enviado - x.importe) >= 0.005;
      const av = avisosDe(x);
      const selR = sel(opc, x.dom?.remesa_id || '', { vacio: '— sin remesa —', disabled: !editor, 'aria-label': 'Remesa' });
      selR.className = x.dom?.remesa_id ? '' : 'ac-sin-remesa';
      selR.addEventListener('change', async () => {
        const r = lista.find((l) => l.id === selR.value);
        if (r?.capacidad && cuentaRemesa(filasDe(), r).length >= r.capacidad && !await confirmar({ titulo: `Remesa ${r.nombre} llena`, texto: `Ya tiene ${r.capacidad} cobros (máximo). ¿Añadir uno más?`, ok: 'Añadir igualmente' })) { selR.value = x.dom?.remesa_id || ''; return; }
        try { await guardarDom(x, { remesa_id: selR.value || null }); selR.className = x.dom?.remesa_id ? '' : 'ac-sin-remesa'; filas = filasDe(); pintarResumen(); pintarStats(); } catch (ex) { selR.value = x.dom?.remesa_id || ''; toast(ex.message, 'error'); }
      });
      const com = h('input', { type: 'text', class: 'cell', value: x.dom?.comentario || '', disabled: !editor, style: 'width:100%;min-width:180px', 'aria-label': 'Comentario' });
      com.addEventListener('change', async () => { try { await guardarDom(x, { comentario: com.value.trim() || null }); toast('Comentario guardado'); } catch (ex) { toast(ex.message, 'error'); } });
      const man = h('input', { type: 'text', class: 'cell', value: x.dom?.ref_mandato || '', placeholder: String(x.a.num), disabled: !editor, style: 'width:70px', 'aria-label': 'Referencia de mandato' });
      man.addEventListener('change', async () => { try { await guardarDom(x, { ref_mandato: man.value.trim() || null }); } catch (ex) { toast(ex.message, 'error'); } });
      const acciones = h('span', { class: 'ac-fila', style: 'gap:4px' },
        h('button', { class: 'btn ghost small', type: 'button', disabled: !editor || !x.dom, title: 'Otra línea del mismo alumno (por ejemplo 1 a 1 + grupo)', onclick: async () => { try { const d = await api.ins('ac_domiciliaciones', { alumno_id: x.a.id, remesa_id: x.dom.remesa_id }); doms.push(d); filas = filasDe(); pintarLista(); pintarResumen(); } catch (ex) { toast(ex.message, 'error'); } } }, '＋'),
        h('button', { class: 'btn ghost small', type: 'button', disabled: !editor || !x.dom, title: 'Quitar esta línea del listado', onclick: async () => {
          if (!await confirmar({ titulo: 'Quitar del listado', texto: `${nombreAlumno(x.a)} sale de la remesa ${x.rem?.nombre || ''}. Si sigue con método de pago Domiciliación, volverá a aparecer «Sin remesa».`, ok: 'Quitar', peligro: true })) return;
          try { await api.del('ac_domiciliaciones', x.dom.id); doms = doms.filter((d) => d.id !== x.dom.id); filas = filasDe(); pintarLista(); pintarResumen(); toast('Línea quitada'); } catch (ex) { toast(ex.message, 'error'); } } }, '✕'));
      const tdImp = h('td', { class: `num ${camb ? 'ac-cuota-cambio' : ''}`, title: camb ? 'Cuota cambiada este mes (entre el 5 y el 25): ' + camb.map((c) => `${fmtEUR2(c.anterior)} → ${fmtEUR2(c.nueva)} el ${fmtFecha(c.fecha)}`).join(' · ') : null },
        fmtEUR2(x.importe), distinto ? h('div', { class: 'small ac-dif' }, `enviado ${fmtEUR2(enviado)}`) : null);
      rows.push(h('tr', { class: x.a.estado !== 'inscrito' ? 'ac-baja' : '' },
        h('td', { class: 'num' }, String(x.a.num)),
        h('td', {}, nombreAlumno(x.a), av.filter((t) => t !== 'Sin remesa').length ? h('span', { class: 'pill warn', style: 'margin-left:6px', title: av.filter((t) => t !== 'Sin remesa').join(' · ') }, '⚠') : null),
        h('td', {}, resp ? `${resp.apellidos}, ${resp.nombre}` : '—'),
        h('td', { class: 'mono' }, iban || h('span', { class: 'muted' }, 'sin IBAN')),
        tdImp, h('td', {}, com), h('td', {}, man), h('td', {}, selR), h('td', {}, acciones)));
    }
    clear(listaEl, vis.length ? h('div', { class: 'table-wrap card-tabla' }, h('table', { class: 'data ac-domi' },
      h('thead', {}, h('tr', {}, ['ID', 'Alumno', 'Responsable', 'IBAN', 'Importe', 'Comentarios', 'Mandato', 'Remesa', ''].map((t, i) => h('th', { class: i === 4 ? 'num' : '' }, t)))),
      h('tbody', {}, rows))) : h('div', { class: 'card empty' }, 'No hay líneas con esos filtros.'));
    pintarStats();
  }
  function pintarStats() {
    const vis = visibles();
    const total = cmp2(vis.filter((x) => x.a.estado === 'inscrito').reduce((s, x) => s + x.importe, 0));
    const aviso = filas.filter((x) => avisosDe(x).filter((t) => t !== 'Sin remesa').length).length;
    statsEl.textContent = `${vis.length} líneas · ${fmtEUR2(total)}${cambiosPor.size ? ` · ${cambiosPor.size} con cuota cambiada este mes (5–25)` : ''}${aviso ? ` · ${aviso} con avisos ⚠` : ''}`;
  }
  const pintarTodo = () => { filas = filasDe(); pintarResumen(); pintarGestion(); pintarLista(); };

  // ---------- botón REMESAS ENVIADAS ----------
  const mesSel = sel(MESES.map((m) => [m, capitalizar(m)]), mesSiguiente());
  const btnEnviadas = h('button', { class: 'btn primary', type: 'button', disabled: !editor }, '');
  const etiquetaBtn = () => { btnEnviadas.textContent = `REMESAS ENVIADAS - ${mesSel.value.toUpperCase()}`; };
  etiquetaBtn(); mesSel.addEventListener('change', etiquetaBtn);
  btnEnviadas.addEventListener('click', async () => {
    const mes = mesSel.value; filas = filasDe();
    const rems = lista.map((r) => ({ r, l: cuentaRemesa(filas, r) })).filter((x) => x.l.length);
    const total = cmp2(rems.reduce((s, x) => s + x.l.reduce((t, y) => t + y.importe, 0), 0)); const n = rems.reduce((s, x) => s + x.l.length, 0);
    const previo = envios.find((e) => e.mes === mes);
    if (!await confirmar({ titulo: `Remesas enviadas · ${capitalizar(mes)}`, texto: `Se guardará como lo enviado al banco para ${mes}: ${rems.length} remesas, ${n} cobros, ${fmtEUR2(total)}.${previo ? ' Ya había un envío guardado de ese mes: se sustituye (se pierden sus OK y notas).' : ''}`, ok: 'Guardar envío' })) return;
    btnEnviadas.disabled = true;
    try {
      if (previo) await api.del('ac_remesa_envios', previo.id);
      const e = await api.ins('ac_remesa_envios', { curso_id: curso.id, mes });
      const res = await api.insMany('ac_remesa_envio_resumen', rems.map((x) => ({ envio_id: e.id, remesa_nombre: x.r.nombre, banco: x.r.banco, orden: x.r.orden, cobros: x.l.length, total: cmp2(x.l.reduce((s, y) => s + y.importe, 0)) })));
      await api.insMany('ac_remesa_envio_lineas', rems.flatMap((x) => x.l.map((y) => ({ envio_id: e.id, domiciliacion_id: y.dom?.id || null, alumno_id: y.a.id, alumno_num: y.a.num, remesa_nombre: x.r.nombre, importe: y.importe }))));
      envios = envios.filter((x) => x.id !== previo?.id); envios.push({ ...e, resumen: res }); f.envioId = e.id;
      await cargarLineas(); pintarResumen(); pintarLista(); toast(`Envío de ${mes} guardado`);
    } catch (ex) { toast(ex.message, 'error'); } finally { btnEnviadas.disabled = !editor; }
  });

  // ---------- filtros y cabecera ----------
  const busca = h('input', { type: 'search', placeholder: 'Buscar alumno, responsable, remesa o comentario…', style: 'min-width:280px', oninput: (e) => { f.q = e.target.value; pintarLista(); } });
  const selRemesa = sel([['__sin', 'Sin remesa'], ...lista.map((r) => [r.id, r.nombre])], '', { vacio: 'Todas las remesas' });
  selRemesa.addEventListener('change', () => { f.remesa = selRemesa.value; pintarLista(); });
  const selBanco = sel(BANCOS, '', { vacio: 'Ambos bancos' });
  selBanco.addEventListener('change', () => { f.banco = selBanco.value; pintarLista(); });
  const chk = (txt, k) => h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { f[k] = e.target.checked; pintarLista(); } }), ' ' + txt);
  const csv = h('button', { class: 'btn', type: 'button', onclick: () => descargarCSV(`domiciliaciones-${curso.nombre}.csv`, [['ID', 'Alumno', 'Responsable', 'IBAN', 'Importe', 'Comentarios', 'Mandato', 'Remesa', 'Banco'], ...visibles().map((x) => [x.a.num, nombreAlumno(x.a), x.a.responsable ? `${x.a.responsable.apellidos}, ${x.a.responsable.nombre}` : '', priv.get(x.a.responsable_id)?.iban || '', x.importe.toFixed(2).replace('.', ','), x.dom?.comentario || '', x.dom?.ref_mandato || x.a.num, x.rem?.nombre || '', x.rem ? nombreBanco(x.rem.banco) : ''])]) }, 'Descargar CSV');

  await cargarLineas();
  clear(view,
    cabecera(`Remesas · ${curso.nombre}`, 'Domiciliaciones por remesa: Sabadell (hasta 20 cobros) y BBVA', mesSel, btnEnviadas, csv, h('a', { class: 'btn ghost small', href: '#/ac_remesas_mensuales' }, 'Remesas mensuales (antiguo)')),
    resumenEl, gestionEl,
    h('div', { class: 'filters filters-2', style: 'gap:8px;flex-wrap:wrap' }, busca, selRemesa, selBanco, chk('Solo cuota cambiada este mes (5–25)', 'soloCambios'), chk('Solo con avisos ⚠', 'soloAvisos')),
    statsEl, listaEl);
  pintarResumen(); pintarGestion(); pintarLista();
}
