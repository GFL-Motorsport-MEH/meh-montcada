// Remesas: listado de domiciliaciones (como la hoja «Domiciliaciones» del Excel Control Alumnos).
// Una línea por alumno que paga por domiciliación, con su remesa (Sabadell 1–21 de hasta 20 cobros, BBVA con nombre), el importe
// de su cuota (resaltado si cambió entre el día 5 y el 25 del mes), el comentario y la referencia de mandato.
// Tres vistas: Remesas (lo ya procesado), Pendientes (alumnos nuevos o que pasan a domiciliación) y Archivados (ya no pagan por domiciliación).
// Arriba, el resumen de remesas y el botón «REMESAS ENVIADAS - mes X», que guarda lo enviado al banco para comparar cuando entren los pagos.
import { vista as vistaEstado, vincular, escuchar, crearAviso, busqueda } from '../vista.js';
import { h, clear, cargando, toast, confirmar, fmtEUR2, fmtFecha, hoyISO, normalizar, MESES, capitalizar, descargarCSV } from '../ui.js';
import * as api from './api.js';
import { cabecera, pill, sel, nombreAlumno } from './kit.js';
import { ordenGuardado, guardarOrden } from '../orden-compartido.js';

const esDomi = (m) => /domicil|sepa|recibo/i.test(m || '');
const NOMBRES_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// el mes que se envía al banco es el siguiente al actual (en octubre se envían las de noviembre)
const mesSiguiente = () => NOMBRES_MES[(new Date().getMonth() + 1) % 12];
const BANCOS = [['SABADELL', 'Sabadell Montcada'], ['BBVA', 'BBVA']];
const nombreBanco = (b) => (b === 'BBVA' ? 'BBVA' : 'Sabadell');
const cmp2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmtDif = (d) => (Math.abs(d) < 0.005 ? '0,00 €' : `${d > 0 ? '+' : ''}${fmtEUR2(d)}`);


const fmtFH = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid' }) : '');

// ventana emergente pequeña (se cierra con Esc, con la X o pulsando fuera)
function ventana(titulo, contenido, { ancho = 520 } = {}) {
  const cerrar = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') cerrar(); };
  const overlay = h('div', { class: 'overlay modal-center', onclick: (e) => { if (e.target === overlay) cerrar(); } },
    h('div', { class: 'dialog ac-rventana', role: 'dialog', 'aria-modal': 'true', style: `width:min(${ancho}px,100%)` },
      h('h3', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:center' }, h('span', {}, titulo), h('button', { class: 'btn ghost small', type: 'button', onclick: cerrar, 'aria-label': 'Cerrar' }, '✕')),
      contenido));
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  return { cerrar };
}

// tabla con títulos que ordenan (clic: A→Z, Z→A, sin orden); el último orden se recuerda
const ORD = new Map();
const cmpV = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' }));
function tablaOrd(clave, cols, items, filaFn, { pie = null, clase = '', vacio = 'Sin datos.' } = {}) {
  let est = ORD.get(clave);
  if (!est) { const g = ordenGuardado('remesas:' + clave); const j = g?.t ? cols.findIndex((c) => c.t === g.t) : -1; est = { j, dir: j >= 0 && g.dir === -1 ? -1 : 1 }; ORD.set(clave, est); }
  const tbody = h('tbody');
  const ths = cols.map((c, j) => {
    const th = h('th', { class: (c.num ? 'num ' : '') + (c.k ? 'sortable' : ''), title: c.k ? 'Clic para ordenar' : null }, c.t, ' ', h('span', { class: 'ac-orden' }));
    if (c.k) th.addEventListener('click', () => {
      if (est.j !== j) { est.j = j; est.dir = 1; } else if (est.dir === 1) est.dir = -1; else { est.j = -1; est.dir = 1; }
      guardarOrden('remesas:' + clave, { t: est.j >= 0 ? cols[est.j].t : null, dir: est.dir }); pinta();
    });
    return th;
  });
  function pinta() {
    let arr = items;
    if (est.j >= 0) {
      const k = cols[est.j].k; const vacios = (v) => v === '' || v === null || v === undefined;
      arr = [...items].sort((x, y) => { const a = k(x); const b = k(y); if (vacios(a)) return vacios(b) ? 0 : 1; if (vacios(b)) return -1; return est.dir * cmpV(a, b); });
    }
    ths.forEach((th, j) => { th.querySelector('.ac-orden').textContent = est.j === j ? (est.dir === 1 ? '▲' : '▼') : ''; });
    clear(tbody, arr.length ? arr.map(filaFn) : h('tr', {}, h('td', { colspan: cols.length, class: 'empty' }, vacio)));
  }
  pinta();
  return h('div', { class: 'table-wrap' }, h('table', { class: `data ${clase}` }, h('thead', {}, h('tr', {}, ths)), tbody, pie));
}

// leyenda flotante al pasar el ratón (o enfocar) sobre cualquier elemento con data-tip; no la recorta el scroll de las tablas
let tipEl = null;
let leyendasOn = false;
function activarLeyendas() {
  if (leyendasOn) return; leyendasOn = true;
  const ocultar = () => { if (tipEl) tipEl.style.display = 'none'; };
  const mostrar = (el) => {
    if (!tipEl) { tipEl = h('div', { class: 'ac-tip', role: 'tooltip' }); document.body.append(tipEl); }
    tipEl.textContent = el.dataset.tip; tipEl.style.display = 'block';
    const r = el.getBoundingClientRect(); const t = tipEl.getBoundingClientRect();
    tipEl.style.left = `${Math.max(6, Math.min(window.innerWidth - t.width - 6, r.left))}px`;
    tipEl.style.top = `${r.bottom + 6 + t.height > window.innerHeight ? Math.max(6, r.top - t.height - 6) : r.bottom + 6}px`;
  };
  document.addEventListener('mouseover', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) mostrar(el); else ocultar(); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) mostrar(el); });
  document.addEventListener('focusout', ocultar); window.addEventListener('scroll', ocultar, true);
}

