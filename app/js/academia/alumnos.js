// Alumnos: listado con filtros y ficha (datos, inscripción del curso, grupos, cuotas, anotaciones y tutorías).
import { h, clear, cargando, toast, confirmar, fmtFecha, fmtEUR2, hoyISO, normalizar, MESES, capitalizar } from '../ui.js';
import * as api from './api.js';
import { campo, txt, area, fecha, numero, sel, drawer, cabecera, tabla, pill, edad, nombreAlumno, hhmm, DIAS_CORTO, guardarBoton, buscadorAlumno, refrescar } from './kit.js';

import { pillMotivo, permanencia, colorMotivo as colorMotivoFicha } from './bajas.js';

const ESTADOS = [['inscrito', 'Inscrito'], ['prematricula', 'Pre-matrícula'], ['baja', 'Baja'], ['antiguo', 'Antiguo']];
const pillEstado = (e) => pill((ESTADOS.find((x) => x[0] === e) || [0, e])[1], e === 'inscrito' ? 'ok' : e === 'prematricula' ? 'warn' : 'off');
export const resumenSesiones = (g) => (g?.sesiones || []).slice().sort((a, b) => a.dia - b.dia).map((s) => `${DIAS_CORTO[s.dia]} ${hhmm(s.hora_inicio)}`).join(' · ');

export async function renderAlumnos(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const [alumnos, gruposAl, insc, ls] = await Promise.all([api.alumnos(), api.gruposDeAlumnos(curso.id), api.inscripciones(curso.id), api.listas()]);
  const inscPor = new Map(insc.map((i) => [i.alumno_id, i]));
  const f = { q: '', estado: 'inscrito', modalidad: '', grupo: '' };
  const todosGrupos = [...new Set([...gruposAl.values()].flat().map((g) => g.nombre))].sort();

  const contenedor = h('div', { class: 'ac-lista' });
  const contador = h('div', { class: 'count' });
  function pintar() {
    const q = normalizar(f.q);
    const filas = alumnos.filter((a) => {
      if (f.estado && a.estado !== f.estado) return false;
      if (f.modalidad && a.modalidad !== f.modalidad) return false;
      if (f.grupo && !(gruposAl.get(a.id) || []).some((g) => g.nombre === f.grupo)) return false;
      if (q && !normalizar(`${a.apellidos} ${a.nombre} ${a.num || ''} ${a.responsable?.apellidos || ''} ${a.responsable?.nombre || ''} ${a.responsable?.telefono || ''}`).includes(q)) return false;
      return true;
    });
    contador.textContent = `${filas.length} de ${alumnos.length} alumnos`;
    clear(contenedor, tabla([
      { t: 'Nº', v: (a) => a.num ?? '' },
      { t: 'Alumno', v: (a) => h('strong', {}, nombreAlumno(a)) },
      { t: 'Edad', v: (a) => edad(a.fecha_nacimiento) },
      { t: 'Responsable', v: (a) => (a.responsable ? `${a.responsable.nombre} ${a.responsable.apellidos}`.trim() : '') },
      { t: 'Teléfono', v: (a) => a.responsable?.telefono || '' },
      { t: 'Modalidad · nivel', v: (a) => [a.modalidad, a.nivel].filter(Boolean).join(' · ') },
      { t: 'Grupos', v: (a) => (gruposAl.get(a.id) || []).map((g) => g.nombre).join(', ') },
      ...(ctx.ve('ac_pagos') ? [{ t: 'Cuota', num: true, v: (a) => (inscPor.get(a.id)?.cuota_mensual ? fmtEUR2(inscPor.get(a.id).cuota_mensual) : '') }] : []),
      { t: 'Estado', v: (a) => pillEstado(a.estado) },
    ], filas.slice(0, 3000), { onClick: (a) => abrirFicha(a, ctx, recargar), vacio: alumnos.length ? 'Ningún alumno coincide con el filtro.' : 'Todavía no hay alumnos. Usa «Importar del Excel» o «Nuevo alumno».' }));
    if (filas.length > 400) contenedor.append(h('div', { class: 'small muted', style: 'padding:6px' }, `Mostrando 400 de ${filas.length}: afina el filtro.`));
  }
  const recargar = () => { api.invalidar(); refrescar(); };
  const buscar = h('input', { type: 'search', placeholder: 'Buscar por alumno, responsable, teléfono o nº…', 'aria-label': 'Buscar', oninput: (e) => { f.q = e.target.value; pintar(); } });
  clear(view,
    cabecera('Alumnos', null, ctx.edita('ac_alumnos') ? h('a', { class: 'btn small', href: '#/ac_importar' }, 'Importar del Excel') : null, ctx.edita('ac_alumnos') ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrirFicha(null, ctx, recargar) }, '+ Nuevo alumno') : null),
    contador,
    h('div', { class: 'filters filters-4' },
      buscar,
      sel([['', 'Todos los estados'], ...ESTADOS], f.estado, { onchange: (e) => { f.estado = e.target.value; pintar(); }, 'aria-label': 'Estado' }),
      sel([['', 'Todas las modalidades'], ...(ls.modalidad || []).map((m) => [m, m])], '', { onchange: (e) => { f.modalidad = e.target.value; pintar(); }, 'aria-label': 'Modalidad' }),
      sel([['', 'Todos los grupos'], ...todosGrupos.map((g) => [g, g])], '', { onchange: (e) => { f.grupo = e.target.value; pintar(); }, 'aria-label': 'Grupo' })),
    contenedor);
  pintar();
}

