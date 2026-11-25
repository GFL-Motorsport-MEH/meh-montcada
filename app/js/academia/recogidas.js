// Recogidas: quién recoge a cada niño, de dónde (colegio / extraescolar), qué días y a qué hora, y las personas autorizadas.
// Incluye la hoja del día (para imprimir) y el importador de la hoja RECOGIDAS con mapeo de columnas.
import { h, clear, cargando, toast, confirmar, fmtFecha, hoyISO, normalizar, fmtEUR2, MESES } from '../ui.js';
import * as api from './api.js';
import { campo, txt, area, fecha, sel, drawer, cabecera, tabla, pill, nombreAlumno, hhmm, DIAS, DIAS_CORTO, guardarBoton, buscadorAlumno, refrescar, esVerdad } from './kit.js';
import { parseFecha } from './importar.js';
import { vista as vistaEstado, leerV, guardarV, vincular, crearAviso, busqueda } from '../vista.js';

const SERVICIOS = [['tarde', 'Tarde (colegio → academia)'], ['extraescolar', 'Extraescolar'], ['otro', 'Otro']];
const servicioTxt = (v) => (SERVICIOS.find(([k]) => k === v) || [0, v])[1].replace(/ \(.*\)/, '');
const diasTxt = (dias) => (dias || []).slice().sort().map((d) => DIAS_CORTO[d]).join(' ');
let f = null; // filtros (se crean al pintar, ya con el usuario conocido; se recuerdan al refrescar)
const PRECIO = 10; // cada pago de recogida: 10 € en efectivo
const DOCS = [['doc_autorizacion', 'autorizacion', 'Autorización'], ['doc_dni_padres', 'dni_padres', 'DNI padres']];
const faltaDoc = (r) => DOCS.some(([c]) => !r[c]);
const mesDe = (fecha) => ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(fecha.slice(5, 7)) - 1];

// Icono por documento: si está, se abre; si falta, se puede subir (aviso en rojo). Los clics no abren la ficha de la fila.
function iconoDoc(r, [col, tipo, etiqueta], { editor, recargar }) {
  const input = h('input', { type: 'file', accept: 'application/pdf,image/*', hidden: true, 'aria-label': `Subir ${etiqueta}` });
  const sube = async () => { const file = input.files[0]; input.value = ''; if (!file) return; if (file.size > 10 * 1024 * 1024) { toast('El archivo pasa de 10 MB.', 'error'); return; }
    try { const ruta = await api.subirDocRecogida(file, r.alumno_id, tipo); await api.upd('ac_recogidas', r.id, { [col]: ruta }); toast(`${etiqueta} subida`); recargar(); } catch (ex) { toast('No se ha subido: ' + ex.message, 'error'); } };
  input.addEventListener('change', sube);
  const para = (fn) => (e) => { e.stopPropagation(); fn(); };
  const abre = async () => { const w = window.open('', '_blank'); try { const url = await api.urlDocRecogida(r[col]); if (w) { w.opener = null; w.location.href = url; } else window.location.href = url; } catch (ex) { w?.close(); toast('No se puede abrir: ' + ex.message, 'error'); } };
  const ico = tipo === 'autorizacion' ? '📄' : '🪪';
  return h('span', { class: 'ac-fila', onclick: (e) => e.stopPropagation(), style: 'gap:4px;flex-wrap:nowrap' }, input,
    r[col] ? h('button', { class: 'btn small', type: 'button', title: `Ver ${etiqueta}`, disabled: !editor, onclick: para(abre) }, ico + ' ✓') : null,
    editor ? h('button', { class: r[col] ? 'btn small ghost' : 'btn small danger', type: 'button', title: r[col] ? `Cambiar ${etiqueta}` : `Falta ${etiqueta}: subir`, onclick: para(() => input.click()) }, r[col] ? '↻' : `${ico} Falta`) : (r[col] ? null : pill('falta', 'bad')));
}
let vista = 'dia';

