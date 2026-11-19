// ALUMNOS · Documentación de las familias (DNI, autorización de recogida, libro de familia…).
// Dos vistas: «Qué falta» (cada alumno con lo obligatorio, enlazado con los documentos de Recogidas) y «Archivo» (todo lo subido).
// Los archivos van a un bucket privado; con el portal, la propia familia los subirá (origen «familia») y el centro los revisa.
import { h, clear, cargando, toast, confirmar, hoyISO } from '../ui.js';
import * as api from './api.js';
import { campo, sel, txt, area, fecha, drawer, cabecera, tabla, guardarBoton, buscadorAlumno, nombreAlumno, refrescar, pill } from '../academia/kit.js';
import { TIPOS_DOC, NOM_DOC, OBLIGATORIOS, ESTADOS_DOC, esActivo, familiaPill, filtroAlumno, casillaFamilia } from './util.js';
import { leerV, guardarV } from '../vista.js';

export async function renderDocumentosFamilia(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const [alumnos, docs, recs] = await Promise.all([api.alumnos(), api.docsFamilia(), ctx.veAlgo('ac_recogidas') ? api.recogidas(curso.id).catch(() => []) : []]);
  const editor = ctx.edita('al_documentos');
  const porId = new Map(alumnos.map((a) => [a.id, a]));
  const recDe = new Map(recs.map((r) => [r.alumno_id, r]));
  let vistaSel = leerV('al.docs.vista', 'falta'); let soloFaltan = leerV('al.docs.faltan', true);
  const cont = h('div');
  const fa = filtroAlumno(alumnos, () => pintar());
  const hoy = hoyISO();

  // ¿tiene el alumno ese documento? (subido aquí, o ya registrado en Recogidas)
  function tiene(a, tipo) {
    const d = docs.find((x) => x.alumno_id === a.id && x.tipo === tipo && x.estado !== 'rechazado');
    if (d) return d.caduca && d.caduca < hoy ? 'caducado' : d.estado === 'pendiente' ? 'pendiente' : 'si';
    const r = recDe.get(a.id);
    if (tipo === 'autorizacion_recogida' && r?.doc_autorizacion) return 'si';
    if (tipo === 'dni_responsable' && r?.doc_dni_padres) return 'si';
    return 'no';
  }
  const SIMBOLO = { si: () => pill('✓', 'ok'), pendiente: () => pill('revisar', 'warn'), caducado: () => pill('caducado', 'warn'), no: () => pill('falta', 'off') }; // una pastilla nueva por celda (un nodo solo puede estar en un sitio)

  function pintar() {
    const idA = fa.get();
    if (vistaSel === 'falta') {
      let lista = alumnos.filter((a) => esActivo(a) && (!idA || a.id === idA));
      if (soloFaltan) lista = lista.filter((a) => OBLIGATORIOS.some((t) => tiene(a, t) !== 'si'));
      clear(cont, tabla([
        { t: 'Alumno', v: (a) => h('strong', {}, nombreAlumno(a)), s: (a) => nombreAlumno(a) },
        ...OBLIGATORIOS.map((t) => ({ t: NOM_DOC[t], v: (a) => SIMBOLO[tiene(a, t)](), s: (a) => ({ si: 'entregado', pendiente: 'revisar', caducado: 'caducado', no: 'falta' })[tiene(a, t)] })),
      ], lista, { onClick: editor ? (a) => abrir(null, a) : undefined, vacio: soloFaltan ? 'Todos los alumnos tienen la documentación obligatoria.' : 'No hay alumnos con este filtro.' }));
    } else {
      clear(cont, tabla([
        { t: 'Alumno', v: (d) => h('strong', {}, nombreAlumno(porId.get(d.alumno_id))), s: (d) => nombreAlumno(porId.get(d.alumno_id)) },
        { t: 'Documento', v: (d) => NOM_DOC[d.tipo] || d.tipo }, { t: 'Título', v: (d) => d.titulo || d.nombre_archivo || '' },
        { t: 'Subido', s: (d) => d.created_at, v: (d) => new Date(d.created_at).toLocaleDateString('es-ES') },
        { t: 'Origen', v: (d) => (d.origen === 'familia' ? 'Familia' : 'Centro') },
        { t: 'Caduca', s: (d) => d.caduca || '', v: (d) => (d.caduca ? h('span', {}, new Date(d.caduca).toLocaleDateString('es-ES'), d.caduca < hoy ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'caducado') : null) : '') },
        { t: 'Estado', v: (d) => pill(ESTADOS_DOC.find(([k]) => k === d.estado)?.[1] || d.estado, d.estado === 'revisado' ? 'ok' : d.estado === 'rechazado' ? 'off' : 'warn'), s: (d) => d.estado },
        { t: 'Archivo', sin: true, v: (d) => h('button', { class: 'btn small ghost', type: 'button', onclick: (ev) => { ev.stopPropagation(); api.abrir(api.BUCKET_DOCS, d.ruta).catch((ex) => toast(ex.message, 'error')); } }, 'Abrir') },
        { t: 'Familia', v: (d) => familiaPill(d.visible_familia), s: (d) => (d.visible_familia ? 'visible' : 'interno') },
      ], docs.filter((d) => !idA || d.alumno_id === idA), { onClick: editor ? (d) => abrir(d) : undefined, vacio: 'Todavía no hay documentos subidos.' }));
    }
  }

  function abrir(d, alumnoFijo) {
    const a0 = d ? porId.get(d.alumno_id) : alumnoFijo;
    const dr = drawer({ titulo: d ? `${NOM_DOC[d.tipo] || 'Documento'} · ${nombreAlumno(a0)}` : 'Subir documento', ancho: 520 });
    const F = { al: buscadorAlumno(alumnos, { valorId: a0?.id, soloActivos: !d }), tipo: sel(TIPOS_DOC, d?.tipo || OBLIGATORIOS.find((t) => a0 && tiene(a0, t) === 'no') || 'dni_responsable'), titulo: txt(d?.titulo, { placeholder: 'Opcional: «DNI de la madre»' }),
      arch: h('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.heic' }), caduca: fecha(d?.caduca), estado: sel(ESTADOS_DOC, d?.estado || 'revisado'), notas: area(d?.notas, { rows: 2 }), fam: casillaFamilia(d ? d.visible_familia : true, 'La familia ve que lo ha entregado') };
    dr.cuerpo.append(h('div', { class: 'form-section' }, campo('Alumno', F.al, { full: true, req: true }), campo('Tipo', F.tipo), campo('Estado', F.estado), campo('Título', F.titulo, { full: true }),
      campo(d ? 'Cambiar archivo' : 'Archivo (PDF o foto)', F.arch, { full: true, req: !d }), campo('Caduca (opcional)', F.caduca), campo('Notas', F.notas, { full: true }), h('div', { class: 'full' }, F.fam)),
      h('div', { class: 'small muted' }, 'Documento personal: se guarda en un almacén privado y solo lo abren quienes tienen este permiso.'));
    dr.pie.append(d ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (!await confirmar({ titulo: 'Quitar documento', texto: 'Se borrará el archivo y su registro. No se puede deshacer.', ok: 'Quitar', peligro: true })) return;
      try { await api.del('al_documentos_familia', d.id); await api.quitarArchivo(api.BUCKET_DOCS, d.ruta); toast('Documento quitado'); dr.cerrar(); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
    } }, 'Quitar') : null, guardarBoton('Guardar', async () => {
      const a = F.al.getAlumno() || a0;
      if (!a) { toast('Elige un alumno de la lista.', 'error'); return; }
      const f = F.arch.files[0];
      if (!d && !f) { toast('Elige el archivo.', 'error'); return; }
      try {
        const fila = { alumno_id: a.id, tipo: F.tipo.value, titulo: F.titulo.value.trim() || null, caduca: F.caduca.value || null, estado: F.estado.value, notas: F.notas.value.trim() || null, visible_familia: F.fam.input.checked };
        if (f) { fila.ruta = await api.subir(api.BUCKET_DOCS, a.id, f); fila.nombre_archivo = f.name; if (d?.ruta) await api.quitarArchivo(api.BUCKET_DOCS, d.ruta); }
        if (d) await api.upd('al_documentos_familia', d.id, fila); else await api.ins('al_documentos_familia', { ...fila, origen: 'centro' });
        toast('Documento guardado'); dr.cerrar(); refrescar();
      } catch (ex) { toast(ex.message, 'error'); }
    }));
  }

  const selVista = sel([['falta', 'Qué falta por alumno'], ['archivo', 'Archivo de documentos']], vistaSel, { onchange: (e) => { vistaSel = e.target.value; guardarV('al.docs.vista', vistaSel); pintar(); }, 'aria-label': 'Vista' });
  const chk = h('input', { type: 'checkbox', checked: soloFaltan, onchange: (e) => { soloFaltan = e.target.checked; guardarV('al.docs.faltan', soloFaltan); pintar(); } });
  clear(view, cabecera('Documentación de familias', 'DNI, autorizaciones y otros documentos que aportan las familias', editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrir(null, null) }, '+ Subir documento') : null),
    h('div', { class: 'filters filters-3' }, fa.el, selVista, h('label', { class: 'al-check' }, chk, ' Solo los que faltan algo')),
    recs.length ? h('div', { class: 'small muted' }, 'Los DNI y las autorizaciones ya subidos en Recogidas cuentan como entregados.') : null, cont);
  pintar();
}
