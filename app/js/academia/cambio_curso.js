// CAMBIO DE CURSO: pasa a los alumnos de un curso al siguiente. Para cada alumno inscrito se ve su edad (hoy y al empezar el curso nuevo),
// su nivel actual y el nivel propuesto (el siguiente: L1 → L2…). Se puede cambiar cada uno a mano. Aviso (⚠) si el nivel nuevo es uno
// que el alumno ya cursó antes (según los grupos de cursos anteriores y el historial de cambios) o si el alumno no tiene nivel.
// «Aplicar» guarda el nivel nuevo en la ficha y deja constancia en el historial de niveles; no toca grupos, cuotas ni pagos.
import { h, clear, cargando, toast, confirmar, hoyISO } from '../ui.js';
import * as api from './api.js';
import { sel, cabecera, tabla, pill, pillNivel, nivelNum, nombreAlumno, edad } from './kit.js';

// edad en una fecha concreta
export function edadEn(nac, fecha) {
  if (!nac) return null;
  const n = new Date(nac); const f = new Date(fecha);
  let e = f.getFullYear() - n.getFullYear();
  if (f.getMonth() < n.getMonth() || (f.getMonth() === n.getMonth() && f.getDate() < n.getDate())) e--;
  return e;
}
// escribe el nivel nuevo con el mismo estilo que tenía («Level 3», «L3», «3»)
export function formatoNivel(actual, n) {
  const a = String(actual || '');
  if (/^l\d/i.test(a) && !/^level/i.test(a)) return `L${n}`;
  if (/^\d$/.test(a.trim())) return String(n);
  return `Level ${n}`;
}
// niveles que el alumno ya tuvo antes de empezar el curso nuevo: { nivel -> texto de dónde } (grupos de cursos anteriores + historial)
export function nivelesPasados({ alumnoId, nuevo, cursos, grupos, historial }) {
  const out = new Map();
  const cPor = new Map(cursos.map((c) => [c.id, c]));
  for (const g of grupos) {
    const k = nivelNum(g.nivel); const c = cPor.get(g.curso_id);
    if (!k || !c || c.fecha_inicio >= nuevo.fecha_inicio) continue;
    if (g.miembros?.some((m) => m.alumno_id === alumnoId)) if (!out.has(k)) out.set(k, c.nombre);
  }
  for (const r of historial) {
    if (r.alumno_id !== alumnoId) continue;
    const c = cPor.get(r.curso_id);
    if (c && c.fecha_inicio >= nuevo.fecha_inicio) continue;
    for (const v of [r.nivel_anterior, r.nivel_nuevo]) { const k = nivelNum(v); if (k && !out.has(k)) out.set(k, c ? `antes de ${c.nombre}` : 'historial'); }
  }
  return out;
}
// propuesta y aviso de un alumno
export function proponer(a, pasados, nuevoNivel) {
  const actual = nivelNum(a.nivel);
  const prop = nuevoNivel !== undefined ? nuevoNivel : actual ? Math.min(5, actual + 1) : null;
  const avisos = [];
  if (!actual) avisos.push('Sin nivel asignado');
  if (prop && actual && prop !== actual && pasados.has(prop)) avisos.push(`Ya estuvo en L${prop} (${pasados.get(prop)})`);
  if (actual === 5 && prop === 5) avisos.push('Ya está en L5: revisar si continúa');
  return { prop, avisos };
}