export async function renderRecogidas(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual(); const editor = ctx.edita('ac_recogidas');
  f = vistaEstado('recogidas.f', { q: '', servicio: '', centro: '', dia: '', diaFecha: '', pq: '', pmes: '' });
  vista = leerV('recogidas.vista', 'dia');
  if (!['dia', 'todas', 'pagos'].includes(vista)) vista = 'dia';
  const [recs, alumnos, auts, pagos] = await Promise.all([api.recogidas(curso.id), api.alumnos(), api.autorizados(), api.recogidasPagos(curso.id)]);
  const autDe = new Map(); for (const a of auts) (autDe.get(a.alumno_id) || autDe.set(a.alumno_id, []).get(a.alumno_id)).push(a);
  const recargar = () => { refrescar(); };
  const centros = [...new Set(recs.map((r) => r.centro).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  if (!f.dia || f.diaFecha !== hoyISO()) { const d = new Date().getDay(); f.dia = String(d >= 1 && d <= 5 ? d : 1); f.diaFecha = hoyISO(); } // la hoja del día arranca cada día en el de hoy
  const cont = h('div'); const resumen = h('div', { class: 'small muted' }); const aviso = h('div');
  const ctxDocs = { editor, recargar };
  const quienes = (r) => (autDe.get(r.alumno_id) || []).map((a) => `${a.nombre}${a.parentesco ? ` (${a.parentesco})` : ''}${a.telefono ? ` ${a.telefono}` : ''}`);

  function pintar() {
    avisoF.actualizar();
    if (vista === 'pagos') { pintarPagos(); return; }
    const q = normalizar(f.q);
    let filas = recs.filter((r) => r.activa && (!f.servicio || r.servicio === f.servicio) && (!f.centro || r.centro === f.centro) && (!q || normalizar(`${nombreAlumno(r.alumno)} ${r.centro || ''} ${quienes(r).join(' ')}`).includes(q)));
    if (f.falta) filas = filas.filter(faltaDoc);
    if (vista === 'dia') filas = filas.filter((r) => (r.dias || []).includes(Number(f.dia))).sort((a, b) => (a.hora_recogida || '99').localeCompare(b.hora_recogida || '99') || (a.centro || '').localeCompare(b.centro || '') || nombreAlumno(a.alumno).localeCompare(nombreAlumno(b.alumno)));
    else filas = filas.sort((a, b) => nombreAlumno(a.alumno).localeCompare(nombreAlumno(b.alumno), 'es'));
    const sinFirma = recs.filter((r) => r.activa && !r.autorizacion_firmada).length; const sinAut = recs.filter((r) => r.activa && !r.sale_solo && !(autDe.get(r.alumno_id) || []).length).length;
    const sinDocs = recs.filter((r) => r.activa && faltaDoc(r)).length;
    clear(aviso, sinDocs ? h('div', { class: 'banner warn' }, h('strong', {}, `⚠ ${sinDocs} alumno${sinDocs === 1 ? '' : 's'} sin la documentación obligatoria`), ' (autorización y copia del DNI de los padres). ', h('button', { class: 'btn small', type: 'button', onclick: () => { f.falta = !f.falta; pintar(); } }, f.falta ? 'Ver todos' : 'Ver solo los que faltan')) : null);
    resumen.textContent = `${filas.length} ${vista === 'dia' ? `recogidas el ${DIAS[Number(f.dia)].toLowerCase()}` : 'servicios'} · ${sinFirma} sin autorización firmada · ${sinAut} sin personas autorizadas`;
    const cols = [
      ...(vista === 'dia' ? [{ t: 'Hora', v: (r) => hhmm(r.hora_recogida) }] : [{ t: 'Días', v: (r) => diasTxt(r.dias) }, { t: 'Hora', v: (r) => hhmm(r.hora_recogida) }]),
      { t: 'Alumno', v: (r) => h('strong', {}, nombreAlumno(r.alumno)) }, { t: 'Servicio', v: (r) => servicioTxt(r.servicio) }, { t: 'Centro', v: (r) => r.centro || '' },
      { t: 'Recoge', v: (r) => (r.sale_solo ? pill('sale solo', 'warn') : quienes(r).join(' · ') || h('span', { class: 'muted' }, 'sin autorizados')) },
      { t: 'Alergias / notas', v: (r) => [r.alumno?.intolerancias, r.observaciones].filter(Boolean).join(' · ') },
      { t: 'Firma', v: (r) => (r.autorizacion_firmada ? pill('firmada', 'ok') : pill('falta', 'bad')) },
      { t: 'Documentos', s: (r) => (faltaDoc(r) ? 'falta' : 'completos'), v: (r) => h('span', { class: 'ac-fila', style: 'gap:6px' }, DOCS.map((d) => iconoDoc(r, d, ctxDocs))) },
    ];
    clear(cont, tabla(cols, filas.slice(0, 3000), { onClick: (r) => abrir(r, { alumnos, autDe, centros, curso, ctx, recargar }), vacio: recs.length ? 'No hay recogidas con este filtro.' : 'Todavía no hay recogidas. Usa «Importar del Excel» o «+ Nueva recogida».' }));
  }
  const seg = h('div', { class: 'segmented', role: 'tablist' }, [['dia', 'Hoja del día'], ['todas', 'Todas'], ['pagos', 'Pagos']].map(([k, l]) => h('button', { class: 'seg-btn', role: 'tab', type: 'button', 'aria-selected': String(vista === k), onclick: () => { vista = k; guardarV('recogidas.vista', k); seg.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-selected', String(b.textContent === l))); selDia.hidden = k !== 'dia'; selServ.hidden = selCentro.hidden = k === 'pagos'; pintar(); } }, l)));
  // ---- pagos de recogidas: cada uno 10 € en efectivo; totales; «Llevar a Ingresos» solo cuando se pulsa ----
  function pintarPagos() {
    avisoF.actualizar(); clear(aviso); resumen.textContent = '';
    const q = normalizar(f.pq);
    const lista = pagos.filter((p) => (!f.pmes || mesDe(p.fecha) === f.pmes) && (!q || normalizar(nombreAlumno(p.alumno)).includes(q))).sort((a, b) => b.fecha.localeCompare(a.fecha) || nombreAlumno(a.alumno).localeCompare(nombreAlumno(b.alumno), 'es'));
    const suma = (l) => l.reduce((s, p) => s + Number(p.importe), 0);
    const pend = lista.filter((p) => !p.traspasado_at); const hechos = lista.filter((p) => p.traspasado_at);
    const kpi = (t, v, sub) => h('div', { class: 'card kpi' }, h('div', { class: 'label' }, t), h('div', { class: 'value' }, v), sub ? h('div', { class: 'small muted' }, sub) : null);
    const meses = MESES.filter((m) => pagos.some((p) => mesDe(p.fecha) === m));
    const porMes = meses.map((m) => { const l = pagos.filter((p) => mesDe(p.fecha) === m); return [m, l.length, suma(l)]; });
    const filtros = h('div', { class: 'filters filters-3' }, h('input', { type: 'search', placeholder: 'Buscar alumno…', value: f.pq, oninput: (e) => { f.pq = e.target.value; pintarPagos(); } }),
      sel([['', 'Todos los meses'], ...meses.map((m) => [m, m[0].toUpperCase() + m.slice(1)])], meses.includes(f.pmes) ? f.pmes : '', { onchange: (e) => { f.pmes = e.target.value; pintarPagos(); } }),
      h('div', { class: 'ac-fila' }, editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrirPago(null, { recs, alumnos, curso, recargar }) }, '+ Añadir pago') : null,
        editor ? h('button', { class: 'btn small', type: 'button', disabled: !pend.length, title: 'Suma estos pagos a la hoja Ingresos (fila Activities · Recogidas). Solo se hace cuando tú lo pides.', onclick: () => llevarAIngresos(pend) }, `Llevar a Ingresos (${pend.length} · ${fmtEUR2(suma(pend))})`) : null));
    async function llevarAIngresos(l) {
      const meses2 = [...new Set(l.map((p) => mesDe(p.fecha)))];
      if (!(await confirmar({ titulo: 'Llevar pagos a Ingresos', texto: `${l.length} pagos en efectivo · ${fmtEUR2(suma(l))}. Se suman a Ingresos → Activities · Recogidas (${meses2.join(', ')}). Después ya no se podrán borrar desde aquí.`, ok: 'Llevar a Ingresos' }))) return;
      try { const r = await api.traspasarPagosAIngresos(curso, l.map((p) => p.id), ctx.state.perfil?.id); ctx.limpiarCache?.(); toast(`${r.pagos} pagos (${fmtEUR2(r.total)}) llevados a Ingresos`); recargar(); } catch (ex) { toast('No se ha podido: ' + ex.message, 'error'); }
    }
    clear(cont, filtros,
      h('div', { class: 'kpi-row kpi-4' }, kpi('Pagos', String(lista.length), 'Cada pago: 10 € en efectivo'), kpi('Total cobrado', fmtEUR2(suma(lista))), kpi('Pendiente de llevar a Ingresos', fmtEUR2(suma(pend)), `${pend.length} pagos`), kpi('Ya en Ingresos', fmtEUR2(suma(hechos)), `${hechos.length} pagos`)),
      lista.length ? tabla([{ t: 'Fecha', v: (p) => fmtFecha(p.fecha), s: (p) => p.fecha }, { t: 'Alumno', v: (p) => h('strong', {}, nombreAlumno(p.alumno)) }, { t: 'Mes', v: (p) => mesDe(p.fecha) },
        { t: 'Importe', num: true, v: (p) => fmtEUR2(Number(p.importe)) }, { t: 'Método', v: (p) => p.metodo }, { t: 'Estado', v: (p) => (p.traspasado_at ? pill('en Ingresos', 'ok') : pill('pendiente', 'warn')) }, { t: 'Notas', v: (p) => p.notas || '' }], lista, { onClick: (p) => abrirPago(p, { recs, alumnos, curso, recargar }) }) : h('div', { class: 'card empty' }, pagos.length ? 'No hay pagos con este filtro.' : 'Todavía no hay pagos. Usa «+ Añadir pago».'),
      porMes.length ? h('div', { class: 'card' }, h('h3', { class: 'sub-titulo' }, 'Totales por mes'), tabla([{ t: 'Mes', v: (x) => x[0] }, { t: 'Pagos', num: true, v: (x) => x[1] }, { t: 'Total', num: true, v: (x) => fmtEUR2(x[2]) }], [...porMes, ['TOTAL', pagos.length, suma(pagos)]], { ordenable: false })) : null);
  }
  const selDia = sel(DIAS.slice(1, 6).map((n, i) => [String(i + 1), n]), f.dia, { onchange: (e) => { f.dia = e.target.value; pintar(); } }); selDia.hidden = vista !== 'dia';
  const selServ = sel([['', 'Todos los servicios'], ...SERVICIOS], f.servicio, { onchange: (e) => { f.servicio = e.target.value; pintar(); } });
  const selCentro = sel([['', 'Todos los centros'], ...centros], f.centro, { onchange: (e) => { f.centro = e.target.value; pintar(); } });
  selServ.hidden = selCentro.hidden = vista === 'pagos';
  vincular(f, 'servicio', selServ); vincular(f, 'centro', selCentro); vincular(f, 'dia', selDia);
  if (f.centro && !centros.includes(f.centro)) f.centro = '';
  const avisoF = crearAviso({
    obtener: () => (vista === 'pagos' ? [['Búsqueda', busqueda(f.pq)], ['Mes', f.pmes]] : [['Búsqueda', busqueda(f.q)], ['Servicio', f.servicio ? servicioTxt(f.servicio) : ''], ['Centro', f.centro]]),
    limpiar: () => { f.q = ''; f.servicio = ''; f.centro = ''; f.pq = ''; f.pmes = ''; pintar(); },
  });
  seg.addEventListener('click', () => avisoF.actualizar());
  clear(view, cabecera(`Recogidas · ${curso.nombre}`, 'Quién recoge a cada niño, de dónde y a qué hora',
    h('a', { class: 'btn small', href: '#/ac_recogidas_importar' }, 'Importar del Excel'), h('button', { class: 'btn small', type: 'button', onclick: () => window.print() }, 'Imprimir'),
    editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrir(null, { alumnos, autDe, centros, curso, ctx, recargar }) }, '+ Nueva recogida') : null),
    h('div', { class: 'filters filters-4' }, vincular(f, 'q', h('input', { type: 'search', placeholder: 'Buscar alumno, centro o persona…', oninput: (e) => { f.q = e.target.value; pintar(); } })),
      h('div', {}, seg, selDia), selServ, selCentro), avisoF, aviso, resumen, cont);
  pintar();
}

async function abrir(r, { alumnos, autDe, centros, curso, ctx, recargar }) {
  const editor = ctx.edita('ac_recogidas');
  const d = drawer({ titulo: r ? `Recogida · ${nombreAlumno(r.alumno)}` : 'Nueva recogida', ancho: 640 });
  const dl = h('datalist', { id: 'dl-centros' }, centros.map((c) => h('option', { value: c })));
  const checks = [1, 2, 3, 4, 5].map((n) => h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: (r?.dias || []).includes(n), disabled: !editor }), ` ${DIAS_CORTO[n]}`));
  const F = { al: buscadorAlumno(alumnos, { valorId: r?.alumno?.id }), servicio: sel(SERVICIOS, r?.servicio || 'tarde'), centro: txt(r?.centro, { list: 'dl-centros', placeholder: 'Colegio o escuela de origen' }), hora: h('input', { type: 'time', value: hhmm(r?.hora_recogida) }),
    solo: h('input', { type: 'checkbox', checked: !!r?.sale_solo }), firmada: h('input', { type: 'checkbox', checked: !!r?.autorizacion_firmada }), fautor: fecha(r?.fecha_autorizacion), obs: area(r?.observaciones) };
  d.cuerpo.append(dl, h('div', { class: 'form-section' }, campo('Alumno', F.al, { full: true, req: true }), campo('Servicio', F.servicio), campo('Centro de origen', F.centro), campo('Hora de recogida', F.hora),
    campo('Días', h('div', { class: 'ac-fila' }, checks)), h('label', { class: 'check' }, F.solo, ' Puede salir solo al terminar (autorización de salida sin acompañante)'),
    h('label', { class: 'check' }, F.firmada, ' Autorización firmada'), campo('Fecha de la autorización', F.fautor), campo('Observaciones', F.obs, { full: true })));

  // documentación obligatoria de los padres (aviso si falta)
  if (r) {
    const bloque = h('div');
    const pintarDocs = () => { clear(bloque, faltaDoc(r) ? h('div', { class: 'banner warn' }, `⚠ Falta: ${DOCS.filter(([c]) => !r[c]).map((d) => d[2]).join(' y ')}. Es obligatorio.`) : null,
      h('div', { class: 'ac-fila' }, DOCS.map((d) => h('span', {}, h('strong', {}, d[2] + ': '), iconoDoc(r, d, { editor, recargar: () => { d_cerrar(); recargar(); } }))))); };
    const d_cerrar = () => d.cerrar();
    pintarDocs(); d.cuerpo.append(h('div', { class: 'form-section' }, h('h3', {}, 'Documentación de los padres'), h('div', { class: 'full' }, bloque)));
  }

  // personas autorizadas (solo se pueden gestionar con la recogida ya guardada)
  const caja = h('div'); let auts = []; let priv = new Map();
  async function cargarAuts(alumnoId) {
    auts = (await api.autorizados()).filter((a) => a.alumno_id === alumnoId);
    priv = new Map((await api.autorizadosPriv(auts.map((a) => a.id))).map((p) => [p.autorizado_id, p.dni]));
    pintarAuts(alumnoId);
  }
  function pintarAuts(alumnoId) {
    clear(caja, auts.map((a) => h('div', { class: 'ac-fila' }, h('strong', {}, a.nombre), h('span', { class: 'muted small' }, [a.parentesco, a.telefono, editor && priv.get(a.id)].filter(Boolean).join(' · ')),
      editor ? h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { try { await api.del('ac_autorizados', a.id); await cargarAuts(alumnoId); } catch (ex) { toast(ex.message, 'error'); } } }, 'Quitar') : null)), auts.length ? null : h('div', { class: 'muted small' }, 'Sin personas autorizadas.'));
  }
  if (r) {
    await cargarAuts(r.alumno_id);
    const n = { nombre: txt('', { placeholder: 'Nombre y apellidos' }), par: txt('', { placeholder: 'Parentesco' }), tel: txt('', { placeholder: 'Teléfono' }), dni: txt('', { placeholder: 'DNI' }) };
    const add = h('button', { class: 'btn small', type: 'button', onclick: async () => {
      if (!n.nombre.value.trim()) { toast('Escribe el nombre de la persona.', 'error'); return; }
      try { const a = await api.ins('ac_autorizados', { alumno_id: r.alumno_id, nombre: n.nombre.value.trim(), parentesco: n.par.value.trim() || null, telefono: n.tel.value.trim() || null, orden: auts.length });
        if (n.dni.value.trim()) await api.ins('ac_autorizados_priv', { autorizado_id: a.id, dni: n.dni.value.trim() });
        Object.values(n).forEach((i) => { i.value = ''; }); await cargarAuts(r.alumno_id); } catch (ex) { toast(ex.message, 'error'); } } }, 'Añadir');
    d.cuerpo.append(h('div', { class: 'form-section' }, h('h3', {}, 'Personas autorizadas a recoger'), h('div', { class: 'full' }, caja, editor ? h('div', { class: 'ac-fila' }, n.nombre, n.par, n.tel, n.dni, add) : null)));
  } else d.cuerpo.append(h('div', { class: 'small muted' }, 'Guarda la recogida y después añade las personas autorizadas a recoger.'));

  const guardar = guardarBoton('Guardar', async () => {
    const al = F.al.getAlumno() || (r ? alumnos.find((x) => x.id === r.alumno_id) : null);
    if (!al) { toast('Elige un alumno de la lista.', 'error'); return; }
    const fila = { alumno_id: al.id, curso_id: curso.id, servicio: F.servicio.value, centro: F.centro.value.trim() || null, dias: checks.map((c, i) => (c.querySelector('input').checked ? i + 1 : 0)).filter(Boolean), hora_recogida: F.hora.value || null,
      sale_solo: F.solo.checked, autorizacion_firmada: F.firmada.checked, fecha_autorizacion: F.fautor.value || null, observaciones: F.obs.value.trim() || null };
    try { r ? await api.upd('ac_recogidas', r.id, fila) : await api.ins('ac_recogidas', fila); toast('Recogida guardada'); d.cerrar(); recargar(); } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
  });
  guardar.disabled = !editor;
  const borrar = r && editor ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Quitar recogida', texto: nombreAlumno(r.alumno), ok: 'Quitar', peligro: true })) { try { await api.del('ac_recogidas', r.id); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } } }, 'Quitar') : h('span');
  d.pie.append(borrar, guardar);
}