// ---------- ficha del alumno ----------
export async function abrirFicha(alumno, ctx, onCambio) {
  const curso = ctx.cursoActual();
  const nuevo = !alumno;
  const [ls, profes, grupos, insc] = await Promise.all([api.listas(), api.profesoras(), api.grupos(curso.id), api.inscripciones(curso.id)]);
  const a = alumno || { estado: 'inscrito', fecha_entrada: hoyISO(), autoriza_rrss: false };
  const miInsc = alumno ? insc.find((i) => i.alumno_id === alumno.id) : null;
  const r = a.responsable || {};
  let priv = null;
  const verPagos = ctx.ve('ac_pagos'); const editaPagos = ctx.edita('ac_pagos'); const editaAl = ctx.edita('ac_alumnos');
  if (alumno?.responsable_id && verPagos) priv = (await api.privados([alumno.responsable_id]))[0] || null;
  const d = drawer({ titulo: nuevo ? 'Nuevo alumno' : nombreAlumno(a), ancho: 760 });
  const cambio = () => { api.invalidar(); onCambio?.(); };

  // --- datos ---
  const F = {
    apellidos: txt(a.apellidos, { required: true }), nombre: txt(a.nombre, { required: true }), nacimiento: fecha(a.fecha_nacimiento),
    colegio: txt(a.colegio, { list: 'dl-colegio' }), estado: sel(ESTADOS, a.estado), entrada: fecha(a.fecha_entrada),
    modalidad: sel(ls.modalidad || [], a.modalidad, { vacio: '—' }), nivel: txt(a.nivel), metodo: sel(ls.metodo_pago || [], a.metodo_pago, { vacio: '—' }),
    conocio: txt(a.como_nos_conocio, { list: 'dl-conocio' }), intol: txt(a.intolerancias), info: area(a.info), cp: txt(a.codigo_postal),
    rrss: h('input', { type: 'checkbox', checked: !!a.autoriza_rrss }),
    rApe: txt(r.apellidos), rNom: txt(r.nombre), rMail: txt(r.email, { type: 'email' }), rTel: txt(r.telefono),
    rDni: txt(priv?.dni, { disabled: !editaPagos }), rIban: txt(priv?.iban, { disabled: !editaPagos }),
    cuota: numero(miInsc?.cuota_mensual ?? ''), wp: numero(miInsc?.welcome_pack ?? ''), desc: sel(ls.descuento || [], miInsc?.descuento, { vacio: 'Sin descuento' }),
  };
  const colegios = h('datalist', { id: 'dl-colegio' }, [...new Set((await api.alumnos()).map((x) => x.colegio).filter(Boolean))].sort().map((c) => h('option', { value: c })));
  const conocios = h('datalist', { id: 'dl-conocio' }, (ls.como_conocio || []).map((c) => h('option', { value: c })));

  const secDatos = h('div', { class: 'form-section' }, h('h3', {}, 'Alumno'),
    campo('Apellidos', F.apellidos, { req: true }), campo('Nombre', F.nombre, { req: true }),
    campo('Fecha de nacimiento', F.nacimiento), campo('Colegio', F.colegio),
    campo('Estado', F.estado), campo('Fecha de entrada', F.entrada),
    campo('Modalidad', F.modalidad), campo('Nivel', F.nivel),
    campo('Cómo nos conoció', F.conocio), campo('Código postal', F.cp),
    campo('Intolerancias / alergias', F.intol, { full: true }), campo('Información', F.info, { full: true }),
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
      if (rd.apellidos || rd.nombre || rd.telefono || rd.email) {
        respId = respId ? (await api.upd('ac_responsables', respId, rd)).id : (await api.ins('ac_responsables', rd)).id;
        if (editaPagos && (F.rDni.value.trim() || F.rIban.value.trim() || priv)) {
          await api.guardarPrivados(respId, { dni: F.rDni.value.trim() || null, iban: F.rIban.value.replace(/\s+/g, '').toUpperCase() || null });
        }
      }
      const fila = {
        apellidos: F.apellidos.value.trim(), nombre: F.nombre.value.trim(), fecha_nacimiento: F.nacimiento.value || null, colegio: F.colegio.value.trim() || null,
        estado: F.estado.value, fecha_entrada: F.entrada.value || null, modalidad: F.modalidad.value || null, nivel: F.nivel.value.trim() || null,
        metodo_pago: F.metodo.value || null, como_nos_conocio: F.conocio.value.trim() || null, intolerancias: F.intol.value.trim() || null,
        info: F.info.value.trim() || null, codigo_postal: F.cp.value.trim() || null, autoriza_rrss: F.rrss.checked, responsable_id: respId,
      };
      const guardado = alumno ? await api.upd('ac_alumnos', alumno.id, fila) : await api.ins('ac_alumnos', fila);
      const cuota = Number(F.cuota.value || 0), wp = Number(F.wp.value || 0);
      if (editaPagos && (miInsc || cuota || wp)) {
        const base = { cuota_mensual: cuota, welcome_pack: wp, descuento: F.desc.value || null };
        if (miInsc) await api.upd('ac_inscripciones', miInsc.id, base); else await api.ins('ac_inscripciones', { alumno_id: guardado.id, curso_id: curso.id, ...base });
      }
      toast('Alumno guardado');
      cambio();
      return guardado;
    } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); return false; }
  }

  d.cuerpo.append(...[secDatos, secResp, secInsc].filter(Boolean));
  if (!nuevo) {
    const sec = (t, ...c) => h('div', { class: 'form-section ac-sec-completa' }, h('h3', {}, t), h('div', { class: 'full' }, ...c));
    const cont = { grupos: h('div'), cuotas: h('div'), notas: h('div'), tut: h('div'), baja: h('div') };
    d.cuerpo.append(...[sec('Baja', cont.baja), sec('Grupos del curso', cont.grupos), verPagos ? sec('Cuotas del curso', cont.cuotas) : null, sec('Anotaciones de seguimiento', cont.notas), sec('Tutorías', cont.tut)].filter(Boolean));
    pintarBajas(cont.baja); pintarGrupos(cont.grupos); if (verPagos) pintarCuotas(cont.cuotas); pintarNotas(cont.notas); pintarTutorias(cont.tut);
  }

  function pintarGrupos(el) {
    const mios = grupos.filter((g) => g.miembros.some((m) => m.alumno_id === alumno.id && !m.fecha_baja));
    const libres = grupos.filter((g) => !mios.includes(g)).sort((x, y) => x.nombre.localeCompare(y.nombre));
    const s = sel([['', 'Añadir a un grupo…'], ...libres.map((g) => [g.id, `${g.nombre}${resumenSesiones(g) ? ' · ' + resumenSesiones(g) : ''}`])], '');
    s.addEventListener('change', async () => {
      if (!s.value) return;
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
