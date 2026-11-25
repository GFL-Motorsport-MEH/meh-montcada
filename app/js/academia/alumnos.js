// Alumnos: listado con filtros y ficha (datos, inscripción del curso, grupos, cuotas, anotaciones y tutorías).
import { h, clear, cargando, toast, confirmar, fmtFecha, fmtEUR2, hoyISO, normalizar, MESES, capitalizar } from '../ui.js';
import * as api from './api.js';
import { avisosAlumnoGrupo, confirmarAvisos } from './avisos.js';
import { campo, txt, area, fecha, numero, sel, drawer, cabecera, tabla, pill, edad, nombreAlumno, pillNivel, hhmm, DIAS_CORTO, guardarBoton, buscadorAlumno, refrescar } from './kit.js';

import { calcularFamilias, esActivo, esDescHermanos } from './familias.js';
import { abrirEscaneo } from './escanear.js';
import { esDomi, ofrecerRemesas } from './alta_remesas.js';
import { vista as vistaEstado, vincular, avisoFiltros, busqueda } from '../vista.js';
import { pillMotivo, permanencia, colorMotivo as colorMotivoFicha } from './bajas.js';

const ESTADOS = [['inscrito', 'Inscrito'], ['prematricula', 'Pre-matrícula'], ['baja', 'Baja'], ['antiguo', 'Antiguo']];
const pillEstado = (e) => pill((ESTADOS.find((x) => x[0] === e) || [0, e])[1], e === 'inscrito' ? 'ok' : e === 'prematricula' ? 'warn' : 'off');
export const resumenSesiones = (g) => (g?.sesiones || []).slice().sort((a, b) => a.dia - b.dia).map((s) => `${DIAS_CORTO[s.dia]} ${hhmm(s.hora_inicio)}`).join(' · ');

// «No tienen» es el valor de «sin alergias»: se ve en la ficha, pero en la tabla se deja en blanco para distinguir quién sí tiene.
const sinAlergia = (a) => /^no tienen?$/i.test(String(a.intolerancias || '').trim());

// Datos obligatorios de todo alumno. priv = { dni } solo si el usuario puede ver la tabla privada (si no, el DNI no se evalúa).
export function faltantesAlumno(a, priv = null) {
  const v = (x) => !!String(x ?? '').trim(); const m = []; const r = a.responsable;
  if (!v(a.nombre) || !v(a.apellidos)) m.push('Nombre y apellidos del alumno');
  if (!r) m.push('Responsable (nombre, apellidos, teléfono, correo y DNI)');
  else {
    if (!v(r.nombre) || !v(r.apellidos)) m.push('Nombre y apellidos del responsable');
    if (!v(r.telefono)) m.push('Teléfono del responsable');
    if (!v(r.email)) m.push('Correo del responsable');
    if (priv && !v(priv.dni)) m.push('DNI del responsable');
  }
  if (!v(a.metodo_pago)) m.push('Modo de pago');
  if (!v(a.intolerancias)) m.push('Alergias (si no tiene, poner «No tienen»)');
  return m;
}