// ---------------------------- importación con mapeo de columnas ----------------------------
const claveNombre = (s) => normalizar(String(s ?? '')).split(/\s+/).filter(Boolean).sort().join(' ');
const t = (v) => (v === null || v === undefined ? '' : String(v).trim());
const CAMPOS = [
  ['alumno', 'Alumno (nombre completo)', /^(nombre )?(y )?(apellidos? )?(del )?(alumn|nino|niño|nombre)|alumno|^nombre$/],
  ['ape', 'Apellidos del alumno (si van aparte)', /apellid/], ['nom', 'Nombre del alumno (si va aparte)', /^nombre alumn|^nom$/],
  ['servicio', 'Servicio (tarde / extraescolar)', /servicio|tipo|actividad/], ['centro', 'Centro / colegio de origen', /centro|colegio|escuela|cole\b/],
  ['dias', 'Días', /dias|dia\b|horario/], ['hora', 'Hora de recogida', /hora/], ['solo', 'Sale solo (sí/no)', /solo|sin acompan|autoriza.*salida|salida/],
  ['firma', 'Autorización firmada (sí/no)', /firma|autorizacion|autorizacion/], ['obs', 'Observaciones', /observ|coment|notas?|alerg|intoler/],
  ['a1', 'Persona autorizada 1', /autoriz.*1|recoge 1|persona 1|adulto 1|^recoge|^recogida|adulto|persona/], ['a2', 'Persona autorizada 2', /autoriz.*2|recoge 2|persona 2|adulto 2/],
  ['a3', 'Persona autorizada 3', /autoriz.*3|recoge 3|persona 3|adulto 3/], ['a4', 'Persona autorizada 4', /autoriz.*4|recoge 4|persona 4|adulto 4/],
];
export function parseDias(v) {
  const s = normalizar(t(v)); if (!s) return [];
  const out = new Set();
  const pal = [['lunes', 1], ['martes', 2], ['miercoles', 3], ['jueves', 4], ['viernes', 5]];
  for (const [p, n] of pal) if (s.includes(p) || s.includes(p.slice(0, 3) + '.')) out.add(n);
  if (!out.size && /^[lmxjv\s,\-/y&+]+$/.test(s)) for (const c of s) { const n = { l: 1, m: 2, x: 3, j: 4, v: 5 }[c]; if (n) out.add(n); }
  if (/todos|lunes a viernes|l-v|l a v/.test(s)) [1, 2, 3, 4, 5].forEach((n) => out.add(n));
  return [...out].sort();
}
export function parseHora(v) {
  if (v instanceof Date) return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  if (typeof v === 'number' && v > 0 && v < 1) { const m = Math.round(v * 1440); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
  const m = t(v).match(/(\d{1,2})[:.hH](\d{2})?/); return m ? `${m[1].padStart(2, '0')}:${m[2] || '00'}` : null;
}
export function parseAutorizado(v) {
  const s = t(v); if (!s) return null;
  const tel = (s.match(/(?:\+?34)?\s?([6-9]\d{2}[\s.-]?\d{3}[\s.-]?\d{3})/) || [])[1]?.replace(/\D/g, '') || null;
  const par = (s.match(/\(([^)]+)\)/) || [])[1]?.trim() || null;
  const nombre = s.replace(/\([^)]*\)/g, '').replace(/(?:\+?34)?\s?[6-9]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/, '').replace(/\s+/g, ' ').replace(/[-–,;:\s]+$/, '').trim();
  return nombre ? { nombre, parentesco: par, telefono: tel } : null;
}

