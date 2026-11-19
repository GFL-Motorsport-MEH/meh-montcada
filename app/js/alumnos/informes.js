// ALUMNOS · Informes y notas de las profesoras. Los informes pasan de «borrador» a «publicado» (solo lo publicado verá la familia);
// las notas de las profesoras son las anotaciones del Seguimiento, con una casilla para enseñarlas a la familia.
import { h, clear, cargando, toast, confirmar, hoyISO } from '../ui.js';
import * as api from './api.js';
import { campo, sel, txt, area, drawer, cabecera, tabla, guardarBoton, buscadorAlumno, nombreAlumno, refrescar, pill } from '../academia/kit.js';
import { PERIODOS, TIPOS_NOTA, filtroAlumno, familiaPill, casillaFamilia } from './util.js';

export async function renderInformes(view, ctx) {
  clear(view, cargando());
  const [alumnos, profes, informes, anots] = await Promise.all([api.alumnos(), api.profesoras(), api.informes(), api.anotaciones().catch(() => [])]);
  const editor = ctx.edita('al_informes');
  const editaNotas = ctx.edita('ac_seguimiento');
  const yo = ctx.miProfesora(profes);
  const porId = new Map(alumnos.map((a) => [a.id, a]));
  const curso = ctx.cursoActual();
  const contI = h('div'); const contN = h('div');
  const fa = filtroAlumno(alumnos, () => pintar());

  function pintar() {
    const idA = fa.get();
    clear(contI, tabla([
      { t: 'Alumno', v: (i) => h('strong', {}, nombreAlumno(porId.get(i.alumno_id))), s: (i) => nombreAlumno(porId.get(i.alumno_id)) },
      { t: 'Periodo', v: (i) => i.periodo }, { t: 'Informe', v: (i) => i.titulo },
      { t: 'Fecha', s: (i) => i.created_at, v: (i) => new Date(i.created_at).toLocaleDateString('es-ES') },
      { t: 'Profesora', v: (i) => i.profesora?.nombre || '' },
      { t: 'PDF', sin: true, v: (i) => (i.ruta ? h('button', { class: 'btn small ghost', type: 'button', onclick: (ev) => { ev.stopPropagation(); api.abrir(api.BUCKET_MATERIAL, i.ruta).catch((ex) => toast(ex.message, 'error')); } }, 'Abrir') : '') },
      { t: 'Estado', v: (i) => (i.estado === 'publicado' ? pill('publicado a la familia', 'ok') : pill('borrador', 'warn')), s: (i) => i.estado },
    ], informes.filter((i) => !idA || i.alumno_id === idA), { onClick: editor ? (i) => abrir(i) : undefined, vacio: 'No hay informes con este filtro.' }));
    const notas = anots.filter((n) => !idA || n.alumno_id === idA).sort((a, b) => (b.fecha + b.created_at).localeCompare(a.fecha + a.created_at)).slice(0, 300);
    clear(contN, tabla([
      { t: 'Fecha', s: (n) => n.fecha, v: (n) => (n.fecha ? new Date(n.fecha).toLocaleDateString('es-ES') : '') },
      { t: 'Alumno', v: (n) => h('strong', {}, nombreAlumno(n.alumno || porId.get(n.alumno_id))), s: (n) => nombreAlumno(n.alumno || porId.get(n.alumno_id)) },
      { t: 'Tipo', v: (n) => n.tipo }, { t: 'Profesora', v: (n) => n.profesora?.nombre || '' },
      { t: 'Nota', v: (n) => (n.texto || '').length > 140 ? n.texto.slice(0, 140) + '…' : n.texto || '', s: (n) => n.texto || '' },
      { t: 'Familia', v: (n) => (editaNotas
        ? h('label', { class: 'al-check', onclick: (ev) => ev.stopPropagation() }, h('input', { type: 'checkbox', checked: !!n.visible_familia, onchange: async (ev) => {
          try { await api.updAc('ac_anotaciones', n.id, { visible_familia: ev.target.checked }); n.visible_familia = ev.target.checked; toast(ev.target.checked ? 'La familia verá esta nota' : 'Nota solo interna'); } catch (ex) { ev.target.checked = !ev.target.checked; toast(ex.message, 'error'); }
        } }), ' visible')
        : familiaPill(n.visible_familia)), s: (n) => (n.visible_familia ? 'visible' : 'interno') },
    ], notas, { vacio: 'No hay notas de profesoras con este filtro.' }));
  }

  function abrir(i) {
    const d = drawer({ titulo: i ? `Informe · ${nombreAlumno(porId.get(i.alumno_id))}` : 'Nuevo informe', ancho: 620 });
    const F = { al: buscadorAlumno(alumnos, { valorId: i?.alumno_id, soloActivos: !i }), per: sel(PERIODOS, i?.periodo || '1T'), titulo: txt(i?.titulo, { placeholder: 'Informe del primer trimestre' }), cont: area(i?.contenido, { rows: 9 }),
      arch: h('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg' }), estado: sel([['borrador', 'Borrador (solo el centro)'], ['publicado', 'Publicado (lo verá la familia)']], i?.estado || 'borrador'),
      prof: sel(profes.filter((p) => p.activa || p.id === i?.profesora_id).map((p) => [p.id, p.nombre]), i?.profesora_id || yo?.id, { vacio: '—' }) };
    d.cuerpo.append(h('div', { class: 'form-section' }, campo('Alumno', F.al, { full: true, req: true }), campo('Periodo', F.per), campo('Profesora', F.prof), campo('Título', F.titulo, { full: true, req: true }), campo('Contenido', F.cont, { full: true }),
      campo(i?.ruta ? 'Cambiar PDF' : 'PDF del informe (opcional)', F.arch, { full: true }), campo('Estado', F.estado, { full: true })));
    d.pie.append(i ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (!await confirmar({ titulo: 'Quitar informe', texto: `Se quitará «${i.titulo}».`, ok: 'Quitar', peligro: true })) return;
      try { await api.del('al_informes', i.id); await api.quitarArchivo(api.BUCKET_MATERIAL, i.ruta); toast('Informe quitado'); d.cerrar(); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
    } }, 'Quitar') : null, guardarBoton('Guardar', async () => {
      const a = F.al.getAlumno() || (i ? porId.get(i.alumno_id) : null);
      if (!a) { toast('Elige un alumno de la lista.', 'error'); return; }
      if (!F.titulo.value.trim()) { toast('Pon un título.', 'error'); return; }
      try {
        const fila = { alumno_id: a.id, curso_id: curso?.id || null, periodo: F.per.value, titulo: F.titulo.value.trim(), contenido: F.cont.value.trim() || null, estado: F.estado.value, profesora_id: F.prof.value || null };
        if (fila.estado === 'publicado' && i?.estado !== 'publicado') fila.publicado_at = new Date().toISOString();
        if (fila.estado === 'borrador') fila.publicado_at = null;
        const f = F.arch.files[0];
        if (f) { fila.ruta = await api.subir(api.BUCKET_MATERIAL, a.id, f); fila.nombre_archivo = f.name; if (i?.ruta) await api.quitarArchivo(api.BUCKET_MATERIAL, i.ruta); }
        if (i) await api.upd('al_informes', i.id, fila); else await api.ins('al_informes', fila);
        toast('Informe guardado'); d.cerrar(); refrescar();
      } catch (ex) { toast(ex.message, 'error'); }
    }));
  }

  function nuevaNota() {
    const d = drawer({ titulo: 'Nueva nota de profesora', ancho: 520 });
    const F = { al: buscadorAlumno(alumnos, { soloActivos: true }), tipo: sel(TIPOS_NOTA, 'nota'), texto: area('', { rows: 5 }), fam: casillaFamilia(false) };
    d.cuerpo.append(h('div', { class: 'form-section' }, campo('Alumno', F.al, { full: true, req: true }), campo('Tipo', F.tipo), campo('Nota', F.texto, { full: true }), h('div', { class: 'full' }, F.fam)));
    d.pie.append(guardarBoton('Guardar', async () => {
      const a = F.al.getAlumno();
      if (!a) { toast('Elige un alumno de la lista.', 'error'); return; }
      if (!F.texto.value.trim()) { toast('Escribe la nota.', 'error'); return; }
      try { await api.insAc('ac_anotaciones', { alumno_id: a.id, tipo: F.tipo.value, texto: F.texto.value.trim(), fecha: hoyISO(), profesora_id: yo?.id || null, visible_familia: F.fam.input.checked }); toast('Nota guardada'); d.cerrar(); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
    }));
  }

  clear(view, cabecera('Informes y notas de profesoras', 'Informes por periodo y observaciones del seguimiento', editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrir(null) }, '+ Nuevo informe') : null),
    h('div', { class: 'filters' }, fa.el),
    h('div', { class: 'card' }, h('h3', { class: 'sub-titulo' }, 'Informes'), contI),
    h('div', { class: 'card' }, h('div', { class: 'section-head' }, h('h3', { class: 'sub-titulo' }, 'Notas de las profesoras (Seguimiento)'), editaNotas ? h('button', { class: 'btn small', type: 'button', onclick: nuevaNota }, '+ Nueva nota') : null),
      h('div', { class: 'small muted' }, 'Son las anotaciones del Seguimiento. Marca «visible» solo las que quieras que lea la familia.'), contN));
  pintar();
}