export async function renderCambioCurso(view, ctx) {
  clear(view, cargando());
  const cursos = ctx.state.cursos.slice().sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
  const actual = ctx.cursoActual();
  const sig = cursos.find((c) => c.fecha_inicio > actual.fecha_inicio) || actual;
  const [alumnos, gruposAll, historial] = await Promise.all([api.alumnos(), api.gruposTodos(), api.nivelHistorial()]);
  const editor = ctx.edita('ac_alumnos');
  const E = { origen: actual.id, nuevo: sig.id, soloAvisos: false };
  const elegidos = new Map(); // alumno_id -> { incluir, nivel }
  const cont = h('div'); const resumen = h('div', { class: 'count' });
  const selCurso = (clave) => sel(cursos.map((c) => [c.id, `Curso ${c.nombre}`]), E[clave], { onchange: (e) => { E[clave] = e.target.value; elegidos.clear(); pintar(); }, 'aria-label': clave });

  function pintar() {
    const nuevo = cursos.find((c) => c.id === E.nuevo); const origen = cursos.find((c) => c.id === E.origen);
    if (!nuevo || !origen) return;
    const inscritos = alumnos.filter((a) => a.estado === 'inscrito');
    const filas = inscritos.map((a) => {
      const pasados = nivelesPasados({ alumnoId: a.id, nuevo, cursos, grupos: gruposAll, historial });
      const sel0 = elegidos.get(a.id);
      const { prop, avisos } = proponer(a, pasados, sel0 && 'nivel' in sel0 ? sel0.nivel : undefined);
      return { a, prop, avisos, incluir: sel0 ? sel0.incluir : !!prop && prop !== nivelNum(a.nivel) };
    });
    const visibles = filas.filter((f) => !E.soloAvisos || f.avisos.length);
    const nAvisos = filas.filter((f) => f.avisos.length).length; const nAplicar = filas.filter((f) => f.incluir && f.prop).length;
    resumen.textContent = `${inscritos.length} alumnos inscritos · ${nAvisos} con aviso · ${nAplicar} seleccionados para cambiar de nivel`;
    const set = (f, parche) => { elegidos.set(f.a.id, { incluir: f.incluir, nivel: f.prop, ...(elegidos.get(f.a.id) || {}), ...parche }); pintar(); };
    clear(cont, tabla([
      { t: '', sin: true, v: (f) => h('input', { type: 'checkbox', checked: f.incluir, disabled: !editor, 'aria-label': `Cambiar ${nombreAlumno(f.a)}`, onchange: (e) => set(f, { incluir: e.target.checked }) }) },
      { t: 'Alumno', v: (f) => h('strong', {}, nombreAlumno(f.a)), s: (f) => nombreAlumno(f.a) },
      { t: 'Edad hoy', num: true, v: (f) => edad(f.a.fecha_nacimiento) },
      { t: `Edad el ${nuevo.fecha_inicio.split('-').reverse().join('/')}`, num: true, v: (f) => edadEn(f.a.fecha_nacimiento, nuevo.fecha_inicio) ?? '' },
      { t: 'Nivel actual', s: (f) => f.a.nivel || '', v: (f) => pillNivel(f.a.nivel) || '—' },
      { t: 'Nivel nuevo', sin: true, v: (f) => sel([['', 'Sin cambio'], ...[1, 2, 3, 4, 5].map((n) => [String(n), `L${n}`])], f.prop ? String(f.prop) : '', { disabled: !editor, onchange: (e) => set(f, { nivel: e.target.value ? Number(e.target.value) : null, incluir: !!e.target.value }) }) },
      { t: 'Aviso', s: (f) => f.avisos.join(' '), v: (f) => (f.avisos.length ? h('span', {}, f.avisos.map((t) => pill(`⚠ ${t}`, 'warn'))) : '') },
    ], visibles, { vacio: 'No hay alumnos inscritos que mostrar.' }));
    btnAplicar.disabled = !editor || !nAplicar;
    btnAplicar.onclick = () => aplicar(filas.filter((f) => f.incluir && f.prop), nuevo);
  }

  async function aplicar(filas, nuevo) {
    const conAviso = filas.filter((f) => f.avisos.some((t) => t.startsWith('Ya estuvo'))).length;
    if (!await confirmar({ titulo: 'Aplicar cambios de nivel', texto: `Se cambiará el nivel de ${filas.length} alumnos para el curso ${nuevo.nombre}.${conAviso ? ` ${conAviso} de ellos pasan a un nivel que ya habían cursado.` : ''} Los grupos, cuotas y pagos no se tocan.`, ok: 'Aplicar' })) return;
    try {
      const cambios = filas.filter((f) => f.prop !== nivelNum(f.a.nivel));
      for (const f of cambios) await api.upd('ac_alumnos', f.a.id, { nivel: formatoNivel(f.a.nivel, f.prop) });
      if (cambios.length) await api.insMany('ac_nivel_historial', cambios.map((f) => ({ alumno_id: f.a.id, curso_id: nuevo.id, nivel_anterior: f.a.nivel || null, nivel_nuevo: formatoNivel(f.a.nivel, f.prop), fecha: hoyISO() })));
      toast(`Nivel cambiado en ${cambios.length} alumnos`); api.invalidar(); elegidos.clear(); (await api.alumnos()).forEach((x, i) => { const orig = alumnos.find((y) => y.id === x.id); if (orig) Object.assign(orig, x); }); pintar();
    } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
  }

  const btnAplicar = h('button', { class: 'btn primary small', type: 'button' }, 'Aplicar cambios de nivel');
  const chk = h('label', { class: 'check small' }, h('input', { type: 'checkbox', onchange: (e) => { E.soloAvisos = e.target.checked; pintar(); } }), ' Solo con aviso');
  clear(view, cabecera('Cambio de curso', 'Edades y nivel de cada alumno al pasar al curso siguiente', h('a', { class: 'btn small', href: '#/ac_alumnos' }, '← Alumnos'), btnAplicar),
    h('div', { class: 'filters filters-2' }, h('label', { class: 'field' }, h('span', {}, 'Del curso'), selCurso('origen')), h('label', { class: 'field' }, h('span', {}, 'Al curso'), selCurso('nuevo')), chk),
    h('div', { class: 'small muted' }, 'Propuesta: cada alumno sube un nivel (L1→L2…). Marca o desmarca y cambia el nivel nuevo a mano. El aviso ⚠ sale si el nivel nuevo ya lo cursó antes, o si no tiene nivel.'),
    resumen, cont);
  pintar();
}