export async function renderAlumnos(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const [alumnos, gruposAl0, insc, ls, grupos0, vinc] = await Promise.all([api.alumnos(), api.gruposDeAlumnos(curso.id), api.inscripciones(curso.id), api.listas(), api.grupos(curso.id), api.vinculos().catch(() => [])]);
  // DNI de los responsables: solo lo ve quien puede ver Pagos (tabla privada)
  const dniPor = new Map();
  if (ctx.ve('ac_pagos')) { try { for (const p of await api.privados([...new Set(alumnos.map((x) => x.responsable?.id).filter(Boolean))])) dniPor.set(p.responsable_id, p.dni); } catch { /* sin permiso: no se avisa del DNI */ } }
  const faltan = (a) => faltantesAlumno(a, ctx.ve('ac_pagos') ? { dni: dniPor.get(a.responsable?.id) } : null);
  let gruposAl = gruposAl0; let grupos = grupos0;
  const inscPor = new Map(insc.map((i) => [i.alumno_id, i]));
  const verPagos = ctx.ve('ac_pagos'); const editaPagos = ctx.edita('ac_pagos'); const editaAl = ctx.edita('ac_alumnos');
  const fam = calcularFamilias(alumnos, vinc);
  const descPor = verPagos ? new Map(insc.map((i) => [i.alumno_id, i.descuento])) : null;
  const f = vistaEstado('alumnos.f', { q: '', estado: 'inscrito', modalidad: '', grupo: '', hermanos: '', incompletos: '' }); // el modo «editar en tabla» no se recuerda
  f.editar = false;
  const todosGrupos = [...new Set(grupos.map((g) => g.nombre))].sort();
  if (f.grupo && !todosGrupos.includes(f.grupo)) f.grupo = '';
  if (f.modalidad && !(ls.modalidad || []).includes(f.modalidad)) f.modalidad = '';
  if (f.estado && !ESTADOS.some(([k]) => k === f.estado)) f.estado = 'inscrito';
  const colegios = h('datalist', { id: 'dl-colegio-lista' }, [...new Set(alumnos.map((x) => x.colegio).filter(Boolean))].sort().map((c) => h('option', { value: c })));
  const niveles = h('datalist', { id: 'dl-nivel-lista' }, (ls.nivel || []).map((c) => h('option', { value: c })));

  const contenedor = h('div', { class: 'ac-lista' });
  const contador = h('div', { class: 'count' });
  const recargar = () => { api.invalidar(); refrescar(); };

  // guarda un campo del alumno al salir de la celda (edición en tabla)
  async function guardarCampo(a, campo, valor) {
    const v = typeof valor === 'string' ? valor.trim() || null : valor;
    if ((a[campo] ?? null) === v) return;
    try { const antes = a[campo]; await api.upd('ac_alumnos', a.id, { [campo]: v }); a[campo] = v; toast('Guardado'); if ((campo === 'metodo_pago' && esDomi(v) && !esDomi(antes) && a.estado === 'inscrito') || (campo === 'estado' && v === 'inscrito' && antes !== 'inscrito' && esDomi(a.metodo_pago))) await ofrecerRemesas(a, ctx); } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
  }
  async function guardarInscripcion(a, parche) {
    try {
      const i = inscPor.get(a.id);
      const r = i ? await api.upd('ac_inscripciones', i.id, parche) : await api.ins('ac_inscripciones', { alumno_id: a.id, curso_id: curso.id, ...parche });
      inscPor.set(a.id, r); descPor?.set(a.id, r.descuento); toast('Guardado');
    } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
  }
  async function recargarGrupos() { api.invalidar(); [grupos, gruposAl] = await Promise.all([api.grupos(curso.id), api.gruposDeAlumnos(curso.id)]); pintar(); }
  async function anadirGrupo(a, grupoId) {
    try {
      const g = grupos.find((x) => x.id === grupoId); const previo = g?.miembros.find((m) => m.alumno_id === a.id);
      if (previo) await api.upd('ac_alumno_grupo', previo.id, { fecha_baja: null }); else await api.ins('ac_alumno_grupo', { alumno_id: a.id, grupo_id: grupoId });
      toast('Añadido al grupo'); await recargarGrupos();
    } catch (ex) { toast(ex.message, 'error'); }
  }
  async function quitarGrupo(a, g) {
    try { const m = g.miembros.find((x) => x.alumno_id === a.id && !x.fecha_baja); await api.upd('ac_alumno_grupo', m.id, { fecha_baja: hoyISO() }); toast('Quitado del grupo'); await recargarGrupos(); } catch (ex) { toast(ex.message, 'error'); }
  }

  // celdas editables
  const inp = (a, campo, extra = {}) => { const e = h('input', { type: 'text', value: a[campo] ?? '', class: 'ac-celda', ...extra }); e.addEventListener('change', () => guardarCampo(a, campo, e.value)); return e; };
  const selc = (a, campo, ops, vacio = '—') => { const e = sel(ops, a[campo], { ...(vacio === false ? {} : { vacio }), class: 'ac-celda' }); e.addEventListener('change', () => guardarCampo(a, campo, e.value)); return e; };
  const celdaGrupos = (a) => {
    const mios = gruposAl.get(a.id) || [];
    if (!f.editar) return mios.map((g) => g.nombre).join(', ');
    const libres = grupos.filter((g) => !mios.includes(g)).sort((x, y) => x.nombre.localeCompare(y.nombre, 'es', { numeric: true }));
    const s = sel([['', '+ grupo']], '', { class: 'ac-celda ac-celda-grupo', 'aria-label': 'Añadir a un grupo' });
    for (const g of libres) s.append(h('option', { value: g.id }, `${g.nombre}${resumenSesiones(g) ? ' · ' + resumenSesiones(g) : ''}`));
    s.addEventListener('change', () => { if (s.value) anadirGrupo(a, s.value); });
    return h('div', { class: 'ac-grupos-edit' }, mios.map((g) => h('span', { class: 'ac-chip' }, g.nombre, h('button', { type: 'button', class: 'ac-chip-x', title: `Quitar de ${g.nombre}`, 'aria-label': `Quitar de ${g.nombre}`, onclick: () => quitarGrupo(a, g) }, '×'))), s);
  };
  const celdaFamilia = (a) => {
    const rel = fam.de(a.id); if (!rel.length) return '';
    const r = fam.resumen(a.id, descPor);
    const clase = r.aplicado === false ? 'aviso' : r.aplicado === true ? 'ok' : '';
    const lista = rel.map((x) => `${nombreAlumno(x.alumno)}${esActivo(x.alumno) ? '' : ' (' + x.alumno.estado + ')'} — ${x.motivos.join(', ')}`).join('\n');
    const msg = r.activos >= 2 && r.aplicado === false ? '\n⚠ Hay hermanos inscritos y ninguno tiene el descuento de hermanos.' : '';
    return h('span', { class: `ac-fam ${clase}`, title: lista + msg }, `👪 ${rel.length}`, r.aplicado === false ? ' ⚠' : '');
  };
  const celdaComentario = (a) => {
    if (f.editar) { const e = inp(a, 'info', { placeholder: 'Comentario' }); e.classList.add('ac-celda-coment'); return e; }
    return h('button', { type: 'button', class: 'ac-coment' + (a.info ? ' tiene' : ''), title: a.info || 'Sin comentarios', 'aria-label': a.info ? `Comentario: ${a.info}` : 'Sin comentarios', onclick: (e) => { e.stopPropagation(); abrirFicha(a, ctx, recargar); } }, '💬');
  };

  function pintar() {
    const q = normalizar(f.q);
    const filas = alumnos.filter((a) => {
      if (f.estado && a.estado !== f.estado) return false;
      if (f.modalidad && a.modalidad !== f.modalidad) return false;
      if (f.grupo && !(gruposAl.get(a.id) || []).some((g) => g.nombre === f.grupo)) return false;
      if (f.hermanos) {
        const r = fam.resumen(a.id, descPor);
        if (r.activos < 2 || !esActivo(a)) return false;
        if (f.hermanos === 'sin' && r.aplicado !== false) return false;
      }
      if (f.incompletos && (!esActivo(a) || !faltan(a).length)) return false;
      if (q && !normalizar(`${a.apellidos} ${a.nombre} ${a.num || ''} ${a.colegio || ''} ${a.responsable?.apellidos || ''} ${a.responsable?.nombre || ''} ${a.responsable?.telefono || ''}`).includes(q)) return false;
      return true;
    });
    contador.textContent = `${filas.length} de ${alumnos.length} alumnos`;
    const e = f.editar;
    const cols = [
      { t: 'Nº', s: (a) => Number(a.num) || 0, v: (a) => (e ? h('input', { type: 'text', inputmode: 'decimal', value: a.num ?? '', class: 'ac-celda ac-celda-num', 'aria-label': 'ID del alumno', onchange: (ev) => { const t = ev.target.value.trim().replace(',', '.'); if (t && !Number.isFinite(Number(t))) { toast('El ID debe ser un número.', 'error'); ev.target.value = a.num ?? ''; return; } guardarCampo(a, 'num', t ? Number(t) : null); } }) : a.num ?? '') },
      { t: 'Datos', s: (a) => (esActivo(a) ? faltan(a).length : 0), v: (a) => { if (!esActivo(a)) return ''; const m = faltan(a); return m.length ? h('span', { class: 'ac-faltan', title: 'Faltan datos obligatorios:\n· ' + m.join('\n· ') }, '⚠ ' + m.length) : h('span', { class: 'ac-ok', title: 'Datos obligatorios completos' }, '✓'); } },
      { t: 'Alumno', s: (a) => nombreAlumno(a), v: (a) => (e ? h('div', { class: 'ac-nombre-edit' }, inp(a, 'apellidos', { placeholder: 'Apellidos', required: true }), inp(a, 'nombre', { placeholder: 'Nombre', required: true }), h('button', { type: 'button', class: 'btn small ghost', title: 'Abrir ficha', 'aria-label': 'Abrir ficha', onclick: () => abrirFicha(a, ctx, recargar) }, '↗')) : h('strong', {}, nombreAlumno(a))) },
      { t: 'Familia', s: (a) => (fam.de(a.id).length ? `hermanos ${fam.resumen(a.id, descPor).aplicado === false ? 'sin descuento' : ''}` : ''), v: celdaFamilia },
      { t: 'Edad', v: (a) => edad(a.fecha_nacimiento) },
      { t: 'Colegio', s: (a) => a.colegio || '', v: (a) => (e ? inp(a, 'colegio', { list: 'dl-colegio-lista' }) : a.colegio || '') },
      { t: 'Responsable', v: (a) => (a.responsable ? `${a.responsable.nombre} ${a.responsable.apellidos}`.trim() : '') },
      { t: 'Teléfono', v: (a) => a.responsable?.telefono || '' },
      { t: 'Modalidad · nivel', s: (a) => [a.modalidad, a.nivel].filter(Boolean).join(' · '), v: (a) => (e ? h('div', { class: 'ac-nombre-edit' }, selc(a, 'modalidad', ls.modalidad || []), inp(a, 'nivel', { list: 'dl-nivel-lista', placeholder: 'Nivel' })) : h('span', {}, a.modalidad || '', a.modalidad && a.nivel ? ' · ' : '', pillNivel(a.nivel))) },
      { t: 'Grupos', s: (a) => (gruposAl.get(a.id) || []).map((g) => g.nombre).join(', '), v: celdaGrupos },
      { t: 'Alergias', s: (a) => (sinAlergia(a) ? '' : a.intolerancias || ''), v: (a) => (e ? inp(a, 'intolerancias', { placeholder: 'Alergias / intolerancias', ...(sinAlergia(a) ? { value: '' } : {}) }) : a.intolerancias && !sinAlergia(a) ? h('span', { class: 'ac-alergia', title: a.intolerancias }, '⚠ ' + a.intolerancias) : '') },
      { t: 'RRSS', s: (a) => (a.autoriza_rrss ? 'Sí' : 'No'), v: (a) => { if (!e) return pill(a.autoriza_rrss ? 'Sí' : 'No', a.autoriza_rrss ? 'ok' : 'off'); const c = h('input', { type: 'checkbox', checked: !!a.autoriza_rrss, 'aria-label': 'Autoriza redes sociales' }); c.addEventListener('change', () => guardarCampo(a, 'autoriza_rrss', c.checked)); return c; } },
      ...(verPagos ? [{ t: 'Pago', s: (a) => a.metodo_pago || '', v: (a) => (e && editaPagos ? selc(a, 'metodo_pago', ls.metodo_pago || []) : a.metodo_pago || '') }] : []),
      ...(verPagos ? [{ t: 'Descuento', s: (a) => inscPor.get(a.id)?.descuento || '', v: (a) => { if (!(e && editaPagos)) return inscPor.get(a.id)?.descuento || ''; const c = sel(ls.descuento || [], inscPor.get(a.id)?.descuento, { vacio: '—', class: 'ac-celda' }); c.addEventListener('change', () => guardarInscripcion(a, { descuento: c.value || null })); return c; } }] : []),
      ...(verPagos ? [{ t: 'Cuota', num: true, v: (a) => (inscPor.get(a.id)?.cuota_mensual ? fmtEUR2(inscPor.get(a.id).cuota_mensual) : '') }] : []),
      { t: 'Inscripción', s: (a) => a.fecha_entrada || '', v: (a) => { if (!e) return a.fecha_entrada ? fmtFecha(a.fecha_entrada) : ''; const c = h('input', { type: 'date', value: a.fecha_entrada || '', class: 'ac-celda', 'aria-label': 'Fecha de inscripción' }); c.addEventListener('change', () => guardarCampo(a, 'fecha_entrada', c.value)); return c; } },
      { t: 'Estado', s: (a) => (ESTADOS.find((x) => x[0] === a.estado) || [0, a.estado])[1], v: (a) => (e ? selc(a, 'estado', ESTADOS, false) : pillEstado(a.estado)) },
      { t: '💬', s: (a) => (a.info ? 'con comentario' : ''), v: celdaComentario },
    ];
    clear(contenedor, tabla(cols, filas.slice(0, 3000), { onClick: e ? null : (a) => abrirFicha(a, ctx, recargar), clase: e ? 'ac-editando' : '', vacio: alumnos.length ? 'Ningún alumno coincide con el filtro.' : 'Todavía no hay alumnos. Usa «Importar del Excel» o «Nuevo alumno».' }));
  }
  const buscar = vincular(f, 'q', h('input', { type: 'search', placeholder: 'Buscar por alumno, colegio, responsable, teléfono o nº…', 'aria-label': 'Buscar', oninput: (ev) => { f.q = ev.target.value; pintar(); } }));
  const hayHermanos = alumnos.some((a) => esActivo(a) && fam.resumen(a.id, descPor).activos >= 2);
  const btnEditar = editaAl ? h('button', { class: 'btn small', type: 'button', 'aria-pressed': 'false', title: 'Cambiar los datos directamente en la tabla', onclick: (ev) => { f.editar = !f.editar; ev.currentTarget.setAttribute('aria-pressed', String(f.editar)); ev.currentTarget.classList.toggle('primary', f.editar); ev.currentTarget.textContent = f.editar ? '✓ Terminar edición' : '✎ Editar en tabla'; pintar(); } }, '✎ Editar en tabla') : null;
  clear(view,
    cabecera('Alumnos', null, btnEditar, editaAl ? h('button', { class: 'btn small', type: 'button', onclick: () => abrirEscaneo((pre) => abrirFicha(null, ctx, recargar, pre)) }, '📷 Desde foto') : null, editaAl ? h('a', { class: 'btn small', href: '#/ac_cambio_curso' }, 'Cambio de curso') : null, editaAl ? h('a', { class: 'btn small', href: '#/ac_importar' }, 'Importar del Excel') : null, editaAl ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrirFicha(null, ctx, recargar) }, '+ Nuevo alumno') : null),
    contador,
    h('div', { class: 'filters filters-6' },
      buscar,
      vincular(f, 'estado', sel([['', 'Todos los estados'], ...ESTADOS], f.estado, { onchange: (ev) => { f.estado = ev.target.value; pintar(); }, 'aria-label': 'Estado' })),
      vincular(f, 'modalidad', sel([['', 'Todas las modalidades'], ...(ls.modalidad || []).map((m) => [m, m])], f.modalidad, { onchange: (ev) => { f.modalidad = ev.target.value; pintar(); }, 'aria-label': 'Modalidad' })),
      vincular(f, 'grupo', sel([['', 'Todos los grupos'], ...todosGrupos.map((g) => [g, g])], f.grupo, { onchange: (ev) => { f.grupo = ev.target.value; pintar(); }, 'aria-label': 'Grupo' })),
      vincular(f, 'incompletos', sel([['', 'Todos los datos'], ['si', '⚠ Datos obligatorios incompletos']], f.incompletos, { onchange: (ev) => { f.incompletos = ev.target.value; pintar(); }, 'aria-label': 'Datos obligatorios' })),
      vincular(f, 'hermanos', sel([['', 'Todas las familias'], ['con', 'Con hermanos inscritos'], ...(verPagos ? [['sin', 'Hermanos sin descuento']] : [])], f.hermanos, { onchange: (ev) => { f.hermanos = ev.target.value; pintar(); }, 'aria-label': 'Hermanos' }))),
    avisoFiltros(f, { claves: ['q', 'estado', 'modalidad', 'grupo', 'hermanos', 'incompletos'], etiquetas: { incompletos: 'Datos', q: 'Búsqueda', estado: 'Estado', modalidad: 'Modalidad', grupo: 'Grupo', hermanos: 'Familias' },
      formato: { q: busqueda, estado: (v) => ESTADOS.find(([k]) => k === v)?.[1] || v, incompletos: () => 'incompletos', hermanos: (v) => (v === 'con' ? 'con hermanos inscritos' : v === 'sin' ? 'hermanos sin descuento' : v) }, alLimpiar: () => pintar() }),
    colegios, niveles, contenedor);
  pintar();
}