export async function renderImportarRecogidas(view, ctx) {
  const editor = ctx.edita('ac_recogidas'); const salida = h('div');
  const input = h('input', { type: 'file', accept: '.xlsx,.xls', disabled: !editor, 'aria-label': 'Archivo Excel' });
  let libro = null;
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    clear(salida, cargando());
    try {
      const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      libro = { nombres: wb.SheetNames, filas: (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) };
      const pref = libro.nombres.find((n) => /recog/i.test(n)) || libro.nombres[0];
      await mapear(pref);
    } catch (ex) { clear(salida, h('div', { class: 'banner error' }, 'No se ha podido leer el archivo: ' + ex.message)); }
  });

  async function mapear(hoja) {
    const filas = libro.filas(hoja);
    let hi = filas.findIndex((r) => (r || []).filter((c) => t(c)).length >= 3); if (hi < 0) hi = 0;
    const cab = (filas[hi] || []).map((c) => t(c)); const datos = filas.slice(hi + 1).filter((r) => (r || []).some((c) => t(c)));
    const cabN = cab.map((c) => normalizar(c));
    const usados = new Set(); const auto = {};
    for (const [k, , re] of CAMPOS) { const i = cabN.findIndex((c, j) => c && !usados.has(j) && re.test(c)); if (i >= 0) { auto[k] = i; usados.add(i); } }
    // cabeceras típicas «Alumnos Apellidos» + «Nombre»: se usan como dos columnas y no como nombre completo
    const iApe = cabN.findIndex((c) => /apellid/.test(c) && !/respons|adult|madre|padre|tutor/.test(c)); const iNom = cabN.findIndex((c) => /^nombre$|^nombre alumn|^nom$/.test(c));
    if (iApe >= 0 && iNom >= 0 && iApe !== iNom && !/nombre y|nombre completo/.test(cabN[auto.alumno] || '')) { auto.ape = iApe; auto.nom = iNom; delete auto.alumno; }
    const selects = {};
    const opciones = [['', '— no importar —'], ...cab.map((c, i) => [String(i), c || `(columna ${i + 1})`])];
    const mapaUI = h('div', { class: 'form-section' }, CAMPOS.map(([k, label]) => { selects[k] = sel(opciones, auto[k] !== undefined ? String(auto[k]) : '', { onchange: () => previa() }); return campo(label, selects[k]); }));
    const prev = h('div');
    const hojaSel = sel(libro.nombres, hoja, { onchange: (e) => mapear(e.target.value) });
    clear(salida, h('div', { class: 'card' }, h('div', { class: 'ac-fila' }, h('strong', {}, 'Hoja:'), hojaSel, h('span', { class: 'muted small' }, `${datos.length} filas, cabecera en la fila ${hi + 1}`)),
      h('p', { class: 'small muted' }, 'Revisa que cada campo apunte a la columna correcta (se han detectado por el nombre de la cabecera). Solo hace falta el alumno.'), mapaUI), prev);

    async function previa() {
      const col = (k) => (selects[k].value === '' ? -1 : Number(selects[k].value));
      const get = (r, k) => (col(k) < 0 ? null : r[col(k)]);
      const [alumnos, previas, curso] = [await api.alumnos(), await api.recogidas(ctx.cursoActual().id), ctx.cursoActual()];
      const porNombre = new Map(); const dup = new Set();
      for (const a of alumnos) { const k = claveNombre(`${a.nombre} ${a.apellidos}`); if (porNombre.has(k)) dup.add(k); porNombre.set(k, a); }
      const ya = new Set(previas.map((p) => `${p.alumno_id}|${p.servicio}`));
      const lista = []; const sin = [];
      for (const r of datos) {
        const nombreAl = ['nom', 'ape', 'alumno'].map((k) => t(get(r, k))).filter(Boolean).join(' ');
        if (!nombreAl) continue;
        const k = claveNombre(nombreAl); const a = !dup.has(k) ? porNombre.get(k) : null;
        if (!a) { sin.push(nombreAl); continue; }
        const sv = normalizar(t(get(r, 'servicio')));
        const rec = { alumno_id: a.id, curso_id: curso.id, servicio: /extra/.test(sv) ? 'extraescolar' : /tarde|cole/.test(sv) || !sv ? 'tarde' : 'otro', centro: t(get(r, 'centro')) || null, dias: parseDias(get(r, 'dias')), hora_recogida: parseHora(get(r, 'hora')),
          sale_solo: col('solo') >= 0 && esVerdad(t(get(r, 'solo'))) || /^(si|sí)\b/.test(normalizar(t(get(r, 'solo')))), autorizacion_firmada: col('firma') >= 0 && (esVerdad(t(get(r, 'firma'))) || /^(si|sí|ok|firmad)/.test(normalizar(t(get(r, 'firma'))))), observaciones: t(get(r, 'obs')) || null };
        const autor = ['a1', 'a2', 'a3', 'a4'].flatMap((x) => t(get(r, x)).split(/[;\n/]+/)).map(parseAutorizado).filter(Boolean);
        lista.push({ rec, autor, nombreAl });
      }
      const nuevos = lista.filter((x) => !ya.has(`${x.rec.alumno_id}|${x.rec.servicio}`));
      clear(prev, h('div', { class: 'card' }, h('p', {}, h('strong', {}, `${nuevos.length} recogidas nuevas`), ` de ${lista.length} enlazadas con un alumno (${lista.length - nuevos.length} ya existían). `, h('strong', {}, `${sin.length}`), ' filas sin alumno en la base de datos.'),
        tabla([{ t: 'Alumno', v: (x) => x.nombreAl }, { t: 'Servicio', v: (x) => servicioTxt(x.rec.servicio) }, { t: 'Centro', v: (x) => x.rec.centro || '' }, { t: 'Días', v: (x) => diasTxt(x.rec.dias) }, { t: 'Hora', v: (x) => x.rec.hora_recogida || '' }, { t: 'Autorizados', v: (x) => x.autor.map((a) => a.nombre).join(', ') }], nuevos.slice(0, 6)),
        sin.length ? h('details', {}, h('summary', {}, 'Ver los nombres sin enlazar'), h('ul', {}, [...new Set(sin)].slice(0, 60).map((s) => h('li', {}, s)))) : null,
        nuevos.length ? guardarBoton(`Importar ${nuevos.length} recogidas`, async () => {
          try {
            const creadas = await api.insMany('ac_recogidas', nuevos.map((x) => x.rec));
            const porAlumno = new Map(creadas.map((c) => [c.alumno_id, c]));
            const existentes = (await api.autorizados()).map((a) => `${a.alumno_id}|${normalizar(a.nombre)}`); const claves = new Set(existentes);
            const filasAut = []; for (const x of nuevos) x.autor.forEach((a, i) => { const k = `${x.rec.alumno_id}|${normalizar(a.nombre)}`; if (!claves.has(k)) { claves.add(k); filasAut.push({ alumno_id: x.rec.alumno_id, nombre: a.nombre, parentesco: a.parentesco, telefono: a.telefono, orden: i }); } });
            if (filasAut.length) await api.insMany('ac_autorizados', filasAut);
            toast(`${creadas.length} recogidas y ${filasAut.length} personas autorizadas importadas.`); location.hash = '#/ac_recogidas';
          } catch (ex) { toast('Error al importar: ' + ex.message, 'error'); }
        }) : null));
    }
    await previa();
  }

  clear(view, cabecera('Importar recogidas', 'Carga la hoja RECOGIDAS del Excel «Control Alumnos»', h('a', { class: 'btn small', href: '#/ac_recogidas' }, '← Volver a Recogidas')),
    h('div', { class: 'banner' }, h('strong', {}, 'Importa antes los alumnos. '), 'Cada fila se enlaza con el alumno por su nombre (el orden de nombre y apellidos da igual). Los nombres que no coincidan se muestran para que los corrijas y vuelvas a importar.'),
    editor ? null : h('div', { class: 'banner warn' }, 'Tu rol no permite importar.'),
    h('div', { class: 'card' }, h('p', { class: 'small' }, 'Elige el Excel de Control Alumnos (Drive → Archivo → Descargar → Microsoft Excel) o un Excel solo con la hoja RECOGIDAS. Después puedes ajustar qué columna es cada campo. Reimportar no duplica.'), input), salida);
}