export async function renderRemesas(view, ctx) {
  clear(view, cargando());
  activarLeyendas();
  const curso = ctx.cursoActual();
  const editor = ctx.edita('ac_remesas') || ctx.edita('ac_pagos');
  const [lista0, doms0, alumnos, insc, cambios, envios0, notas0] = await Promise.all([api.remesasLista(), api.domiciliaciones(), api.alumnos(), api.inscripciones(curso.id), api.cuotaCambios(curso.id), api.remesaEnvios(curso.id), api.domiNotas().catch(() => [])]);
  let lista = [...lista0]; let doms = [...doms0]; let envios = [...envios0]; const notas = [...notas0];
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
  const notasPor = new Map();
  for (const n of notas) { if (!notasPor.has(n.alumno_id)) notasPor.set(n.alumno_id, []); notasPor.get(n.alumno_id).push(n); }
  const notasDe = (id) => notasPor.get(id) || [];

  const f = vistaEstado('remesas.f', { q: '', remesa: '', banco: '', soloCambios: false, soloAvisos: false, vista: 'main' }); // se recuerda al refrescar
  if (!['main', 'pend', 'arch'].includes(f.vista)) f.vista = 'main';
  const envioOrden = () => [...envios].sort((a, b) => (b.enviado_el || '').localeCompare(a.enviado_el || ''));
  let lineasEnvioFull = []; // líneas del mes seleccionado cuando es un envío guardado

  const remPor = () => new Map(lista.map((r) => [r.id, r]));
  // main: líneas ya procesadas · pend: alumnos nuevos / que pasan a domiciliación · arch: archivados
  let main = []; let pend = []; let arch = [];
  const calc = () => {
    const rp = remPor();
    const imp = (a) => Number(inscPor.get(a.id)?.cuota_mensual || 0);
    const mk = (d, a) => ({ dom: d, a, rem: d?.remesa_id ? rp.get(d.remesa_id) : null, importe: imp(a) });
    const activos = doms.filter((d) => !d.archivado && alPor.has(d.alumno_id));
    const archivados = doms.filter((d) => d.archivado && alPor.has(d.alumno_id));
    const conRemesa = new Set(activos.filter((d) => d.remesa_id).map((d) => d.alumno_id));
    const pendSet = new Set(); pend = [];
    for (const a of alumnos) {
      if (a.estado !== 'inscrito' || !esDomi(a.metodo_pago) || conRemesa.has(a.id)) continue;
      const act = activos.find((d) => d.alumno_id === a.id);
      const prev = archivados.filter((d) => d.alumno_id === a.id).sort((x, y) => (y.archivado_el || '').localeCompare(x.archivado_el || ''))[0];
      const x = mk(act || prev || null, a);
      x.motivo = act ? 'Sin remesa' : prev ? 'Vuelve de archivados' : 'Nuevo / cambio a domiciliación';
      pend.push(x); pendSet.add(a.id);
    }
    main = activos.filter((d) => !(pendSet.has(d.alumno_id) && !d.remesa_id)).map((d) => mk(d, alPor.get(d.alumno_id)))
      .sort((x, y) => (x.rem ? x.rem.orden : 9999) - (y.rem ? y.rem.orden : 9999) || Number(x.a.num) - Number(y.a.num));
    arch = archivados.filter((d) => !pendSet.has(d.alumno_id)).map((d) => mk(d, alPor.get(d.alumno_id))).sort((x, y) => (y.dom.archivado_el || '').localeCompare(x.dom.archivado_el || ''));
    pend.sort((x, y) => Number(x.a.num) - Number(y.a.num));
  };
  const cuentaRemesa = (r) => main.filter((x) => x.rem?.id === r.id && x.a.estado === 'inscrito');
  const avisosDe = (x) => {
    const av = [];
    if (!x.dom?.remesa_id) av.push('Sin remesa');
    if (x.a.estado !== 'inscrito') av.push('Alumno no inscrito: revisar');
    else if (!esDomi(x.a.metodo_pago)) av.push(`Método de pago: ${x.a.metodo_pago || 'vacío'} → conviene archivar`);
    if (!x.a.responsable_id) av.push('Sin IBAN (ni responsable): pulsa ✎ junto al IBAN para ponerlo');
    else if (!priv.get(x.a.responsable_id)?.iban) av.push('Sin IBAN');
    if (!x.importe) av.push('Sin cuota');
    return av;
  };
  const respTxt = (a) => (a.responsable && (a.responsable.apellidos || a.responsable.nombre) ? [a.responsable.apellidos, a.responsable.nombre].filter(Boolean).join(', ') : '');
  const ibanDe = (x) => priv.get(x.a.responsable_id)?.iban || '';

  const resumenEl = h('div'); const gestionEl = h('div'); const listaEl = h('div'); const statsEl = h('div', { class: 'count' }); const tabsEl = h('div', { class: 'ac-fila', style: 'gap:6px;margin:8px 0' });
  calc();

  // ---------- cambios / comentarios (ventana emergente) ----------
  function abrirNotas(a, { nuevo = false } = {}) {
    const cont = h('div', { class: 'ac-rnotas' });
    let editando = null;
    const pintaN = () => {
      const lst = notasDe(a.id);
      const ta = h('textarea', { rows: '2', placeholder: 'Nuevo cambio o comentario…', style: 'width:100%', disabled: !editor });
      const add = h('button', { class: 'btn primary small', type: 'button', disabled: !editor, onclick: async () => {
        const t = ta.value.trim(); if (!t) return;
        try { const n = await api.ins('ac_domiciliacion_notas', { alumno_id: a.id, texto: t }); notas.push(n); if (!notasPor.has(a.id)) notasPor.set(a.id, []); notasPor.get(a.id).push(n); pintaN(); pintarVista(); } catch (ex) { toast(ex.message, 'error'); }
      } }, 'Añadir');
      clear(cont,
        lst.length ? lst.map((n, i) => {
          const fila = h('div', { class: 'ac-rnota' });
          if (editando === n.id) {
            const t = h('textarea', { rows: '3', style: 'width:100%' }, n.texto); t.value = n.texto;
            fila.append(h('span', { class: 'ac-nota-b' }, String(i + 1)), h('div', { style: 'flex:1' }, t,
              h('div', { class: 'ac-fila', style: 'gap:6px;margin-top:4px' },
                h('button', { class: 'btn primary small', type: 'button', onclick: async () => {
                  const v = t.value.trim(); if (!v) { toast('El texto no puede quedar vacío', 'error'); return; }
                  if (v === n.texto) { editando = null; pintaN(); return; }
                  try { Object.assign(n, await api.upd('ac_domiciliacion_notas', n.id, { texto: v, editado_el: new Date().toISOString() })); editando = null; pintaN(); pintarVista(); toast('Guardado'); } catch (ex) { toast(ex.message, 'error'); }
                } }, 'Guardar'),
                h('button', { class: 'btn ghost small', type: 'button', onclick: () => { editando = null; pintaN(); } }, 'Cancelar'))));
          } else {
            fila.append(h('span', { class: 'ac-nota-b' }, String(i + 1)), h('div', { style: 'flex:1' },
              h('div', { class: 'small muted' }, `Creado ${fmtFH(n.created_at)}`, n.editado_el ? ` · Última edición ${fmtFH(n.editado_el)}` : ' · sin editar'),
              h('div', { style: 'white-space:pre-wrap' }, n.texto)),
              h('button', { class: 'btn ghost small', type: 'button', disabled: !editor, title: 'Editar', onclick: () => { editando = n.id; pintaN(); } }, '✎'));
          }
          return fila;
        }) : h('div', { class: 'muted small' }, 'Todavía no hay cambios ni comentarios.'),
        h('div', { style: 'margin-top:10px' }, ta, h('div', { style: 'text-align:right;margin-top:4px' }, add)));
      if (nuevo && editando === null) ta.focus();
    };
    pintaN();
    ventana(`Cambios/Comentarios · ${nombreAlumno(a)} (ID ${a.num})`, cont, { ancho: 520 });
  }
  const celdaNotas = (x) => {
    const lst = notasDe(x.a.id);
    return h('span', { class: 'ac-fila', style: 'gap:3px;flex-wrap:wrap' },
      lst.map((n, i) => h('button', { class: 'ac-nota-b', type: 'button', title: `${fmtFH(n.created_at)}${n.editado_el ? ' (editado ' + fmtFH(n.editado_el) + ')' : ''}: ${n.texto}`, onclick: () => abrirNotas(x.a) }, String(i + 1))),
      h('button', { class: 'ac-nota-b mas', type: 'button', disabled: !editor, title: 'Añadir cambio/comentario', 'aria-label': 'Añadir cambio o comentario', onclick: () => abrirNotas(x.a, { nuevo: true }) }, '＋'));
  };

  // ---------- IBAN (se modifica aquí y también en la ficha del responsable) ----------
  function editarIban(x) {
    let rid = x.a.responsable_id; const actual = ibanDe(x);
    const rApe = h('input', { type: 'text', placeholder: 'Apellidos del responsable (opcional)', 'aria-label': 'Apellidos del responsable' }); const rNom = h('input', { type: 'text', placeholder: 'Nombre del responsable (opcional)', 'aria-label': 'Nombre del responsable' });
    const otros = alumnos.filter((a) => a.responsable_id === rid && a.id !== x.a.id).length;
    const inp = h('input', { type: 'text', value: actual, class: 'mono', style: 'width:100%', placeholder: 'ES00 0000 0000 0000 0000 0000' });
    const cont = h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      !rid ? h('div', { class: 'small ac-dif' }, 'Este alumno no tiene responsable. El IBAN se guarda igualmente: se crea un responsable (con el nombre que escribas, o sin nombre) y se enlaza al alumno. Podrás completarlo después en Alumnos.') : null,
      !rid ? h('div', { class: 'ac-fila', style: 'gap:6px' }, rApe, rNom) : null,
      rid ? h('div', { class: 'small' }, `Responsable: ${respTxt(x.a) || '—'}. Al guardar, el IBAN también cambia en la ficha del responsable (base de datos de Alumnos)${otros ? ` y afecta a ${otros} alumno${otros > 1 ? 's' : ''} más con el mismo responsable` : ''}.`) : null, inp);
    const v = ventana(`IBAN · ${nombreAlumno(x.a)}`, cont, { ancho: 460 });
    const guardar = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      const nuevo = inp.value.replace(/\s+/g, '').toUpperCase();
      if (!nuevo) { toast('Escribe el IBAN', 'error'); return; }
      if (nuevo === actual.replace(/\s+/g, '').toUpperCase()) { v.cerrar(); return; }
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(nuevo) && !await confirmar({ titulo: 'IBAN dudoso', texto: 'No tiene el formato de un IBAN. ¿Guardarlo igualmente?', ok: 'Guardar igualmente' })) return;
      try {
        if (!rid) {
          const r = await api.ins('ac_responsables', { apellidos: rApe.value.trim(), nombre: rNom.value.trim() });
          await api.upd('ac_alumnos', x.a.id, { responsable_id: r.id }); x.a.responsable_id = r.id; x.a.responsable = r; rid = r.id;
        }
        await api.guardarPrivados(rid, { iban: nuevo }); priv.set(rid, { ...(priv.get(rid) || { responsable_id: rid }), iban: nuevo }); toast('IBAN actualizado también en Alumnos'); v.cerrar(); pintarTodo(); } catch (ex) { toast(ex.message, 'error'); }
    } }, 'Guardar');
    cont.append(h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: v.cerrar }, 'Cancelar'), guardar));
    setTimeout(() => inp.focus(), 60);
  }
  const celdaIban = (x) => {
    const iban = ibanDe(x);
    return h('span', { class: 'ac-fila', style: 'gap:4px;flex-wrap:nowrap' }, iban ? h('span', { class: 'mono' }, iban) : h('span', { class: 'muted' }, 'sin IBAN'),
      h('button', { class: 'ac-rbtn', type: 'button', disabled: !editor, title: x.a.responsable_id ? 'Modificar IBAN (también en Alumnos)' : 'Sin responsable: pulsa para crearlo y poner el IBAN', 'aria-label': 'Modificar IBAN', onclick: () => editarIban(x) }, '✎'));
  };

  // ---------- mes seleccionado: «actual» (en curso) o un envío guardado (copia propia, editable sin afectar al resto) ----------
  const ver = () => envios.find((e) => e.mes === mesSel.value) || null;
  const setLineas = (arr) => { lineasEnvioFull = arr; };
  async function cargarLineas() {
    setLineas([]);
    const env = ver(); if (!env) return;
    try { setLineas([...await api.remesaEnvioLineas(env.id)]); } catch { /* sin líneas */ }
  }
  const resumenAbierto = () => { try { return localStorage.getItem('remesas_resumen') !== '0'; } catch { return true; } };
  const bancoDeNombre = (n) => lista.find((r) => r.nombre === n)?.banco || 'SABADELL';
  // cifras por remesa de un mes: 'actual' o el id de un envío (de sus líneas si tiene detalle, y si no, de los totales guardados)
  async function cifrasDe(clave) {
    const m = new Map();
    const suma = (n, c, t) => { const o = m.get(n) || { n: 0, total: 0 }; o.n += c; o.total = cmp2(o.total + t); m.set(n, o); };
    if (clave === 'actual') { for (const r of lista) { const l = cuentaRemesa(r); if (l.length) suma(r.nombre, l.length, l.reduce((s, x) => s + x.importe, 0)); } return m; }
    const env = envios.find((e) => e.id === clave); if (!env) return m;
    let lin = env.id === ver()?.id ? lineasEnvioFull : null;
    if (!lin) { try { lin = await api.remesaEnvioLineas(env.id); } catch { lin = []; } }
    if (lin.length) for (const l of lin) suma(l.remesa_nombre || '—', 1, Number(l.importe));
    else for (const r of env.resumen || []) suma(r.remesa_nombre, Number(r.cobros), Number(r.total));
    return m;
  }
  // tras editar las líneas de un envío, sus totales por remesa se recalculan (lo guardado queda coherente con el detalle)
  async function sincronizarResumen(env) {
    const m = new Map();
    for (const l of lineasEnvioFull) { const o = m.get(l.remesa_nombre) || { n: 0, total: 0 }; o.n += 1; o.total = cmp2(o.total + Number(l.importe)); m.set(l.remesa_nombre, o); }
    for (const r of env.resumen || []) {
      const o = m.get(r.remesa_nombre) || { n: 0, total: 0 };
      if (Number(r.cobros) !== o.n || Math.abs(Number(r.total) - o.total) >= 0.005) Object.assign(r, await api.upd('ac_remesa_envio_resumen', r.id, { cobros: o.n, total: o.total, ok: false }));
      m.delete(r.remesa_nombre);
    }
    for (const [nombre, o] of m) {
      const rl = lista.find((x) => x.nombre === nombre);
      const nuevo = (await api.insMany('ac_remesa_envio_resumen', [{ envio_id: env.id, remesa_nombre: nombre, banco: rl?.banco || 'SABADELL', orden: rl?.orden ?? 9999, cobros: o.n, total: o.total }]))[0];
      env.resumen = [...(env.resumen || []), nuevo];
    }
  }
  const datosLinea = (x, remesaNombre) => ({ alumno_id: x.a.id, alumno_num: x.a.num, domiciliacion_id: x.dom?.id || null, remesa_nombre: remesaNombre, importe: x.importe,
    alumno_nombre: nombreAlumno(x.a), responsable_nombre: respTxt(x.a) || null, iban: ibanDe(x) || null, ref_mandato: x.dom?.ref_mandato || null });

  async function pintarResumen() {
    const env = ver();
    const cifras = await cifrasDe(env ? env.id : 'actual');
    const nombres = [...new Set([...lista.map((r) => r.nombre), ...cifras.keys()])];
    const filas = nombres.map((n) => {
      const r = lista.find((x) => x.nombre === n); const c = cifras.get(n) || { n: 0, total: 0 };
      return { n, r, cobros: c.n, total: c.total, g: env ? (env.resumen || []).find((x) => x.remesa_nombre === n) : null };
    }).filter((x) => x.cobros || x.g || x.r).sort((a, b) => (a.r ? a.r.orden : 9999) - (b.r ? b.r.orden : 9999));
    const tn = filas.reduce((s, x) => s + x.cobros, 0); const tt = cmp2(filas.reduce((s, x) => s + x.total, 0));
    const cols = [{ t: 'Remesa', k: (i) => (i.r ? i.r.orden : 9999) }, { t: 'Banco', k: (i) => i.r?.banco || bancoDeNombre(i.n) }, { t: 'Cobros', num: true, k: (i) => i.cobros }, { t: 'Suma', num: true, k: (i) => i.total },
      ...(env ? [{ t: 'OK', k: (i) => (i.g?.ok ? 1 : 0) }, { t: 'Nota', k: (i) => i.g?.nota || '' }] : [])];
    const fila = (i) => {
      const llena = !env && i.r?.capacidad && i.cobros > i.r.capacidad;
      const tds = [h('td', {}, h('strong', {}, i.n)), h('td', {}, nombreBanco(i.r?.banco || bancoDeNombre(i.n))),
        h('td', { class: 'num' }, llena ? h('span', { class: 'pill warn', title: `Pasa de ${i.r.capacidad} cobros` }, String(i.cobros)) : String(i.cobros)), h('td', { class: 'num' }, fmtEUR2(i.total))];
      if (env) {
        const g = i.g;
        const ok = h('input', { type: 'checkbox', checked: !!g?.ok, disabled: !g || !editor, title: 'Revisado: lo que entró en el banco coincide' });
        ok.addEventListener('change', async () => { try { Object.assign(g, await api.upd('ac_remesa_envio_resumen', g.id, { ok: ok.checked })); } catch (ex) { ok.checked = !ok.checked; toast(ex.message, 'error'); } });
        const nota = h('input', { type: 'text', class: 'cell', value: g?.nota || '', disabled: !g || !editor, placeholder: g ? 'Nota…' : '', style: 'width:100%;min-width:120px' });
        nota.addEventListener('change', async () => { try { Object.assign(g, await api.upd('ac_remesa_envio_resumen', g.id, { nota: nota.value.trim() || null })); toast('Nota guardada'); } catch (ex) { toast(ex.message, 'error'); } });
        tds.push(h('td', { class: 'center' }, ok), h('td', {}, nota));
      }
      return h('tr', {}, tds);
    };
    const pie = h('tfoot', {}, h('tr', {}, h('th', { colspan: 2 }, 'Total'), h('th', { class: 'num' }, String(tn)), h('th', { class: 'num' }, fmtEUR2(tt)), env ? h('th', { colspan: 2 }) : null));
    const titulo = env ? `${capitalizar(env.mes)} · enviado ${fmtFecha((env.enviado_el || '').slice(0, 10))}` : 'Mes en curso (datos actuales)';
    const det = h('details', { class: 'card ac-rresumen', open: resumenAbierto() },
      h('summary', {}, h('strong', {}, 'Resumen de remesas'), h('span', { class: 'muted small' }, ` · ${titulo} · ${tn} cobros · ${fmtEUR2(tt)}`)),
      tablaOrd('resumen', cols, filas, fila, { pie, clase: 'ac-compacta' }));
    det.addEventListener('toggle', () => { try { localStorage.setItem('remesas_resumen', det.open ? '1' : '0'); } catch { /* sin almacenamiento */ } });
    clear(resumenEl, det, await panelComparar());
  }

  // ---------- comparar dos meses: cifras en dos colores, una al lado de la otra ----------
  const opcionesMes = () => [['actual', 'Actual (en curso)'], ...envioOrden().map((e) => [e.id, `${capitalizar(e.mes)} (enviado)`])];
  async function panelComparar() {
    if (!f.cmpA || (f.cmpA !== 'actual' && !envios.some((e) => e.id === f.cmpA))) f.cmpA = envioOrden()[0]?.id || 'actual';
    if (!f.cmpB || (f.cmpB !== 'actual' && !envios.some((e) => e.id === f.cmpB))) f.cmpB = 'actual';
    const [A, B] = await Promise.all([cifrasDe(f.cmpA), cifrasDe(f.cmpB)]);
    const nombres = [...new Set([...lista.map((r) => r.nombre), ...A.keys(), ...B.keys()])].filter((n) => A.has(n) || B.has(n)).sort((a, b) => (lista.find((r) => r.nombre === a)?.orden ?? 9999) - (lista.find((r) => r.nombre === b)?.orden ?? 9999));
    const z = { n: 0, total: 0 };
    const items = nombres.map((n) => ({ n, a: A.get(n) || z, b: B.get(n) || z }));
    const cols = [{ t: 'Remesa', k: (i) => i.n }, { t: 'Cobros A', num: true, k: (i) => i.a.n }, { t: 'Suma A', num: true, k: (i) => i.a.total }, { t: 'Cobros B', num: true, k: (i) => i.b.n }, { t: 'Suma B', num: true, k: (i) => i.b.total }, { t: 'Dif. cobros (B−A)', num: true, k: (i) => i.b.n - i.a.n }, { t: 'Dif. suma (B−A)', num: true, k: (i) => cmp2(i.b.total - i.a.total) }];
    const fila = (i) => { const dn = i.b.n - i.a.n; const dt = cmp2(i.b.total - i.a.total);
      return h('tr', {}, h('td', {}, h('strong', {}, i.n)), h('td', { class: 'num ac-cmp-a' }, String(i.a.n)), h('td', { class: 'num ac-cmp-a' }, fmtEUR2(i.a.total)), h('td', { class: 'num ac-cmp-b' }, String(i.b.n)), h('td', { class: 'num ac-cmp-b' }, fmtEUR2(i.b.total)),
        h('td', { class: `num ${dn ? 'ac-dif' : ''}` }, dn ? (dn > 0 ? '+' : '') + dn : '0'), h('td', { class: `num ${Math.abs(dt) >= 0.005 ? 'ac-dif' : ''}` }, fmtDif(dt))); };
    const sum = (m) => [...m.values()].reduce((s, x) => ({ n: s.n + x.n, total: cmp2(s.total + x.total) }), { n: 0, total: 0 });
    const ta = sum(A); const tb = sum(B);
    const pie = h('tfoot', {}, h('tr', {}, h('th', {}, 'Total'), h('th', { class: 'num ac-cmp-a' }, String(ta.n)), h('th', { class: 'num ac-cmp-a' }, fmtEUR2(ta.total)), h('th', { class: 'num ac-cmp-b' }, String(tb.n)), h('th', { class: 'num ac-cmp-b' }, fmtEUR2(tb.total)), h('th', { class: 'num' }, String(tb.n - ta.n)), h('th', { class: 'num' }, fmtDif(cmp2(tb.total - ta.total)))));
    const sA = sel(opcionesMes(), f.cmpA); const sB = sel(opcionesMes(), f.cmpB);
    sA.className = 'ac-cmp-a'; sB.className = 'ac-cmp-b';
    sA.addEventListener('change', () => { f.cmpA = sA.value; pintarResumen(); }); sB.addEventListener('change', () => { f.cmpB = sB.value; pintarResumen(); });
    return h('details', { class: 'card ac-rresumen', open: (() => { try { return localStorage.getItem('remesas_comparar') === '1'; } catch { return false; } })(), ontoggle: (e) => { try { localStorage.setItem('remesas_comparar', e.target.open ? '1' : '0'); } catch { /* sin almacenamiento */ } } },
      h('summary', {}, h('strong', {}, 'Comparar dos meses')),
      h('div', { class: 'ac-fila', style: 'margin:4px 0;gap:10px;flex-wrap:wrap' }, h('label', { class: 'small' }, h('span', { class: 'ac-cmp-a' }, 'A '), sA), h('label', { class: 'small' }, h('span', { class: 'ac-cmp-b' }, 'B '), sB)),
      tablaOrd('comparar', cols, items, fila, { pie, clase: 'ac-compacta', vacio: 'No hay datos que comparar.' }));
  }

  // ---------- vista de un mes ya enviado: copia propia de ese mes, editable ----------
  async function guardarLinea(env, l, parche) {
    Object.assign(l, await api.upd('ac_remesa_envio_lineas', l.id, parche));
    await sincronizarResumen(env); setLineas([...lineasEnvioFull]);
  }
  function vistaEnvio(env, q) {
    const nomDe = (l) => l.alumno_nombre || (alPor.get(l.alumno_id) ? nombreAlumno(alPor.get(l.alumno_id)) : `ID ${l.alumno_num ?? '?'}`);
    const respDe = (l) => l.responsable_nombre ?? (alPor.get(l.alumno_id) ? respTxt(alPor.get(l.alumno_id)) : '');
    const ibanL = (l) => l.iban ?? (alPor.get(l.alumno_id) ? ibanDe({ a: alPor.get(l.alumno_id) }) : '');
    const orden = (l) => lista.find((r) => r.nombre === l.remesa_nombre)?.orden ?? 9999;
    const rf = f.remesa && f.remesa !== '__sin' ? lista.find((r) => r.id === f.remesa)?.nombre : null;
    const vis = lineasEnvioFull.filter((l) => (!rf || l.remesa_nombre === rf) && (!f.banco || bancoDeNombre(l.remesa_nombre) === f.banco)
      && (!q || normalizar(`${l.alumno_num} ${nomDe(l)} ${respDe(l)} ${l.remesa_nombre} ${l.comentario || ''}`).includes(q)));
    const cols = [{ t: 'ID', num: true, k: (l) => Number(l.alumno_num) }, { t: 'Alumno', k: (l) => nomDe(l) }, { t: 'Responsable', k: (l) => respDe(l) }, { t: 'IBAN', k: (l) => ibanL(l) }, { t: 'Importe', num: true, k: (l) => Number(l.importe) },
      { t: 'Mandato', k: (l) => l.ref_mandato || String(l.alumno_num) }, { t: 'Remesa', k: (l) => orden(l) }, { t: 'Comentario', k: (l) => l.comentario || '' }, { t: '' }];
    const refresca = async () => { await pintarResumen(); pintarVista(); };
    const fila = (l) => {
      const imp = h('input', { type: 'number', step: '0.01', class: 'cell', value: String(Number(l.importe)), disabled: !editor, style: 'width:80px;text-align:right', 'aria-label': 'Importe' });
      imp.addEventListener('change', async () => { const v = Number(String(imp.value).replace(',', '.')); if (!Number.isFinite(v) || v < 0) { imp.value = String(Number(l.importe)); return; }
        try { await guardarLinea(env, l, { importe: cmp2(v) }); await refresca(); toast('Guardado solo en este mes'); } catch (ex) { imp.value = String(Number(l.importe)); toast(ex.message, 'error'); } });
      const rem = sel(lista.map((r) => [r.nombre, r.nombre]), l.remesa_nombre, { disabled: !editor, 'aria-label': 'Remesa' });
      rem.addEventListener('change', async () => { try { await guardarLinea(env, l, { remesa_nombre: rem.value }); await refresca(); } catch (ex) { rem.value = l.remesa_nombre; toast(ex.message, 'error'); } });
      const man = h('input', { type: 'text', class: 'cell', value: l.ref_mandato || '', placeholder: String(l.alumno_num), disabled: !editor, style: 'width:64px' });
      man.addEventListener('change', async () => { try { await guardarLinea(env, l, { ref_mandato: man.value.trim() || null }); } catch (ex) { toast(ex.message, 'error'); } });
      const com = h('input', { type: 'text', class: 'cell', value: l.comentario || '', placeholder: 'Comentario…', disabled: !editor, style: 'width:100%;min-width:140px' });
      com.addEventListener('change', async () => { try { await guardarLinea(env, l, { comentario: com.value.trim() || null }); } catch (ex) { toast(ex.message, 'error'); } });
      const del = h('button', { class: 'ac-rbtn', type: 'button', disabled: !editor, title: 'Quitar esta línea de este mes (no cambia nada más)', 'aria-label': 'Quitar línea', onclick: async () => {
        if (!await confirmar({ titulo: `Quitar de ${capitalizar(env.mes)}`, texto: `Se quita a ${nomDe(l)} (ID ${l.alumno_num}, ${fmtEUR2(Number(l.importe))}) solo de este mes. Alumnos y las remesas actuales no cambian.`, ok: 'Quitar', peligro: true })) return;
        try { await api.del('ac_remesa_envio_lineas', l.id); setLineas(lineasEnvioFull.filter((x) => x.id !== l.id)); await sincronizarResumen(env); await refresca(); toast('Línea quitada de este mes'); } catch (ex) { toast(ex.message, 'error'); } } }, '✕');
      return h('tr', {}, h('td', { class: 'num' }, String(l.alumno_num ?? '')), h('td', {}, nomDe(l)), h('td', {}, respDe(l) || '—'), h('td', {}, ibanL(l) ? h('span', { class: 'mono' }, ibanL(l)) : h('span', { class: 'muted' }, 'sin IBAN')), h('td', { class: 'num' }, imp), h('td', {}, man), h('td', {}, rem), h('td', {}, com), h('td', {}, del));
    };
    return { vis, el: tablaOrd('envio', cols, vis, fila, { clase: 'ac-domi', vacio: 'Este mes no tiene líneas con esos filtros.' }) };
  }
  function anadirAEnvio(env) {
    const fq = h('input', { type: 'search', placeholder: 'Buscar alumno por ID o nombre…', style: 'width:100%' });
    const res = h('div', { style: 'max-height:40vh;overflow:auto;margin-top:6px' });
    const pinta = () => {
      const q = normalizar(fq.value.trim()); if (!q) { clear(res, h('div', { class: 'muted small' }, 'Escribe para buscar.')); return; }
      const hits = alumnos.filter((a) => normalizar(`${a.num} ${nombreAlumno(a)}`).includes(q)).slice(0, 15);
      clear(res, hits.map((a) => { const x = { a, dom: doms.find((d) => d.alumno_id === a.id && !d.archivado) || null, importe: Number(inscPor.get(a.id)?.cuota_mensual || 0) };
        const rs = sel(lista.map((r) => [r.nombre, r.nombre]), lista.find((r) => r.id === x.dom?.remesa_id)?.nombre || '', { vacio: '— remesa —' });
        const im = h('input', { type: 'number', step: '0.01', value: String(x.importe), style: 'width:80px' });
        return h('div', { class: 'ac-fila', style: 'gap:6px;padding:3px 0;border-bottom:1px solid var(--line,#ddd)' }, h('span', { style: 'flex:1' }, `${a.num} · ${nombreAlumno(a)}`), im, rs,
          h('button', { class: 'btn small primary', type: 'button', onclick: async () => {
            if (!rs.value) { toast('Elige la remesa', 'error'); return; }
            try { x.importe = cmp2(Number(String(im.value).replace(',', '.')) || 0); const nueva = await api.ins('ac_remesa_envio_lineas', { envio_id: env.id, ...datosLinea(x, rs.value), comentario: 'Añadido a mano' });
              setLineas([...lineasEnvioFull, nueva]); await sincronizarResumen(env); v.cerrar(); await pintarResumen(); pintarVista(); toast('Añadido solo a este mes'); } catch (ex) { toast(ex.message, 'error'); } } }, 'Añadir'));
      }));
    };
    fq.addEventListener('input', pinta); pinta();
    const v = ventana(`Añadir a ${capitalizar(env.mes)}`, h('div', {}, h('div', { class: 'small muted', style: 'margin-bottom:6px' }, 'Solo se añade a este mes; la ficha del alumno y las remesas actuales no cambian.'), fq, res), { ancho: 560 });
    setTimeout(() => fq.focus(), 60);
  }
  async function detallarEnvio(env) {
    if (!await confirmar({ titulo: `Detallar ${capitalizar(env.mes)} por alumno`, texto: 'Este mes solo guardó totales por remesa. Se crea una lista por alumno copiando las remesas actuales y los totales pasan a calcularse con ella; después quitas o cambias lo que no estuviera. No se modifica nada más.', ok: 'Crear detalle' })) return;
    const filas = main.filter((x) => x.rem && x.a.estado === 'inscrito' && x.importe > 0).map((x) => ({ envio_id: env.id, ...datosLinea(x, x.rem.nombre) }));
    try { setLineas(filas.length ? [...await api.insMany('ac_remesa_envio_lineas', filas)] : []); await sincronizarResumen(env); await pintarResumen(); pintarVista(); toast(`Detalle creado (${filas.length} líneas)`); } catch (ex) { toast(ex.message, 'error'); }
  }

  // ---------- gestionar remesas (ventana emergente) ----------
  function pintarGestion() {
    const nombre = h('input', { type: 'text', placeholder: 'Nombre (p. ej. 22 o BBVA 7 - VIER)', style: 'flex:1;min-width:180px' });
    const banco = sel(BANCOS, 'SABADELL');
    const cap = h('input', { type: 'number', min: '1', placeholder: 'Máx.', value: '20', style: 'width:70px' });
    banco.addEventListener('change', () => { cap.value = banco.value === 'SABADELL' ? '20' : ''; });
    const anadir = h('button', { class: 'btn primary small', type: 'button', disabled: !editor, onclick: async () => {
      const n = nombre.value.trim();
      if (!n) { toast('Escribe el nombre de la remesa', 'error'); return; }
      if (lista.some((r) => normalizar(r.nombre) === normalizar(n))) { toast('Ya existe una remesa con ese nombre', 'error'); return; }
      const mismos = lista.filter((r) => r.banco === banco.value).map((r) => r.orden);
      const orden = mismos.length ? Math.max(...mismos) + 1 : (banco.value === 'BBVA' ? 101 : 1);
      try { const r = await api.ins('ac_remesas_lista', { nombre: n, banco: banco.value, capacidad: cap.value ? Number(cap.value) : null, orden }); lista.push(r); lista.sort((a, b) => a.orden - b.orden); toast(`Remesa «${n}» añadida`); pintarTodo(); } catch (ex) { toast(ex.message, 'error'); }
    } }, 'Añadir');
    const cols = [{ t: 'Remesa', k: (r) => r.orden }, { t: 'Banco', k: (r) => r.banco }, { t: 'Máx.', num: true, k: (r) => r.capacidad ?? '' }, { t: 'Líneas', num: true, k: (r) => doms.filter((d) => !d.archivado && d.remesa_id === r.id).length }, { t: '' }];
    const fila = (r) => {
      const n = doms.filter((d) => !d.archivado && d.remesa_id === r.id).length;
      const nom = h('input', { type: 'text', value: r.nombre, disabled: !editor, style: 'width:150px' });
      nom.addEventListener('change', async () => { const v = nom.value.trim(); if (!v || v === r.nombre) { nom.value = r.nombre; return; }
        try { Object.assign(r, await api.upd('ac_remesas_lista', r.id, { nombre: v })); toast('Nombre cambiado'); pintarResumen(); pintarVista(); } catch (ex) { nom.value = r.nombre; toast(ex.message, 'error'); } });
      const cp = h('input', { type: 'number', min: '1', value: r.capacidad ?? '', disabled: !editor, style: 'width:60px' });
      cp.addEventListener('change', async () => { try { Object.assign(r, await api.upd('ac_remesas_lista', r.id, { capacidad: cp.value ? Number(cp.value) : null })); pintarResumen(); } catch (ex) { toast(ex.message, 'error'); } });
      const bor = h('button', { class: 'btn danger small', type: 'button', disabled: !editor, onclick: async () => {
        if (!await confirmar({ titulo: `Eliminar la remesa ${r.nombre}`, texto: n ? `Sus ${n} líneas pasan a Pendientes (no se borra a nadie).` : 'La remesa está vacía.', ok: 'Eliminar', peligro: true })) return;
        try { await api.del('ac_remesas_lista', r.id); lista = lista.filter((x) => x.id !== r.id); doms = doms.map((d) => (d.remesa_id === r.id ? { ...d, remesa_id: null } : d)); toast('Remesa eliminada'); pintarTodo(); } catch (ex) { toast(ex.message, 'error'); }
      } }, 'Eliminar');
      return h('tr', {}, h('td', {}, nom), h('td', {}, nombreBanco(r.banco)), h('td', { class: 'num' }, cp), h('td', { class: 'num' }, String(n)), h('td', {}, bor));
    };
    clear(gestionEl,
      h('div', { class: 'ac-fila', style: 'margin-bottom:8px;gap:6px;flex-wrap:wrap' }, nombre, banco, cap, anadir),
      h('div', { style: 'max-height:55vh;overflow:auto' }, tablaOrd('gestion', cols, lista, fila, { clase: 'ac-compacta' })));
  }

  // ---------- vistas: remesas / pendientes / archivados ----------
  function pasa(x, vista) {
    const q = normalizar(f.q.trim());
    if (vista === 'main') {
      if (f.remesa === '__sin' && x.rem) return false;
      if (f.remesa && f.remesa !== '__sin' && x.rem?.id !== f.remesa) return false;
      if (f.banco && x.rem?.banco !== f.banco) return false;
      if (f.soloAvisos && !avisosDe(x).length) return false;
    }
    if (f.soloCambios && !cambiosPor.has(x.a.id)) return false;
    if (q && !normalizar(`${x.a.num} ${nombreAlumno(x.a)} ${respTxt(x.a)} ${notasDe(x.a.id).map((n) => n.texto).join(' ')} ${x.rem?.nombre || ''}`).includes(q)) return false;
    return true;
  }
  async function guardarDom(x, parche) {
    if (x.dom) { Object.assign(x.dom, await api.upd('ac_domiciliaciones', x.dom.id, parche)); }
    else { x.dom = await api.ins('ac_domiciliaciones', { alumno_id: x.a.id, ...parche }); doms.push(x.dom); }
  }
  const opcionesRemesa = () => lista.map((r) => [r.id, `${r.nombre} (${cuentaRemesa(r).length})`]);
  // pregunta si la remesa está llena; true = seguir
  async function cabeEn(r, excepto) {
    if (!r?.capacidad) return true;
    const n = cuentaRemesa(r).filter((y) => y !== excepto && y.a.id !== excepto?.a.id).length;
    return n < r.capacidad || confirmar({ titulo: `Remesa ${r.nombre} llena`, texto: `Ya tiene ${r.capacidad} cobros (máximo). ¿Añadir uno más?`, ok: 'Añadir igualmente' });
  }
  const celdaImporte = (x) => {
    const camb = cambiosPor.get(x.a.id);
    const ins = inscPor.get(x.a.id);
    const inp = h('input', { type: 'number', step: '0.01', class: 'cell', value: String(x.importe), disabled: !editor || !ins, style: 'width:80px;text-align:right', 'aria-label': 'Importe (cuota mensual)' });
    inp.addEventListener('change', async () => {
      const v = Number(String(inp.value).replace(',', '.'));
      if (!Number.isFinite(v) || v < 0) { inp.value = String(x.importe); return; }
      if (!await confirmar({ titulo: 'Cambiar la cuota', texto: `${nombreAlumno(x.a)}: ${fmtEUR2(x.importe)} → ${fmtEUR2(v)}. Es la cuota mensual de su inscripción, así que también cambia en Alumnos.`, ok: 'Cambiar' })) { inp.value = String(x.importe); return; }
      try { Object.assign(ins, await api.upd('ac_inscripciones', ins.id, { cuota_mensual: cmp2(v) })); calc(); pintarTodo(); toast('Cuota actualizada también en Alumnos'); } catch (ex) { inp.value = String(x.importe); toast(ex.message, 'error'); }
    });
    return h('td', { class: `num ${camb ? 'ac-cuota-cambio' : ''}`, 'data-tip': camb ? 'Cuota cambiada este mes (entre el 5 y el 25): ' + camb.map((c) => `${fmtEUR2(c.anterior)} → ${fmtEUR2(c.nueva)} el ${fmtFecha(c.fecha)}`).join(' · ') : null }, inp);
  };
  const celdaAlumno = (x, avisos) => h('td', {}, nombreAlumno(x.a), avisos?.length ? h('span', { class: 'pill warn', style: 'margin-left:6px;cursor:help', tabindex: '0', 'data-tip': avisos.join('\n'), 'aria-label': 'Aviso: ' + avisos.join('. ') }, '⚠') : null);

  function vistaMain(vis) {
    const opc = opcionesRemesa();
    const cols = [
      { t: 'ID', num: true, k: (x) => Number(x.a.num) }, { t: 'Alumno', k: (x) => nombreAlumno(x.a) }, { t: 'Responsable', k: (x) => respTxt(x.a) }, { t: 'IBAN', k: (x) => ibanDe(x) },
      { t: 'Importe', num: true, k: (x) => x.importe }, { t: 'Cambios/Comentarios', k: (x) => notasDe(x.a.id).length || '' }, { t: 'Mandato', k: (x) => x.dom?.ref_mandato || String(x.a.num) },
      { t: 'Remesa', k: (x) => (x.rem ? x.rem.orden : '') }, { t: '' }];
    const fila = (x) => {
      const av = avisosDe(x).filter((t) => t !== 'Sin remesa');
      const selR = sel(opc, x.dom?.remesa_id || '', { vacio: '— sin remesa —', disabled: !editor, 'aria-label': 'Remesa' });
      selR.className = x.dom?.remesa_id ? '' : 'ac-sin-remesa';
      selR.addEventListener('change', async () => {
        const r = lista.find((l) => l.id === selR.value);
        if (r && !await cabeEn(r, x)) { selR.value = x.dom?.remesa_id || ''; return; }
        try { await guardarDom(x, { remesa_id: selR.value || null }); calc(); pintarResumen(); pintarVista(); } catch (ex) { selR.value = x.dom?.remesa_id || ''; toast(ex.message, 'error'); }
      });
      const man = h('input', { type: 'text', class: 'cell', value: x.dom?.ref_mandato || '', placeholder: String(x.a.num), disabled: !editor, style: 'width:64px', 'aria-label': 'Referencia de mandato' });
      man.addEventListener('change', async () => { try { await guardarDom(x, { ref_mandato: man.value.trim() || null }); } catch (ex) { toast(ex.message, 'error'); } });
      const lineas = doms.filter((d) => !d.archivado && d.alumno_id === x.a.id).length;
      const acciones = h('span', { class: 'ac-fila', style: 'gap:3px;flex-wrap:nowrap' },
        h('button', { class: 'ac-rbtn', type: 'button', disabled: !editor, title: 'Duplicar la línea: el mismo alumno con otro cobro en la misma remesa (por ejemplo 1 a 1 + grupo)', 'aria-label': 'Duplicar línea', onclick: async () => { try { const d = await api.ins('ac_domiciliaciones', { alumno_id: x.a.id, remesa_id: x.dom.remesa_id }); doms.push(d); calc(); pintarVista(); pintarResumen(); } catch (ex) { toast(ex.message, 'error'); } } }, '＋'),
        h('button', { class: 'ac-rbtn', type: 'button', disabled: !editor, title: 'Archivar: ya no paga por domiciliación', 'aria-label': 'Archivar', onclick: async () => {
          if (!await confirmar({ titulo: 'Archivar', texto: `${nombreAlumno(x.a)} pasa al apartado Archivados y deja libre su hueco en la remesa ${x.rem?.nombre || ''}.`, ok: 'Archivar' })) return;
          try { await guardarDom(x, { archivado: true, archivado_el: new Date().toISOString(), archivado_remesa: x.rem?.nombre || null, remesa_id: null }); calc(); pintarTodo(); toast('Archivado'); } catch (ex) { toast(ex.message, 'error'); } } }, '📦'),
        lineas > 1 ? h('button', { class: 'ac-rbtn', type: 'button', disabled: !editor, title: 'Quitar esta línea duplicada', 'aria-label': 'Quitar línea', onclick: async () => {
          if (!await confirmar({ titulo: 'Quitar línea duplicada', texto: `Se quita esta línea de ${nombreAlumno(x.a)}; el alumno conserva las demás.`, ok: 'Quitar', peligro: true })) return;
          try { await api.del('ac_domiciliaciones', x.dom.id); doms = doms.filter((d) => d.id !== x.dom.id); calc(); pintarVista(); pintarResumen(); toast('Línea quitada'); } catch (ex) { toast(ex.message, 'error'); } } }, '✕') : null);
      return h('tr', { class: x.a.estado !== 'inscrito' ? 'ac-baja' : '' },
        h('td', { class: 'num' }, String(x.a.num)), celdaAlumno(x, av), h('td', {}, respTxt(x.a) || '—'), h('td', {}, celdaIban(x)), celdaImporte(x), h('td', {}, celdaNotas(x)), h('td', {}, man), h('td', {}, selR), h('td', {}, acciones));
    };
    return tablaOrd('main', cols, vis, fila, { clase: 'ac-domi', vacio: 'No hay líneas con esos filtros.' });
  }

  function vistaPend(vis) {
    const opc = opcionesRemesa();
    const cols = [{ t: 'ID', num: true, k: (x) => Number(x.a.num) }, { t: 'Alumno', k: (x) => nombreAlumno(x.a) }, { t: 'Responsable', k: (x) => respTxt(x.a) }, { t: 'IBAN', k: (x) => ibanDe(x) },
      { t: 'Importe', num: true, k: (x) => x.importe }, { t: 'Motivo', k: (x) => x.motivo }, { t: 'Cambios/Comentarios', k: (x) => notasDe(x.a.id).length || '' }, { t: 'Asignar remesa' }];
    const fila = (x) => {
      const av = avisosDe(x).filter((t) => t !== 'Sin remesa');
      const selR = sel(opc, '', { vacio: '— elegir remesa —', disabled: !editor, 'aria-label': 'Asignar remesa' });
      selR.className = 'ac-sin-remesa';
      selR.addEventListener('change', async () => {
        const r = lista.find((l) => l.id === selR.value); if (!r) return;
        if (!await cabeEn(r, x)) { selR.value = ''; return; }
        try { await guardarDom(x, { remesa_id: r.id, archivado: false, archivado_el: null, archivado_remesa: null }); calc(); pintarTodo(); toast(`${nombreAlumno(x.a)} pasa a la remesa ${r.nombre}`); } catch (ex) { selR.value = ''; toast(ex.message, 'error'); }
      });
      return h('tr', {}, h('td', { class: 'num' }, String(x.a.num)), celdaAlumno(x, av), h('td', {}, respTxt(x.a) || '—'), h('td', {}, celdaIban(x)), celdaImporte(x), h('td', {}, pill(x.motivo, 'warn')), h('td', {}, celdaNotas(x)), h('td', {}, selR));
    };
    return tablaOrd('pend', cols, vis, fila, { clase: 'ac-domi', vacio: 'No hay alumnos pendientes de procesar.' });
  }

  function vistaArch(vis) {
    const cols = [{ t: 'ID', num: true, k: (x) => Number(x.a.num) }, { t: 'Alumno', k: (x) => nombreAlumno(x.a) }, { t: 'Responsable', k: (x) => respTxt(x.a) }, { t: 'Método de pago actual', k: (x) => x.a.metodo_pago || '' },
      { t: 'IBAN', k: (x) => ibanDe(x) }, { t: 'Importe', num: true, k: (x) => x.importe }, { t: 'Remesa anterior', k: (x) => x.dom.archivado_remesa || '' }, { t: 'Archivado el', k: (x) => x.dom.archivado_el || '' },
      { t: 'Cambios/Comentarios', k: (x) => notasDe(x.a.id).length || '' }, { t: '' }];
    const fila = (x) => h('tr', { class: 'ac-baja' }, h('td', { class: 'num' }, String(x.a.num)), celdaAlumno(x), h('td', {}, respTxt(x.a) || '—'), h('td', {}, x.a.metodo_pago || '—'), h('td', {}, celdaIban(x)), celdaImporte(x),
      h('td', {}, x.dom.archivado_remesa || '—'), h('td', {}, x.dom.archivado_el ? fmtFecha(x.dom.archivado_el.slice(0, 10)) : '—'), h('td', {}, celdaNotas(x)),
      h('td', {}, h('button', { class: 'btn ghost small', type: 'button', disabled: !editor, title: 'Volver a Remesas / Pendientes', onclick: async () => {
        try { await guardarDom(x, { archivado: false, archivado_el: null, archivado_remesa: null }); calc(); pintarTodo(); toast(esDomi(x.a.metodo_pago) ? 'Restaurado: queda en Pendientes para asignarle remesa' : 'Restaurado a Remesas (sin remesa)'); } catch (ex) { toast(ex.message, 'error'); } } }, 'Restaurar')));
    return tablaOrd('arch', cols, vis, fila, { clase: 'ac-domi', vacio: 'No hay alumnos archivados.' });
  }

  const datosVista = () => (f.vista === 'pend' ? pend : f.vista === 'arch' ? arch : main).filter((x) => pasa(x, f.vista));
  function pintarVista() {
    const env = ver();
    avisoF.actualizar();
    if (env) {
      const q = normalizar(f.q.trim());
      if (!lineasEnvioFull.length) {
        clear(tabsEl); filtrosMain.style.display = 'none';
        statsEl.textContent = `${capitalizar(env.mes)}: solo hay totales por remesa guardados`;
        clear(listaEl, h('div', { class: 'card' }, h('p', {}, `El envío de ${capitalizar(env.mes)} solo guardó los totales de cada remesa, sin lista de alumnos.`),
          h('button', { class: 'btn primary', type: 'button', disabled: !editor, onclick: () => detallarEnvio(env) }, 'Crear lista por alumno (copia de lo actual)')));
        return;
      }
      const { vis, el } = vistaEnvio(env, q);
      filtrosMain.style.display = '';
      statsEl.textContent = `${capitalizar(env.mes)} · ${vis.length} líneas · ${fmtEUR2(cmp2(vis.reduce((s, l) => s + Number(l.importe), 0)))} · los cambios aquí solo afectan a este mes`;
      clear(tabsEl, h('button', { class: 'btn small primary', type: 'button', disabled: !editor, onclick: () => anadirAEnvio(env) }, '＋ Añadir alumno a este mes'));
      clear(listaEl, el);
      return;
    }
    const vis = datosVista();
    clear(listaEl, f.vista === 'pend' ? vistaPend(vis) : f.vista === 'arch' ? vistaArch(vis) : vistaMain(vis));
    const total = cmp2(vis.filter((x) => x.a.estado === 'inscrito').reduce((s, x) => s + x.importe, 0));
    const aviso = f.vista === 'main' ? main.filter((x) => avisosDe(x).filter((t) => t !== 'Sin remesa').length).length : 0;
    statsEl.textContent = `${vis.length} líneas · ${fmtEUR2(total)}${cambiosPor.size ? ` · ${cambiosPor.size} con cuota cambiada este mes (5–25)` : ''}${aviso ? ` · ${aviso} con avisos ⚠` : ''}`;
    clear(tabsEl, [['main', 'Remesas', main.length], ['pend', 'Pendientes de procesar', pend.length], ['arch', 'Archivados', arch.length]].map(([k, t, n]) =>
      h('button', { class: `btn small ${f.vista === k ? 'primary' : ''}`, type: 'button', 'aria-pressed': f.vista === k ? 'true' : 'false', onclick: () => { f.vista = k; pintarVista(); } }, `${t} (${n})`)));
    filtrosMain.style.display = f.vista === 'main' ? '' : 'none';
  }
  const pintarTodo = () => { calc(); pintarResumen(); pintarGestion(); pintarVista(); };

  // ---------- botón REMESAS ENVIADAS ----------
  const mesSel = sel(MESES.map((m) => [m, capitalizar(m)]), mesSiguiente());
  const btnEnviadas = h('button', { class: 'btn primary', type: 'button', disabled: !editor }, '');
  const etiquetaBtn = () => { btnEnviadas.textContent = `REMESAS ENVIADAS - ${mesSel.value.toUpperCase()}`; };
  const marcarMeses = () => [...mesSel.options].forEach((o) => { o.textContent = capitalizar(o.value) + (envios.some((e) => e.mes === o.value) ? ' ✓ enviado' : ''); });
  if (f.mes && MESES.includes(f.mes)) mesSel.value = f.mes;
  marcarMeses(); etiquetaBtn();
  mesSel.setAttribute('aria-label', 'Mes');
  mesSel.addEventListener('change', async () => { f.mes = mesSel.value; etiquetaBtn(); await cargarLineas(); await pintarResumen(); pintarVista(); });
  btnEnviadas.addEventListener('click', async () => {
    const mes = mesSel.value; calc();
    const rems = lista.map((r) => ({ r, l: cuentaRemesa(r) })).filter((x) => x.l.length);
    const total = cmp2(rems.reduce((s, x) => s + x.l.reduce((t, y) => t + y.importe, 0), 0)); const n = rems.reduce((s, x) => s + x.l.length, 0);
    const previo = envios.find((e) => e.mes === mes);
    if (!await confirmar({ titulo: `Remesas enviadas · ${capitalizar(mes)}`, texto: `Se guardará como lo enviado al banco para ${mes}: ${rems.length} remesas, ${n} cobros, ${fmtEUR2(total)}.${pend.length ? ` Ojo: hay ${pend.length} alumnos pendientes de procesar que no entran.` : ''}${previo ? ' Ya había un envío guardado de ese mes: se sustituye por una copia nueva de lo actual (se pierden sus ediciones a mano, OK y notas).' : ''}`, ok: 'Guardar envío' })) return;
    btnEnviadas.disabled = true;
    try {
      if (previo) await api.del('ac_remesa_envios', previo.id);
      const e = await api.ins('ac_remesa_envios', { curso_id: curso.id, mes });
      const res = await api.insMany('ac_remesa_envio_resumen', rems.map((x) => ({ envio_id: e.id, remesa_nombre: x.r.nombre, banco: x.r.banco, orden: x.r.orden, cobros: x.l.length, total: cmp2(x.l.reduce((s, y) => s + y.importe, 0)) })));
      await api.insMany('ac_remesa_envio_lineas', rems.flatMap((x) => x.l.map((y) => ({ envio_id: e.id, domiciliacion_id: y.dom?.id || null, alumno_id: y.a.id, ...datosLinea(y, x.r.nombre) }))));
      envios = envios.filter((x) => x.id !== previo?.id); envios.push({ ...e, resumen: res });
      marcarMeses(); await cargarLineas(); await pintarResumen(); pintarVista(); toast(`Envío de ${mes} guardado`);
    } catch (ex) { toast(ex.message, 'error'); } finally { btnEnviadas.disabled = !editor; }
  });

  // ---------- filtros y cabecera ----------
  if (f.remesa && f.remesa !== '__sin' && !lista.some((r) => r.id === f.remesa)) f.remesa = '';
  if (f.banco && !BANCOS.some((b) => (Array.isArray(b) ? b[0] : b) === f.banco)) f.banco = '';
  const busca = vincular(f, 'q', h('input', { type: 'search', placeholder: 'Buscar alumno, responsable, remesa o comentario…', style: 'min-width:260px', oninput: (e) => { f.q = e.target.value; pintarVista(); } }));
  const selRemesa = sel([['__sin', 'Sin remesa'], ...lista.map((r) => [r.id, r.nombre])], f.remesa, { vacio: 'Todas las remesas' }); vincular(f, 'remesa', selRemesa);
  selRemesa.addEventListener('change', () => { f.remesa = selRemesa.value; pintarVista(); });
  const selBanco = sel(BANCOS, f.banco, { vacio: 'Ambos bancos' }); vincular(f, 'banco', selBanco);
  selBanco.addEventListener('change', () => { f.banco = selBanco.value; pintarVista(); });
  const chk = (txt, k) => h('label', { class: 'check' }, vincular(f, k, h('input', { type: 'checkbox', onchange: (e) => { f[k] = e.target.checked; pintarVista(); } })), ' ' + txt);
  const avisoF = crearAviso({
    obtener: () => [['Búsqueda', busqueda(f.q)], ...(f.vista === 'main' ? [['Remesa', f.remesa ? (f.remesa === '__sin' ? 'Sin remesa' : lista.find((r) => r.id === f.remesa)?.nombre || '') : ''], ['Banco', f.banco], ['Solo con avisos', f.soloAvisos]] : []), ['Solo cuota cambiada este mes', f.soloCambios]],
    limpiar: () => { f.q = ''; f.remesa = ''; f.banco = ''; f.soloAvisos = false; f.soloCambios = false; pintarVista(); },
  });
  escuchar(f, () => avisoF.actualizar());
  const filtrosMain = h('span', { class: 'ac-fila', style: 'gap:8px;flex-wrap:wrap' }, selRemesa, selBanco, chk('Solo con avisos ⚠', 'soloAvisos'));
  const btnGestion = h('button', { class: 'btn', type: 'button', onclick: () => { pintarGestion(); ventana('Gestionar remesas', gestionEl, { ancho: 540 }); } }, 'Gestionar remesas');
  const csv = h('button', { class: 'btn', type: 'button', onclick: () => descargarCSV(`domiciliaciones-${curso.nombre}.csv`, [['ID', 'Alumno', 'Responsable', 'IBAN', 'Importe', 'Cambios/Comentarios', 'Mandato', 'Remesa', 'Banco'], ...main.filter((x) => pasa(x, 'main')).map((x) => [x.a.num, nombreAlumno(x.a), respTxt(x.a), ibanDe(x), x.importe.toFixed(2).replace('.', ','), notasDe(x.a.id).map((n, i) => `${i + 1}) ${n.texto}`).join(' | '), x.dom?.ref_mandato || x.a.num, x.rem?.nombre || '', x.rem ? nombreBanco(x.rem.banco) : ''])]) }, 'Descargar CSV');

  await cargarLineas();
  clear(view,
    cabecera(`Remesas · ${curso.nombre}`, 'Domiciliaciones por remesa. El mes elegido arriba manda: los meses ya enviados se editan sin afectar al resto', btnGestion, mesSel, btnEnviadas, csv, h('a', { class: 'btn ghost small', href: '#/ac_remesas_mensuales' }, 'Remesas mensuales (antiguo)')),
    resumenEl, tabsEl,
    h('div', { class: 'filters filters-2', style: 'gap:8px;flex-wrap:wrap' }, busca, filtrosMain, chk('Solo cuota cambiada este mes (5–25)', 'soloCambios')),
    avisoF, statsEl, listaEl);
  pintarResumen(); pintarGestion(); pintarVista();
}
