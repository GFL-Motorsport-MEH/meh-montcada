// ALUMNOS · Notas: evaluaciones por periodo y área. La profesora apunta las de sus alumnos (una a una o las de todo un grupo a la vez);
// cada nota lleva una casilla «visible para la familia» (lo que verá el futuro portal).
import { h, clear, cargando, toast, confirmar, hoyISO } from '../ui.js';
import * as api from './api.js';
import { campo, sel, fecha, numero, area, drawer, cabecera, tabla, guardarBoton, buscadorAlumno, nombreAlumno, refrescar, pill, hhmm } from '../academia/kit.js';
import { PERIODOS, AREAS, esActivo, familiaPill, nota, media, filtroAlumno, casillaFamilia } from './util.js';

export async function renderNotas(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const [alumnos, profes, evals] = await Promise.all([api.alumnos(), api.profesoras(), api.evaluaciones()]);
  const editor = ctx.edita('al_notas');
  const yo = ctx.miProfesora(profes);
  const porId = new Map(alumnos.map((a) => [a.id, a]));
  let periodo = '';
  const cont = h('div'); const resumen = h('div');
  const fa = filtroAlumno(alumnos, () => pintar());
  const selPer = sel([['', 'Todos los periodos'], ...PERIODOS], '', { onchange: (e) => { periodo = e.target.value; pintar(); }, 'aria-label': 'Periodo' });

  function pintar() {
    const idA = fa.get();
    const filas = evals.filter((e) => (!idA || e.alumno_id === idA) && (!periodo || e.periodo === periodo));
    // con un alumno elegido: media por periodo
    clear(resumen);
    if (idA) {
      const pers = [...new Set(evals.filter((e) => e.alumno_id === idA).map((e) => e.periodo))];
      if (pers.length) resumen.append(h('div', { class: 'al-chips' }, pers.map((p) => { const m = media(evals.filter((e) => e.alumno_id === idA && e.periodo === p)); return h('span', { class: 'pill' }, `${p}: `, h('strong', {}, m === null ? '—' : nota(Math.round(m * 100) / 100))); })));
    }
    clear(cont, tabla([
      { t: 'Alumno', v: (e) => h('strong', {}, nombreAlumno(porId.get(e.alumno_id))), s: (e) => nombreAlumno(porId.get(e.alumno_id)) },
      { t: 'Periodo', v: (e) => e.periodo }, { t: 'Área', v: (e) => e.area },
      { t: 'Nota', num: true, s: (e) => (e.nota === null ? '' : Number(e.nota)), v: (e) => (e.nota === null ? '' : h('strong', { class: Number(e.nota) < 5 ? 'al-baja' : '' }, nota(e.nota))) },
      { t: 'Valoración', v: (e) => e.valoracion || '' },
      { t: 'Fecha', s: (e) => e.fecha, v: (e) => (e.fecha ? new Date(e.fecha).toLocaleDateString('es-ES') : '') },
      { t: 'Profesora', v: (e) => e.profesora?.nombre || '' },
      { t: 'Familia', v: (e) => familiaPill(e.visible_familia), s: (e) => (e.visible_familia ? 'visible' : 'interno') },
    ], filas, { onClick: editor ? (e) => abrir(e) : undefined, vacio: 'No hay notas con este filtro.' }));
  }

  function abrir(e) {
    const d = drawer({ titulo: e ? 'Nota' : 'Nueva nota', ancho: 520 });
    const F = { al: buscadorAlumno(alumnos, { valorId: e?.alumno_id, soloActivos: !e }), per: sel(PERIODOS, e?.periodo || '1T'), area: sel(AREAS, e?.area || 'Global'),
      nota: numero(e?.nota ?? '', { min: 0, max: 10, step: '0.1', placeholder: '0–10' }), val: area(e?.valoracion, { placeholder: 'Comentario para la familia o para el seguimiento' }), fecha: fecha(e?.fecha || hoyISO()),
      prof: sel(profes.filter((p) => p.activa || p.id === e?.profesora_id).map((p) => [p.id, p.nombre]), e?.profesora_id || yo?.id, { vacio: '—' }), fam: casillaFamilia(e?.visible_familia) };
    d.cuerpo.append(h('div', { class: 'form-section' }, campo('Alumno', F.al, { full: true, req: true }), campo('Periodo', F.per), campo('Área', F.area), campo('Nota (0–10)', F.nota), campo('Fecha', F.fecha), campo('Profesora', F.prof),
      campo('Valoración', F.val, { full: true }), h('div', { class: 'full' }, F.fam)));
    d.pie.append(e ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (!await confirmar({ titulo: 'Quitar nota', texto: 'Se quitará esta nota del alumno.', ok: 'Quitar', peligro: true })) return;
      try { await api.del('al_evaluaciones', e.id); toast('Nota quitada'); d.cerrar(); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
    } }, 'Quitar') : null, guardarBoton('Guardar', async () => {
      const a = F.al.getAlumno() || (e ? porId.get(e.alumno_id) : null);
      if (!a) { toast('Elige un alumno de la lista.', 'error'); return; }
      const n = String(F.nota.value).trim() === '' ? null : Number(String(F.nota.value).replace(',', '.'));
      if (n !== null && (!Number.isFinite(n) || n < 0 || n > 10)) { toast('La nota debe estar entre 0 y 10.', 'error'); return; }
      if (n === null && !F.val.value.trim()) { toast('Pon una nota o una valoración.', 'error'); return; }
      const fila = { alumno_id: a.id, curso_id: curso?.id || null, periodo: F.per.value, area: F.area.value, nota: n, valoracion: F.val.value.trim() || null, fecha: F.fecha.value || hoyISO(), profesora_id: F.prof.value || null, visible_familia: F.fam.input.checked };
      try { if (e) await api.upd('al_evaluaciones', e.id, fila); else await api.ins('al_evaluaciones', fila); toast('Nota guardada'); d.cerrar(); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
    }));
  }

  // las notas de todo un grupo de una vez (una fila por alumno)
  async function abrirGrupo() {
    const gs = (await api.grupos(curso.id)).filter((g) => g.activo !== false).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
    const d = drawer({ titulo: 'Notas de un grupo', ancho: 640 });
    const F = { grupo: sel(gs.map((g) => [g.id, g.nombre]), '', { vacio: 'Elige grupo…' }), per: sel(PERIODOS, '1T'), area: sel(AREAS, 'Global'), fecha: fecha(hoyISO()), fam: casillaFamilia(false) };
    const lista = h('div', { class: 'al-bulk' });
    let filas = [];
    F.grupo.addEventListener('change', () => {
      const g = gs.find((x) => x.id === F.grupo.value);
      const ms = (g?.miembros || []).filter((m) => !m.fecha_baja).map((m) => porId.get(m.alumno_id)).filter(Boolean).sort((a, b) => nombreAlumno(a).localeCompare(nombreAlumno(b), 'es'));
      filas = ms.map((a) => ({ a, n: numero('', { min: 0, max: 10, step: '0.1', 'aria-label': 'Nota de ' + nombreAlumno(a) }), v: h('input', { type: 'text', placeholder: 'Valoración (opcional)', 'aria-label': 'Valoración de ' + nombreAlumno(a) }) }));
      clear(lista, filas.length ? h('table', { class: 'tbl' }, h('tbody', {}, filas.map((f) => h('tr', {}, h('td', {}, nombreAlumno(f.a)), h('td', { style: 'width:90px' }, f.n), h('td', {}, f.v))))) : h('div', { class: 'muted' }, 'Este grupo no tiene alumnos.'));
    });
    d.cuerpo.append(h('div', { class: 'form-section' }, campo('Grupo', F.grupo, { full: true }), campo('Periodo', F.per), campo('Área', F.area), campo('Fecha', F.fecha), h('div', { class: 'full' }, F.fam)), lista);
    d.pie.append(guardarBoton('Guardar notas', async () => {
      const rows = filas.map((f) => ({ f, n: String(f.n.value).trim() === '' ? null : Number(String(f.n.value).replace(',', '.')), v: f.v.value.trim() })).filter((r) => r.n !== null || r.v);
      if (!rows.length) { toast('Escribe al menos una nota o valoración.', 'error'); return; }
      if (rows.some((r) => r.n !== null && (!Number.isFinite(r.n) || r.n < 0 || r.n > 10))) { toast('Todas las notas deben estar entre 0 y 10.', 'error'); return; }
      const g = gs.find((x) => x.id === F.grupo.value);
      try {
        await api.insMany('al_evaluaciones', rows.map((r) => ({ alumno_id: r.f.a.id, curso_id: curso.id, periodo: F.per.value, area: F.area.value, nota: r.n, valoracion: r.v || null, fecha: F.fecha.value || hoyISO(), profesora_id: g?.profesora_id || yo?.id || null, visible_familia: F.fam.input.checked })));
        toast(`${rows.length} notas guardadas`); d.cerrar(); refrescar();
      } catch (ex) { toast(ex.message, 'error'); }
    }));
  }

  clear(view, cabecera('Notas', ctx.ve('al_notas') ? 'Evaluaciones de todos los alumnos' : 'Evaluaciones de tus alumnos',
    editor ? h('button', { class: 'btn small', type: 'button', onclick: abrirGrupo }, 'Notas de un grupo') : null,
    editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrir(null) }, '+ Nueva nota') : null),
    h('div', { class: 'filters filters-2' }, fa.el, selPer), resumen, cont);
  pintar();
}