// ---------------------------- pagos de recogidas ----------------------------
function abrirPago(p, { recs, alumnos, curso, recargar }) {
  const bloqueado = !!p?.traspasado_at;
  const d = drawer({ titulo: p ? `Pago · ${nombreAlumno(p.alumno)}` : 'Nuevo pago de recogida', ancho: 480 });
  const conRec = new Map(recs.filter((r) => r.activa).map((r) => [r.alumno_id, r]));
  const F = { al: buscadorAlumno(alumnos.filter((a) => conRec.has(a.id)), { valorId: p?.alumno_id }), fecha: fecha(p?.fecha || hoyISO()), importe: h('input', { type: 'text', inputmode: 'decimal', 'data-punto': '1', autocomplete: 'off', step: '0.01', min: '0', value: p ? p.importe : PRECIO }), metodo: txt('efectivo', { disabled: true }), notas: area(p?.notas) };
  [F.fecha, F.importe, F.notas].forEach((i) => { i.disabled = bloqueado; });
  d.cuerpo.append(bloqueado ? h('div', { class: 'banner' }, 'Este pago ya está en Ingresos: no se puede modificar desde aquí.') : null,
    h('div', { class: 'form-section' }, campo('Alumno (con recogida activa)', F.al, { full: true, req: true }), campo('Fecha', F.fecha), campo('Importe (€)', F.importe), campo('Método', F.metodo), campo('Notas', F.notas, { full: true })));
  const guardar = guardarBoton('Guardar', async () => {
    const al = F.al.getAlumno() || (p ? { id: p.alumno_id } : null); const rec = al && conRec.get(al.id);
    if (!rec) { toast('Elige un alumno que tenga una recogida activa.', 'error'); return; }
    const imp = Number(F.importe.value); if (!(imp >= 0) || F.importe.value === '') { toast('Importe no válido.', 'error'); return; }
    const fila = { recogida_id: rec.id, alumno_id: al.id, curso_id: curso.id, fecha: F.fecha.value || hoyISO(), importe: imp, metodo: 'efectivo', notas: F.notas.value.trim() || null };
    try { p ? await api.upd('ac_recogidas_pagos', p.id, fila) : await api.ins('ac_recogidas_pagos', fila); toast('Pago guardado'); d.cerrar(); recargar(); } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
  });
  guardar.hidden = bloqueado;
  const borrar = p && !bloqueado ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Borrar pago', texto: `${nombreAlumno(p.alumno)} · ${fmtEUR2(Number(p.importe))}`, ok: 'Borrar', peligro: true })) { try { await api.del('ac_recogidas_pagos', p.id); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } } }, 'Borrar') : h('span');
  d.pie.append(borrar, guardar);
}