// ---------- ficha del alumno ----------
export async function abrirFicha(alumno, ctx, onCambio, prefill = null) {
  const curso = ctx.cursoActual();
  const nuevo = !alumno;
  const [ls, profes, grupos, insc, vinc, todos, tarifas] = await Promise.all([api.listas(), api.profesoras(), api.grupos(curso.id), api.inscripciones(curso.id), api.vinculos().catch(() => []), api.alumnos(), api.cuotasTarifa().catch(() => [])]);
  const a = alumno || { estado: 'inscrito', fecha_entrada: hoyISO(), autoriza_rrss: false, ...(prefill?.alumno || {}) };
  const miInsc = alumno ? insc.find((i) => i.alumno_id === alumno.id) : null;
  const r = a.responsable || prefill?.responsable || {};
  let priv = prefill && (prefill.dni || prefill.iban) ? { dni: prefill.dni, iban: prefill.iban } : null;
  const verPagos = ctx.ve('ac_pagos'); const editaPagos = ctx.edita('ac_pagos'); const editaAl = ctx.edita('ac_alumnos');
  if (alumno?.responsable_id && verPagos) priv = (await api.privados([alumno.responsable_id]))[0] || null;
  const fam = calcularFamilias(todos, vinc);
  const d = drawer({ titulo: nuevo ? 'Nuevo alumno' : nombreAlumno(a), ancho: 760 });
  const cambio = () => { api.invalidar(); onCambio?.(); };

  // --- datos ---
  const F = {
    num: txt(a.num ?? '', { inputmode: 'decimal', placeholder: 'ID del CRM de la franquicia' }),
    apellidos: txt(a.apellidos, { required: true }), nombre: txt(a.nombre, { required: true }), nacimiento: fecha(a.fecha_nacimiento),
    colegio: txt(a.colegio, { list: 'dl-colegio' }), estado: sel(ESTADOS, a.estado), entrada: fecha(a.fecha_entrada),
    modalidad: sel(ls.modalidad || [], a.modalidad, { vacio: '—' }), nivel: txt(a.nivel), metodo: sel(ls.metodo_pago || [], a.metodo_pago, { vacio: '—' }),
    conocio: txt(a.como_nos_conocio, { list: 'dl-conocio' }), intol: txt(a.intolerancias), info: area(a.info), cp: txt(a.codigo_postal),
    rrss: h('input', { type: 'checkbox', checked: !!a.autoriza_rrss }),
    rApe: txt(r.apellidos), rNom: txt(r.nombre), rMail: txt(r.email, { type: 'email' }), rTel: txt(r.telefono),
    rDni: txt(priv?.dni, { disabled: !editaPagos }), rIban: txt(priv?.iban, { disabled: !editaPagos }),
    cuota: numero(miInsc?.cuota_mensual ?? ''), wp: numero(miInsc?.welcome_pack ?? ''), desc: sel(ls.descuento || [], miInsc?.descuento, { vacio: 'Sin descuento' }),
  };
  // al elegir la modalidad se propone la cuota configurada (solo si la cuota está vacía)
  F.modalidad.addEventListener('change', () => {
    const t = tarifas.find((x) => x.activa && x.modalidad && x.modalidad === F.modalidad.value);
    if (t && !Number(F.cuota.value)) { F.cuota.value = t.cuota_mensual; if (!Number(F.wp.value)) F.wp.value = t.welcome_pack || ''; toast(`Cuota propuesta: ${t.nombre}`); }
  });
  const colegios = h('datalist', { id: 'dl-colegio' }, [...new Set((await api.alumnos()).map((x) => x.colegio).filter(Boolean))].sort().map((c) => h('option', { value: c })));
  const conocios = h('datalist', { id: 'dl-conocio' }, (ls.como_conocio || []).map((c) => h('option', { value: c })));

  const secDatos = h('div', { class: 'form-section' }, h('h3', {}, 'Alumno'),
    campo('ID alumno (CRM franquicia)', F.num), campo('Apellidos', F.apellidos, { req: true }), campo('Nombre', F.nombre, { req: true }),
    campo('Fecha de nacimiento', F.nacimiento), campo('Colegio', F.colegio),
    campo('Estado', F.estado), campo('Fecha de inscripción', F.entrada),
    campo('Modalidad', F.modalidad), campo('Nivel', F.nivel),
    campo('Cómo nos conoció', F.conocio), campo('Código postal', F.cp),
    campo('Alergias / intolerancias', F.intol, { full: true }), campo('Información / comentarios', F.info, { full: true }),
    h('label', { class: 'check full' }, F.rrss, ' Autoriza imágenes en redes sociales'), colegios, conocios);
  const secResp = h('div', { class: 'form-section' }, h('h3', {}, 'Responsable (padre / madre / tutor)'),
    campo('Apellidos', F.rApe), campo('Nombre', F.rNom), campo('Email', F.rMail), campo('Teléfono', F.rTel),
    verPagos ? campo('DNI', F.rDni) : null, verPagos ? campo('IBAN de cargo', F.rIban) : null,
    verPagos ? h('div', { class: 'small muted full' }, 'DNI e IBAN solo los ven los roles con permiso de Pagos.') : null);
  // la cuota y el método de pago son dinero: solo con permiso de Pagos
  const secInsc = verPagos ? h('div', { class: 'form-section' }, h('h3', {}, `Inscripción del curso ${curso.nombre}`),
    campo('Cuota mensual (€)', F.cuota), campo('Welcome pack (€)', F.wp), campo('Descuento', F.desc), campo('Método de pago', F.metodo)) : null;

  async function guardar() {
    if (!F.apellidos.value.trim() || !F.nombre.value.trim()) { toast('Faltan apellidos y nombre.', 'error'); return false; }
    try {
      let respId = a.responsable_id || null;
      const rd = { apellidos: F.rApe.value.trim(), nombre: F.rNom.value.trim(), email: F.rMail.value.trim() || null, telefono: F.rTel.value.trim() || null };
      // el IBAN y el DNI se guardan aunque falten los datos del responsable (se crea sin nombre; se completa cuando se sepa)
      if (rd.apellidos || rd.nombre || rd.telefono || rd.email || (editaPagos && (F.rDni.value.trim() || F.rIban.value.trim()))) {
        respId = respId ? (await api.upd('ac_responsables', respId, rd)).id : (await api.ins('ac_responsables', rd)).id;
        if (editaPagos && (F.rDni.value.trim() || F.rIban.value.trim() || priv)) {
          await api.guardarPrivados(respId, { dni: F.rDni.value.trim() || null, iban: F.rIban.value.replace(/\s+/g, '').toUpperCase() || null });
        }
      }
      const numTxt = F.num.value.trim().replace(',', '.');
      if (numTxt && !Number.isFinite(Number(numTxt))) { toast('El ID del alumno debe ser un número.', 'error'); return false; }
      const fila = {
        num: numTxt ? Number(numTxt) : null, apellidos: F.apellidos.value.trim(), nombre: F.nombre.value.trim(), fecha_nacimiento: F.nacimiento.value || null, colegio: F.colegio.value.trim() || null,
        estado: F.estado.value, fecha_entrada: F.entrada.value || null, modalidad: F.modalidad.value || null, nivel: F.nivel.value.trim() || null,
        metodo_pago: F.metodo.value || null, como_nos_conocio: F.conocio.value.trim() || null, intolerancias: F.intol.value.trim() || null,
        info: F.info.value.trim() || null, codigo_postal: F.cp.value.trim() || null, autoriza_rrss: F.rrss.checked, responsable_id: respId,
      };
      if (!alumno) {
        const dup = todos.find((x) => normalizar(`${x.apellidos} ${x.nombre}`) === normalizar(`${fila.apellidos} ${fila.nombre}`) && (x.fecha_nacimiento || '') === (fila.fecha_nacimiento || ''));
        if (dup && !(await confirmar({ titulo: 'Posible alumno repetido', texto: `Ya existe ${nombreAlumno(dup)} con la misma fecha de nacimiento. ¿Crear otro igualmente?`, ok: 'Crear igualmente' }))) return false;
      }
      const antesDomi = alumno ? esDomi(alumno.metodo_pago) && alumno.estado === 'inscrito' : false;
      const guardado = alumno ? await api.upd('ac_alumnos', alumno.id, fila) : await api.ins('ac_alumnos', fila);
      const cuota = Number(F.cuota.value || 0), wp = Number(F.wp.value || 0);
      if (editaPagos && (miInsc || cuota || wp)) {
        const base = { cuota_mensual: cuota, welcome_pack: wp, descuento: F.desc.value || null };
        if (miInsc) await api.upd('ac_inscripciones', miInsc.id, base); else await api.ins('ac_inscripciones', { alumno_id: guardado.id, curso_id: curso.id, ...base });
      }
      toast('Alumno guardado');
      cambio();
      if (esDomi(fila.metodo_pago) && fila.estado === 'inscrito' && !antesDomi) await ofrecerRemesas({ ...guardado, id: guardado.id }, ctx); // alta o paso a domiciliación: preguntar por las remesas
      return guardado;
    } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); return false; }
  }

  const bannerLectura = prefill ? h('div', { class: 'banner' }, h('strong', {}, 'Datos leídos de la foto: revísalos antes de crear el alumno. '), prefill.dudas?.length ? `Dudas: ${prefill.dudas.join('; ')}.` : 'La lectura no ha marcado dudas, pero comprueba nombres, fechas, teléfono y alergias.',
    !verPagos && (prefill.dni || prefill.iban) ? ' (DNI e IBAN no se muestran con tu rol y no se guardarán.)' : '') : null;
  d.cuerpo.append(...[bannerLectura, secDatos, secResp, secInsc].filter(Boolean));
  if (!nuevo) {
    const sec = (t, ...c) => h('div', { class: 'form-section ac-sec-completa' }, h('h3', {}, t), h('div', { class: 'full' }, ...c));
    const cont = { grupos: h('div'), cuotas: h('div'), notas: h('div'), tut: h('div'), baja: h('div'), fam: h('div') };
    d.cuerpo.append(...[sec('Familia (hermanos y familiares)', cont.fam), sec('Baja', cont.baja), sec('Grupos del curso', cont.grupos), verPagos ? sec('Cuotas del curso', cont.cuotas) : null, sec('Anotaciones de seguimiento', cont.notas), sec('Tutorías', cont.tut)].filter(Boolean));
    pintarFamilia(cont.fam); pintarBajas(cont.baja); pintarGrupos(cont.grupos); if (verPagos) pintarCuotas(cont.cuotas); pintarNotas(cont.notas); pintarTutorias(cont.tut);
  }

  function pintarFamilia(el) {
    const rel = fam.de(alumno.id);
    const descPor = verPagos ? new Map(insc.map((i) => [i.alumno_id, i.descuento])) : null;
    const r = fam.resumen(alumno.id, descPor);
    const refrescarFicha = async () => { api.invalidar(); onCambio?.(); d.cerrar(); abrirFicha((await api.alumnos()).find((x) => x.id === alumno.id), ctx, onCambio); };
    const aviso = r.activos >= 2 && r.aplicado === false
      ? h('div', { class: 'banner warn' }, h('strong', {}, 'Hay hermanos inscritos y ninguno tiene el descuento de hermanos. '),
        editaPagos ? h('button', { class: 'btn small', type: 'button', onclick: async () => {
          try {
            const i = miInsc; if (i) await api.upd('ac_inscripciones', i.id, { descuento: (ls.descuento || []).find(esDescHermanos) || 'Hermanos' });
            else await api.ins('ac_inscripciones', { alumno_id: alumno.id, curso_id: curso.id, descuento: (ls.descuento || []).find(esDescHermanos) || 'Hermanos' });
            toast('Descuento de hermanos aplicado a este alumno'); await refrescarFicha();
          } catch (ex) { toast(ex.message, 'error'); }
        } }, 'Aplicar «Hermanos» a este alumno') : null)
      : r.activos >= 2 && r.aplicado === true ? h('div', { class: 'small muted' }, 'El descuento de hermanos ya está aplicado en esta familia.') : null;
    const buscador = buscadorAlumno(todos.filter((x) => x.id !== alumno.id), { placeholder: 'Vincular a otro alumno (apellido o nombre)…' });
    const tipo = sel([['hermano', 'Hermano/a'], ['primo', 'Primo/a'], ['familiar', 'Otro familiar']], 'hermano');
    const vincular = guardarBoton('Vincular', async () => {
      const o = buscador.getAlumno(); if (!o) { toast('Elige un alumno de la lista.', 'error'); return; }
      try { await api.ins('ac_vinculos', { alumno_id: alumno.id, otro_id: o.id, tipo: tipo.value }); toast('Vinculado'); await refrescarFicha(); } catch (ex) { toast(ex.message, 'error'); }
    });
    clear(el, aviso, rel.length ? rel.map((x) => h('div', { class: 'ac-fila' }, h('strong', {}, nombreAlumno(x.alumno)), pillEstado(x.alumno.estado),
      verPagos ? (esDescHermanos(descPor.get(x.alumno.id)) ? pill('Dto. hermanos', 'ok') : null) : null, h('span', { class: 'muted small' }, x.motivos.join(' · ')),
      x.vid && editaAl ? h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { try { await api.del('ac_vinculos', x.vid); toast('Vínculo quitado'); await refrescarFicha(); } catch (ex) { toast(ex.message, 'error'); } } }, 'Quitar vínculo') : null))
      : h('div', { class: 'muted small' }, 'Sin hermanos ni familiares detectados (mismo responsable o mismos apellidos).'),
    editaAl ? h('div', { class: 'ac-fila' }, buscador, tipo, vincular) : null);
  }

  function pintarGrupos(el) {
    const mios = grupos.filter((g) => g.miembros.some((m) => m.alumno_id === alumno.id && !m.fecha_baja));
    const libres = grupos.filter((g) => !mios.includes(g)).sort((x, y) => x.nombre.localeCompare(y.nombre));
    const s = sel([['', 'Añadir a un grupo…'], ...libres.map((g) => [g.id, `${g.nombre}${resumenSesiones(g) ? ' · ' + resumenSesiones(g) : ''}`])], '');
    s.addEventListener('change', async () => {
      if (!s.value) return;
      const elegido = grupos.find((g) => g.id === s.value);
      if (elegido && !await confirmarAvisos(avisosAlumnoGrupo(alumno, elegido, grupos))) { s.value = ''; return; }
      try { await api.ins('ac_alumno_grupo', { alumno_id: alumno.id, grupo_id: s.value }); toast('Añadido al grupo'); cambio(); d.cerrar(); abrirFicha((await api.alumnos()).find((x) => x.id === alumno.id), ctx, onCambio); } catch (ex) { toast(ex.message, 'error'); }
    });
    clear(el, mios.length ? mios.map((g) => h('div', { class: 'ac-fila' }, h('strong', {}, g.nombre), h('span', { class: 'muted small' }, ` ${[g.nivel, resumenSesiones(g)].filter(Boolean).join(' · ')}`),
      editaAl ? h('button', { class: 'btn small ghost', type: 'button', onclick: async () => {
        const m = g.miembros.find((x) => x.alumno_id === alumno.id && !x.fecha_baja);
        try { await api.upd('ac_alumno_grupo', m.id, { fecha_baja: hoyISO() }); toast('Quitado del grupo'); cambio(); d.cerrar(); } catch (ex) { toast(ex.message, 'error'); }
      } }, 'Quitar') : null)) : h('div', { class: 'muted small' }, 'Sin grupo este curso.'), editaAl ? s : null);
  }

  async function pintarBajas(el) {
    const bs = (await api.bajas()).filter((b) => b.alumno_id === alumno.id).sort((x, y) => (y.fecha_baja || '').localeCompare(x.fecha_baja || ''));
    clear(el, bs.length ? bs.map((b) => h('div', { class: 'ac-nota ac-baja-ficha', style: `--c:${colorMotivoFicha(b.motivo)}` },
      h('div', { class: 'ac-fila' }, pillMotivo(b.motivo), h('strong', {}, `Baja el ${fmtFecha(b.fecha_baja)}`), h('span', { class: 'small muted' }, `Alta ${fmtFecha(b.fecha_alta)} · ${permanencia(b.fecha_alta, b.fecha_baja)}`)),
      b.comentarios ? h('div', { class: 'small' }, b.comentarios) : null)) : h('div', { class: 'muted small' }, 'Sin bajas registradas.'));
  }

  async function pintarCuotas(el) {
    const cs = (await api.cuotas(curso.id)).filter((c) => c.alumno_id === alumno.id);
    const ord = (c) => (c.concepto === 'welcome_pack' ? -1 : MESES.indexOf(c.mes));
    clear(el, cs.length ? tabla([
      { t: 'Concepto', v: (c) => (c.concepto === 'welcome_pack' ? 'Welcome pack' : c.concepto === 'otro' ? 'Otro' : capitalizar(c.mes)) },
      { t: 'Importe', num: true, v: (c) => fmtEUR2(c.importe) },
      { t: 'Estado', v: (c) => pill(c.estado, c.estado === 'pagado' ? 'ok' : c.estado === 'devuelto' ? 'warn' : 'off') },
      { t: 'Pagado el', v: (c) => (c.fecha_pago ? fmtFecha(c.fecha_pago) : '') },
    ], cs.sort((x, y) => ord(x) - ord(y))) : h('div', { class: 'muted small' }, 'Aún no hay cuotas generadas. Se crean desde la pestaña Pagos.'));
  }

  async function pintarNotas(el) {
    const lista = await api.anotaciones(alumno.id);
    const tipo = sel(['nota', 'llamada', 'familia', 'incidencia', 'pago', 'progreso', 'tutoría'], 'nota');
    const t = h('textarea', { rows: 2, placeholder: 'Escribe una anotación…', style: 'width:100%' });
    const add = guardarBoton('Añadir', async () => {
      if (!t.value.trim()) return;
      try { await api.ins('ac_anotaciones', { alumno_id: alumno.id, tipo: tipo.value, texto: t.value.trim() }); t.value = ''; await pintarNotas(el); } catch (ex) { toast(ex.message, 'error'); }
    });
    clear(el, editaAl ? h('div', { class: 'ac-nueva-nota' }, t, h('div', { class: 'ac-fila' }, tipo, add)) : null,
      lista.sort((x, y) => (y.fecha + y.created_at).localeCompare(x.fecha + x.created_at)).map((n) => h('div', { class: 'ac-nota' },
        h('div', { class: 'small muted' }, `${fmtFecha(n.fecha)} · `, pill(n.tipo), n.profesora ? ` · ${n.profesora.nombre}` : ''), h('div', {}, n.texto),
        editaAl ? h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Borrar anotación', texto: '¿Seguro?', ok: 'Borrar', peligro: true })) { await api.del('ac_anotaciones', n.id); await pintarNotas(el); } } }, 'Borrar') : null)),
      lista.length ? null : h('div', { class: 'muted small' }, 'Sin anotaciones.'));
  }

  async function pintarTutorias(el) {
    const ts = (await api.tutorias()).filter((t) => t.alumno?.id === alumno.id).sort((x, y) => y.fecha.localeCompare(x.fecha));
    clear(el, ts.length ? ts.map((t) => h('div', { class: 'ac-nota' }, h('div', { class: 'small muted' }, `${fmtFecha(t.fecha)} ${hhmm(t.hora)} · `, pill(t.estado, t.estado === 'hecha' ? 'ok' : t.estado === 'cancelada' ? 'off' : 'warn'), t.profesora ? ` · ${t.profesora.nombre}` : ''), h('div', {}, t.motivo || ''), t.acuerdos ? h('div', { class: 'small' }, 'Acuerdos: ', t.acuerdos) : null))
      : h('div', { class: 'muted small' }, 'Sin tutorías.'), h('a', { class: 'btn small', href: '#/ac_tutorias', onclick: () => d.cerrar() }, 'Ir a Tutorías'));
  }

  const btnGuardar = guardarBoton(nuevo ? 'Crear alumno' : 'Guardar cambios', async () => { const r2 = await guardar(); if (r2) d.cerrar(); });
  const btnBaja = !nuevo && a.estado !== 'baja' && ctx.edita('ac_bajas') ? h('a', { class: 'btn danger', href: '#/ac_bajas', onclick: () => { try { sessionStorage.setItem('ac.baja.alumno', alumno.id); } catch { /* */ } d.cerrar(); } }, 'Dar de baja…') : h('span');
  d.pie.append(btnBaja, h('div', { class: 'ac-fila' }, h('button', { class: 'btn', type: 'button', onclick: d.cerrar }, 'Cerrar'), editaAl ? btnGuardar : null));
}
