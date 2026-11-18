// Calendario de profesoras y uso de aulas: parrilla semanal editable (clic en hueco = nueva sesión, clic en sesión = editar,
// arrastrar = mover de hora/día o pasar a otra profesora/aula). Colores por modalidad, horas semanales por profesora y avisos de solape.
import { h, clear, cargando, toast, confirmar } from '../ui.js';
import * as api from './api.js';
import { campo, sel, drawer, cabecera, hhmm, DIAS, colorGrupo, COLORES_MODALIDAD, guardarBoton, refrescar } from './kit.js';

const aMin = (t) => { const [a, b] = hhmm(t).split(':').map(Number); return a * 60 + b; };
const aHora = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const horasTxt = (min) => `${(min / 60).toLocaleString('es-ES', { maximumFractionDigits: 1 })} h`;
let modo = 'profesora';
let color = 'modalidad';

export async function renderCalendario(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const editor = ctx.puedeEditar();
  const [grupos, profes, aulas] = await Promise.all([api.grupos(curso.id), api.profesoras(), api.aulas()]);
  const pPor = new Map(profes.map((p) => [p.id, p])); const aPor = new Map(aulas.map((a) => [a.id, a]));
  const sesiones = grupos.filter((g) => g.activo).flatMap((g) => g.sesiones.map((s) => ({ g, s, prof: s.profesora_id || g.profesora_id || null, aula: s.aula_id || g.aula_id || null, ini: aMin(s.hora_inicio), fin: aMin(s.hora_fin) })));
  const cont = h('div', { class: 'ac-cal-cont' });
  const aviso = h('div');
  const recargar = () => { api.invalidar(); refrescar(); };
  const selModo = sel([['profesora', 'Por profesora'], ['aula', 'Uso de aulas']], modo, { onchange: (e) => { modo = e.target.value; pintar(); } });
  const selColor = sel([['modalidad', 'Color: modalidad'], ['profesora', 'Color: profesora']], color, { onchange: (e) => { color = e.target.value; pintar(); } });
  const leyenda = h('div', { class: 'ac-leyenda small muted' }, [['Babies', '#5aa469'], ['Kids', '#d9b72e'], ['Teens', '#e08a3c'], ['Adults', '#d76f9a'], ['1 to 1', '#4f7cff']].map(([n, c]) => h('span', {}, h('span', { class: 'ac-punto', style: `background:${c}` }), n)));

  function solapes(lista) {
    const out = new Set();
    for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) { const a = lista[i], b = lista[j]; if (a.s.dia === b.s.dia && a.ini < b.fin && b.ini < a.fin) { out.add(a); out.add(b); } }
    return out;
  }
  // sesiones que se pisan el mismo día: se colocan una al lado de otra
  function carriles(lista) {
    const info = new Map(); const porDia = {};
    lista.forEach((x) => (porDia[x.s.dia] ||= []).push(x));
    for (const l of Object.values(porDia)) {
      l.sort((a, b) => a.ini - b.ini || a.fin - b.fin);
      let grupo = []; let finMax = -1;
      const cerrar = () => { const fines = []; for (const x of grupo) { let k = fines.findIndex((f) => f <= x.ini); if (k < 0) { k = fines.length; fines.push(0); } fines[k] = x.fin; info.set(x, { lane: k }); } grupo.forEach((x) => { info.get(x).n = fines.length; }); grupo = []; finMax = -1; };
      for (const x of l) { if (grupo.length && x.ini >= finMax) cerrar(); grupo.push(x); finMax = Math.max(finMax, x.fin); }
      if (grupo.length) cerrar();
    }
    return info;
  }
  const colorDe = (x) => (color === 'profesora' ? pPor.get(x.prof)?.color || '#8c8a81' : colorGrupo(x.g));

  // mueve una sesión a otro día/hora (y, si se suelta en otra tarjeta, a otra profesora o aula)
  async function mover(id, dia, ini, recurso) {
    const x = sesiones.find((q) => q.s.id === id); if (!x) return;
    const dur = x.fin - x.ini;
    const parche = { dia, hora_inicio: aHora(ini), hora_fin: aHora(ini + dur) };
    if (recurso !== undefined && recurso !== null) {
      if (modo === 'profesora') parche.profesora_id = recurso === (x.g.profesora_id || null) ? null : recurso;
      else parche.aula_id = recurso === (x.g.aula_id || null) ? null : recurso;
    }
    try { await api.upd('ac_sesiones', id, parche); toast('Sesión movida'); recargar(); } catch (ex) { toast('No se ha movido: ' + ex.message, 'error'); }
  }

  function rejilla(titulo, lista, recurso, extra) {
    const todas = lista.length ? lista : [];
    if (!todas.length && !(editor && recurso)) return null;
    const min = Math.min(14 * 60, ...todas.map((x) => Math.floor(x.ini / 30) * 30)); const max = Math.max(21 * 60, ...todas.map((x) => Math.ceil(x.fin / 30) * 30));
    const filas = (max - min) / 30; const choque = solapes(lista); const car = carriles(lista);
    const dias = lista.some((x) => x.s.dia === 6) ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
    const g = h('div', { class: 'ac-cal', style: `grid-template-columns: 42px repeat(${dias.length}, minmax(0, 1fr)); grid-template-rows: 24px repeat(${filas}, 20px)` }, h('div', { class: 'ac-cal-h' }),
      dias.map((d, i) => h('div', { class: 'ac-cal-h', style: `grid-column:${i + 2}` }, DIAS[d])));
    for (let r = 0; r < filas; r++) {
      const m = min + r * 30;
      g.append(h('div', { class: 'ac-cal-hora', style: `grid-row:${r + 2}` }, m % 60 === 0 ? aHora(m) : ''));
      if (recurso === undefined) continue;
      dias.forEach((d, i) => {
        const c = h('div', { class: 'ac-cal-vacio' + (editor ? ' ed' : ''), style: `grid-column:${i + 2}; grid-row:${r + 2}`, 'data-dia': d, 'data-min': m,
          onclick: editor ? () => abrirSesion(null, { dia: d, ini: m, recurso }) : null });
        if (editor && recurso !== null) {
          c.addEventListener('dragover', (e) => { e.preventDefault(); c.classList.add('drop'); });
          c.addEventListener('dragleave', () => c.classList.remove('drop'));
          c.addEventListener('drop', (e) => { e.preventDefault(); c.classList.remove('drop'); const id = e.dataTransfer.getData('text/plain'); if (id) mover(id, d, m, recurso); });
        }
        g.append(c);
      });
    }
    for (const x of lista) {
      const i = dias.indexOf(x.s.dia); if (i < 0) continue;
      const el = h('div', { class: 'ac-cal-ses' + (choque.has(x) ? ' choque' : '') + (editor ? ' ed' : ''), draggable: editor ? 'true' : null,
        style: `grid-column:${i + 2}; grid-row:${(x.ini - min) / 30 + 2} / ${(x.fin - min) / 30 + 2}; --c:${colorDe(x)}; justify-self:start; width:calc(${100 / car.get(x).n}% - 2px); margin-left:${(100 / car.get(x).n) * car.get(x).lane}%`,
        title: `${x.g.nombre} ${hhmm(x.s.hora_inicio)}-${hhmm(x.s.hora_fin)} · ${pPor.get(x.prof)?.nombre || 'sin profesora'} · ${aPor.get(x.aula)?.nombre || 'sin aula'}`,
        onclick: (e) => { e.stopPropagation(); abrirSesion(x, { recurso }); } },
      h('strong', {}, x.g.nombre), h('span', {}, modo === 'profesora' ? (aPor.get(x.aula)?.nombre || '') : (pPor.get(x.prof)?.nombre || '')));
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', x.s.id); e.dataTransfer.effectAllowed = 'move'; });
      g.append(el);
    }
    const min_ = lista.reduce((a, x) => a + (x.fin - x.ini), 0);
    return h('div', { class: 'card ac-cal-card' }, h('h3', { class: 'sub-titulo' }, titulo, h('span', { class: 'ac-horas small' }, extra ? extra(min_) : horasTxt(min_)),
      choque.size ? h('span', { class: 'pill warn', style: 'margin-left:8px' }, `${Math.max(1, choque.size / 2 | 0)} solape(s)`) : null), g);
  }

  function pintar() {
    const tarjetas = []; let hayChoque = false;
    if (modo === 'profesora') {
      for (const p of profes.filter((x) => x.activa)) {
        const l = sesiones.filter((x) => x.prof === p.id);
        const r = rejilla(p.nombre, l, p.id, (m) => (p.horas_semana ? `${horasTxt(m)} / ${p.horas_semana.toLocaleString?.('es-ES') ?? p.horas_semana} h` : horasTxt(m)));
        if (r) tarjetas.push(r); if (solapes(l).size) hayChoque = true;
      }
      const sin = sesiones.filter((x) => !x.prof); const r = rejilla('Sin profesora asignada', sin, null); if (r) tarjetas.push(r);
    } else {
      for (const a of aulas.filter((x) => x.activa)) { const l = sesiones.filter((x) => x.aula === a.id); const r = rejilla(a.nombre, l, a.id); if (r) tarjetas.push(r); if (solapes(l).size) hayChoque = true; }
      const sin = sesiones.filter((x) => !x.aula); const r = rejilla('Sin aula asignada', sin, null); if (r) tarjetas.push(r);
    }
    clear(aviso, hayChoque ? h('div', { class: 'banner warn' }, `Hay sesiones solapadas (marcadas en rojo): ${modo === 'profesora' ? 'una profesora con dos clases a la vez' : 'dos grupos en la misma aula a la vez'}.`) : null);
    clear(cont, tarjetas.length ? tarjetas : h('div', { class: 'card empty' }, 'Todavía no hay profesoras, aulas ni sesiones. Créalas en «Grupos y horarios».'));
  }

  // ---- ficha de una sesión ----
  function abrirSesion(x, { dia, ini, recurso } = {}) {
    if (!editor && !x) return;
    if (!grupos.length) { toast('Primero crea algún grupo en «Grupos y horarios».', 'error'); return; }
    const d = drawer({ titulo: x ? `Sesión · ${x.g.nombre}` : 'Nueva sesión', ancho: 500 });
    const prof0 = x ? x.prof : modo === 'profesora' ? recurso : null; const aula0 = x ? x.aula : modo === 'aula' ? recurso : null;
    const F = {
      grupo: sel(grupos.filter((g) => g.activo || g.id === x?.g.id).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true })).map((g) => [g.id, g.nombre]), x?.g.id, { vacio: x ? undefined : 'Elige grupo…', disabled: !!x }),
      dia: sel(DIAS.slice(1, 7).map((n, k) => [String(k + 1), n]), String(x ? x.s.dia : dia)), ini: h('input', { type: 'time', value: x ? hhmm(x.s.hora_inicio) : aHora(ini) }), fin: h('input', { type: 'time', value: x ? hhmm(x.s.hora_fin) : aHora((ini || 0) + 60) }),
      prof: sel(profes.filter((p) => p.activa || p.id === prof0).map((p) => [p.id, p.nombre]), prof0, { vacio: 'Sin asignar' }), aula: sel(aulas.filter((a) => a.activa || a.id === aula0).map((a) => [a.id, a.nombre]), aula0, { vacio: 'Sin asignar' }),
    };
    d.cuerpo.append(h('div', { class: 'form-section' }, campo('Grupo', F.grupo, { full: true, req: true }), campo('Día', F.dia), campo('Inicio', F.ini), campo('Fin', F.fin), campo('Profesora', F.prof), campo('Aula', F.aula)),
      h('div', { class: 'small muted' }, 'Si eliges la profesora o el aula del grupo, la sesión las hereda; si eliges otra, solo esta sesión cambia. También puedes arrastrar la sesión a otra hora, día o tarjeta.'));
    const guardar = guardarBoton('Guardar', async () => {
      const g = grupos.find((q) => q.id === (x ? x.g.id : F.grupo.value));
      if (!g) { toast('Elige un grupo.', 'error'); return; }
      if (!F.ini.value || !F.fin.value || F.fin.value <= F.ini.value) { toast('El fin debe ser posterior al inicio.', 'error'); return; }
      const fila = { dia: Number(F.dia.value), hora_inicio: F.ini.value, hora_fin: F.fin.value, profesora_id: (F.prof.value || null) === (g.profesora_id || null) ? null : F.prof.value || null, aula_id: (F.aula.value || null) === (g.aula_id || null) ? null : F.aula.value || null };
      try { x ? await api.upd('ac_sesiones', x.s.id, fila) : await api.ins('ac_sesiones', { grupo_id: g.id, ...fila }); toast('Sesión guardada'); d.cerrar(); recargar(); } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
    });
    guardar.disabled = !editor;
    const borrar = x && editor ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Quitar sesión', texto: `${x.g.nombre} · ${DIAS[x.s.dia]} ${hhmm(x.s.hora_inicio)}`, ok: 'Quitar', peligro: true })) { try { await api.del('ac_sesiones', x.s.id); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } } }, 'Quitar sesión') : h('span');
    d.pie.append(borrar, guardar);
  }

  clear(view, cabecera(`Calendario · ${curso.nombre}`, editor ? 'Clic en un hueco para crear una sesión, clic en una sesión para editarla, arrastra para moverla' : 'Horario semanal de las profesoras y uso de las aulas', selModo, selColor), leyenda, aviso, cont);
  pintar();
}
