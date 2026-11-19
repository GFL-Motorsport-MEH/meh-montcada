// Horarios: cómo se reparte la semana. Cuatro vistas del mismo horario, todas editables arrastrando:
//  · Por franjas  — como el Excel: cada franja (día + hora) con los grupos que la ocupan, su ficha arriba y los alumnos debajo.
//  · Parrilla semanal — días × horas con un chip por grupo; al pasar el ratón por encima se ve la ficha y los alumnos.
//  · Por profesora / Uso de aulas — una rejilla de tiempo por profesora o por aula, con avisos de solape y horas semanales.
// Clic en una sesión = editarla; arrastrar = moverla (a otro día/hora o, en las rejillas, a otra profesora/aula).
import { h, clear, cargando, toast, confirmar } from '../ui.js';
import * as api from './api.js';
import { campo, sel, drawer, cabecera, hhmm, DIAS, DIAS_CORTO, colorGrupo, colorNivel, nombreAlumno, pill, guardarBoton, refrescar } from './kit.js';
import { abrirGrupo, sesionesTexto } from './grupos.js';

const aMin = (t) => { const [a, b] = hhmm(t).split(':').map(Number); return a * 60 + b; };
const aHora = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const horasTxt = (min) => `${(min / 60).toLocaleString('es-ES', { maximumFractionDigits: 1 })} h`;
const TODOS = '*'; // «recurso» de las vistas que no separan por profesora ni aula
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// estado que se recuerda al cambiar de pestaña
let vista = 'franjas';
let color = 'nivel';
let diaSel = 0;
let profSel = '';
let busca = '';
let todasHoras = false;

// ---------- ventana flotante con la ficha del grupo (al pasar el ratón) ----------
let pop = null; let temporizador = null;
export function ocultarPop() { clearTimeout(temporizador); if (pop) { pop.remove(); pop = null; } }
function conInfo(el, construir) {
  el.addEventListener('mouseenter', (e) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      ocultarPop();
      pop = h('div', { class: 'ac-pop', role: 'tooltip' }, construir());
      document.body.append(pop);
      const r = pop.getBoundingClientRect();
      const x = Math.min(e.clientX + 14, window.innerWidth - r.width - 8); const y = e.clientY + 16 + r.height > window.innerHeight ? Math.max(8, e.clientY - r.height - 10) : e.clientY + 16;
      pop.style.left = `${Math.max(8, x)}px`; pop.style.top = `${y}px`;
    }, 200);
  });
  el.addEventListener('mouseleave', ocultarPop);
  el.addEventListener('dragstart', ocultarPop);
  el.addEventListener('click', ocultarPop);
}

export async function renderHorarios(view, ctx) {
  ocultarPop();
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const editor = ctx.edita('ac_calendario');
  const [todosGrupos, profes, aulas, alumnos, ls] = await Promise.all([api.grupos(curso.id), api.profesoras(), api.aulas(), api.alumnos(), api.listas()]);
  const propio = !ctx.ve('ac_calendario');
  const yo = propio ? ctx.miProfesora(profes) : null;
  const grupos = todosGrupos;
  const pPor = new Map(profes.map((p) => [p.id, p])); const aPor = new Map(aulas.map((a) => [a.id, a]));
  const aluPor = new Map(alumnos.map((a) => [a.id, a]));
  const activos = (g) => g.miembros.filter((m) => !m.fecha_baja);
  const alumnosDe = (g) => activos(g).map((m) => aluPor.get(m.alumno_id)).filter(Boolean).sort((a, b) => nombreAlumno(a).localeCompare(nombreAlumno(b), 'es'));
  // quien solo ve «lo suyo» no ve los alumnos de grupos ajenos (la base de datos no se los da)
  const veMiembros = (g) => !propio || (yo && (g.profesora_id === yo.id || g.sesiones.some((s) => s.profesora_id === yo.id)));
  const sesiones = grupos.filter((g) => g.activo).flatMap((g) => g.sesiones.map((s) => ({ g, s, prof: s.profesora_id || g.profesora_id || null, aula: s.aula_id || g.aula_id || null, ini: aMin(s.hora_inicio), fin: aMin(s.hora_fin) })));
  const recargar = () => { refrescar(); };
  const cont = h('div', { class: 'ac-cal-cont' });
  const aviso = h('div');
  const barra = h('div', { class: 'ac-barra' });
  const modo = () => (vista === 'aula' ? 'aula' : 'profesora');
  const colorDe = (x) => (color === 'profesora' ? pPor.get(x.prof)?.color || '#8c8a81' : color === 'nivel' ? colorNivel(x.g.nivel) || colorGrupo(x.g) : colorGrupo(x.g));

  const seg = h('div', { class: 'segmented', role: 'tablist' }, [['franjas', 'Por franjas'], ['parrilla', 'Parrilla semanal'], ['profesora', 'Por profesora'], ['aula', 'Uso de aulas']].map(([k, l]) =>
    h('button', { class: 'seg-btn', role: 'tab', type: 'button', 'aria-selected': String(vista === k), onclick: () => { vista = k; seg.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-selected', String(b.textContent === l))); pintar(); } }, l)));

  // ---------- ficha que sale al pasar el ratón ----------
  function ficha(x) {
    const g = x.g; const al = veMiembros(g) ? alumnosDe(g) : null;
    return [
      h('div', { class: 'ac-pop-cab', style: `--c:${colorGrupo(g)}` }, h('strong', {}, g.nombre), h('span', { class: 'small muted' }, [g.modalidad, g.nivel].filter(Boolean).join(' · '))),
      h('div', { class: 'ac-pop-meta small' },
        h('div', {}, `${DIAS[x.s.dia]} ${hhmm(x.s.hora_inicio)}–${hhmm(x.s.hora_fin)}`),
        h('div', {}, `Profesora: ${pPor.get(x.prof)?.nombre || 'sin asignar'} · Aula: ${aPor.get(x.aula)?.nombre || 'sin asignar'}`),
        g.anios_nacimiento ? h('div', {}, `Nacidos: ${g.anios_nacimiento}`) : null,
        h('div', { class: 'muted' }, `Semana: ${sesionesTexto(g)}`)),
      al ? h('div', { class: 'ac-pop-al' }, h('div', { class: 'small muted' }, `${al.length}/${g.capacidad} alumnos`), h('ol', { class: al.length > 10 ? 'dos' : '' }, al.map((a) => h('li', {}, nombreAlumno(a))))) : h('div', { class: 'small muted' }, 'Los alumnos de este grupo no son tuyos.'),
    ];
  }

  // ---------- mover una sesión ----------
  async function mover(id, dia, ini, recurso, fin) {
    const x = sesiones.find((q) => q.s.id === id); if (!x) return;
    const parche = { dia, hora_inicio: aHora(ini), hora_fin: aHora(fin ?? ini + (x.fin - x.ini)) };
    if (recurso && recurso !== TODOS) {
      if (modo() === 'profesora') parche.profesora_id = recurso === (x.g.profesora_id || null) ? null : recurso;
      else parche.aula_id = recurso === (x.g.aula_id || null) ? null : recurso;
    }
    try { await api.upd('ac_sesiones', id, parche); toast('Sesión movida'); recargar(); } catch (ex) { toast('No se ha movido: ' + ex.message, 'error'); }
  }
  const arrastrable = (el, x) => {
    if (!editor) return;
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', x.s.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('arrastrando'); });
    el.addEventListener('dragend', () => el.classList.remove('arrastrando'));
  };
  const soltable = (el, alSoltar) => {
    if (!editor) return;
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drop'); const id = e.dataTransfer.getData('text/plain'); if (id) alSoltar(id); });
  };

  // ---------- 1) por franjas (como el Excel) ----------
  function franjas() {
    const q = norm(busca);
    const visibles = sesiones.filter((x) => (!diaSel || x.s.dia === diaSel) && (!profSel || x.prof === profSel)
      && (!q || norm(x.g.nombre).includes(q) || (veMiembros(x.g) && alumnosDe(x.g).some((a) => norm(nombreAlumno(a)).includes(q)))));
    if (!visibles.length) return h('div', { class: 'card empty' }, sesiones.length ? 'Ninguna sesión coincide con el filtro.' : 'Todavía no hay sesiones. Crea grupos con sus sesiones en «Grupos».');
    const mapa = new Map();
    for (const x of visibles) { const k = `${x.s.dia}|${x.ini}|${x.fin}`; if (!mapa.has(k)) mapa.set(k, { dia: x.s.dia, ini: x.ini, fin: x.fin, xs: [] }); mapa.get(k).xs.push(x); }
    const bloques = [...mapa.values()].sort((a, b) => a.dia - b.dia || a.ini - b.ini || a.fin - b.fin);
    const dias = [...new Set(bloques.map((b) => b.dia))];
    return h('div', { class: 'ac-fr' }, dias.map((d) => h('section', { class: 'ac-fr-dia' }, h('h3', { class: 'ac-fr-dia-t' }, DIAS[d]),
      bloques.filter((b) => b.dia === d).map((b) => {
        const bloque = h('div', { class: 'ac-fr-bloque' },
          h('div', { class: 'ac-fr-hora' }, h('strong', {}, `${aHora(b.ini)} – ${aHora(b.fin)}`), h('span', { class: 'small muted' }, `${b.xs.length} grupo${b.xs.length === 1 ? '' : 's'}`)),
          h('div', { class: 'ac-fr-grupos' }, b.xs.sort((x, y) => x.g.nombre.localeCompare(y.g.nombre, 'es', { numeric: true })).map((x) => tarjeta(x, q))));
        soltable(bloque, (id) => mover(id, b.dia, b.ini, TODOS, b.fin));
        return bloque;
      }))));
  }
  function tarjeta(x, q) {
    const g = x.g; const ve = veMiembros(g); const al = ve ? alumnosDe(g) : [];
    const p = pPor.get(x.prof); const n = ve ? activos(g).length : null;
    const el = h('article', { class: 'ac-fr-card', style: `--c:${colorDe(x)}` },
      h('header', { class: 'ac-fr-cab' }, h('strong', { class: 'ac-fr-nombre', title: 'Abrir la ficha del grupo', onclick: () => abrirFicha(g) }, g.nombre),
        n === null ? null : pill(`${n}/${g.capacidad}`, n > g.capacidad ? 'warn' : n === g.capacidad ? 'ok' : 'off'),
        editor ? h('button', { class: 'btn small ghost ac-fr-ed', type: 'button', title: 'Editar esta sesión (hora, profesora, aula)', onclick: (e) => { e.stopPropagation(); abrirSesion(x); } }, '✎') : null),
      h('div', { class: 'ac-fr-meta small' },
        h('span', {}, p ? h('span', {}, h('span', { class: 'ac-punto', style: `background:${p.color}` }), p.nombre) : h('span', { class: 'muted' }, 'sin profesora')),
        aPor.get(x.aula) ? h('span', {}, `Aula ${aPor.get(x.aula).nombre}`) : null,
        g.nivel ? h('span', {}, `Nivel ${g.nivel}`) : null, g.anios_nacimiento ? h('span', {}, g.anios_nacimiento) : null),
      ve ? h('ol', { class: 'ac-fr-alu' }, al.length ? al.map((a) => h('li', { class: q && norm(nombreAlumno(a)).includes(q) ? 'hit' : '' }, nombreAlumno(a))) : h('li', { class: 'muted vacio' }, 'Sin alumnos')) : h('div', { class: 'small muted' }, 'Alumnos no visibles'));
    arrastrable(el, x);
    return el;
  }
  const abrirFicha = (g) => { ocultarPop(); abrirGrupo(g, { ctx, curso, profes, aulas, alumnos, ls, recargar }); };

  // ---------- 2) parrilla semanal (chips) ----------
  function parrilla() {
    const lista = sesiones.filter((x) => !profSel || x.prof === profSel);
    const inicios = new Set(lista.map((x) => x.ini));
    if (todasHoras) for (let m = 8 * 60; m <= 21 * 60; m += 30) inicios.add(m);
    if (!inicios.size) return h('div', { class: 'card empty' }, 'Añade sesiones a los grupos para ver la parrilla.');
    const dias = [1, 2, 3, 4, 5, 6];
    const filas = [...inicios].sort((a, b) => a - b);
    const chip = (x) => {
      const el = h('span', { class: 'ac-chip' + (editor ? ' ed' : ''), style: `--c:${colorDe(x)}`, onclick: () => abrirSesion(x) }, x.g.nombre, x.fin - x.ini !== 60 ? h('small', {}, ` ${x.fin - x.ini}'`) : null);
      arrastrable(el, x); conInfo(el, () => ficha(x));
      return el;
    };
    const celda = (m, d) => {
      const td = h('td', { class: 'ac-pcelda', 'data-dia': d, 'data-min': m }, lista.filter((x) => x.s.dia === d && x.ini === m).sort((a, b) => a.g.nombre.localeCompare(b.g.nombre, 'es', { numeric: true })).map(chip));
      soltable(td, (id) => mover(id, d, m, TODOS));
      return td;
    };
    return h('div', { class: 'table-wrap card-tabla' }, h('table', { class: 'data ac-parrilla' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Hora'), dias.map((d) => h('th', {}, DIAS[d])))),
      h('tbody', {}, filas.map((m) => h('tr', {}, h('th', {}, aHora(m)), dias.map((d) => celda(m, d)))))));
  }

  // ---------- 3) rejillas de tiempo (por profesora / por aula) ----------
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
  function rejilla(titulo, lista, recurso, extra) {
    if (!lista.length && !(editor && recurso)) return null;
    const min = Math.min(14 * 60, ...lista.map((x) => Math.floor(x.ini / 30) * 30)); const max = Math.max(21 * 60, ...lista.map((x) => Math.ceil(x.fin / 30) * 30));
    const filas = (max - min) / 30; const choque = solapes(lista); const car = carriles(lista);
    const dias = lista.some((x) => x.s.dia === 6) ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
    const g = h('div', { class: 'ac-cal', style: `grid-template-columns: 42px repeat(${dias.length}, minmax(0, 1fr)); grid-template-rows: 24px repeat(${filas}, 20px)` }, h('div', { class: 'ac-cal-h' }),
      dias.map((d, i) => h('div', { class: 'ac-cal-h', style: `grid-column:${i + 2}` }, DIAS[d])));
    for (let r = 0; r < filas; r++) {
      const m = min + r * 30;
      g.append(h('div', { class: 'ac-cal-hora', style: `grid-row:${r + 2}` }, m % 60 === 0 ? aHora(m) : ''));
      dias.forEach((d, i) => {
        const c = h('div', { class: 'ac-cal-vacio' + (editor ? ' ed' : ''), style: `grid-column:${i + 2}; grid-row:${r + 2}`, 'data-dia': d, 'data-min': m, onclick: editor ? () => abrirSesion(null, { dia: d, ini: m, recurso }) : null });
        if (recurso !== null) soltable(c, (id) => mover(id, d, m, recurso));
        g.append(c);
      });
    }
    for (const x of lista) {
      const i = dias.indexOf(x.s.dia); if (i < 0) continue;
      const el = h('div', { class: 'ac-cal-ses' + (choque.has(x) ? ' choque' : '') + (editor ? ' ed' : ''),
        style: `grid-column:${i + 2}; grid-row:${(x.ini - min) / 30 + 2} / ${(x.fin - min) / 30 + 2}; --c:${colorDe(x)}; justify-self:start; width:calc(${100 / car.get(x).n}% - 2px); margin-left:${(100 / car.get(x).n) * car.get(x).lane}%`,
        onclick: (e) => { e.stopPropagation(); abrirSesion(x, { recurso }); } },
      h('strong', {}, x.g.nombre), h('span', {}, modo() === 'profesora' ? (aPor.get(x.aula)?.nombre || '') : (pPor.get(x.prof)?.nombre || '')));
      arrastrable(el, x); conInfo(el, () => ficha(x));
      g.append(el);
    }
    const total = lista.reduce((a, x) => a + (x.fin - x.ini), 0);
    return h('div', { class: 'card ac-cal-card' }, h('h3', { class: 'sub-titulo' }, titulo, h('span', { class: 'ac-horas small' }, extra ? extra(total) : horasTxt(total)),
      choque.size ? h('span', { class: 'pill warn', style: 'margin-left:8px' }, `${Math.max(1, choque.size / 2 | 0)} solape(s)`) : null), g);
  }
  function rejillas() {
    const tarjetas = []; let hayChoque = false;
    if (modo() === 'profesora') {
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
    clear(aviso, hayChoque ? h('div', { class: 'banner warn' }, `Hay sesiones solapadas (marcadas en rojo): ${modo() === 'profesora' ? 'una profesora con dos clases a la vez' : 'dos grupos en la misma aula a la vez'}.`) : null);
    return tarjetas.length ? tarjetas : h('div', { class: 'card empty' }, 'Todavía no hay profesoras, aulas ni sesiones. Créalas en «Grupos».');
  }

  // ---------- barra de filtros según la vista ----------
  function pintarBarra() {
    const selProf = sel([['', 'Todas las profesoras'], ...profes.filter((p) => p.activa).map((p) => [p.id, p.nombre])].map(([v, n]) => [v, n]), profSel, { onchange: (e) => { profSel = e.target.value; pintar(); } });
    const selColor = sel([['nivel', 'Color: nivel'], ['modalidad', 'Color: modalidad'], ['profesora', 'Color: profesora']], color, { onchange: (e) => { color = e.target.value; pintar(); } });
    const leyenda = h('div', { class: 'ac-leyenda small muted' }, [['Babies', '#5aa469'], ['Kids', '#d9b72e'], ['Teens', '#e08a3c'], ['Adults', '#d76f9a'], ['1 to 1', '#4f7cff']].map(([n, c]) => h('span', {}, h('span', { class: 'ac-punto', style: `background:${c}` }), n)));
    if (vista === 'franjas') {
      const dias = h('div', { class: 'segmented' }, [[0, 'Todos'], ...[1, 2, 3, 4, 5, 6].map((d) => [d, DIAS_CORTO[d]])].map(([d, l]) => h('button', { class: 'seg-btn', type: 'button', title: d ? DIAS[d] : 'Todos los días', 'aria-pressed': String(diaSel === d), 'aria-selected': String(diaSel === d), onclick: () => { diaSel = d; pintar(); } }, l)));
      const buscador = h('input', { type: 'search', placeholder: 'Buscar grupo o alumno…', value: busca, 'aria-label': 'Buscar grupo o alumno', oninput: (e) => { busca = e.target.value; clearTimeout(buscador._t); buscador._t = setTimeout(() => { clear(cont, franjas()); }, 150); } });
      clear(barra, dias, selProf, selColor, buscador, leyenda);
    } else if (vista === 'parrilla') {
      clear(barra, selProf, selColor, h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: todasHoras, onchange: (e) => { todasHoras = e.target.checked; pintar(); } }), ' Mostrar todas las horas (para soltar en un hueco)'), leyenda);
    } else clear(barra, selColor, leyenda);
  }

  function pintar() {
    ocultarPop();
    clear(aviso);
    pintarBarra();
    if (vista === 'franjas') clear(cont, franjas());
    else if (vista === 'parrilla') clear(cont, parrilla());
    else clear(cont, rejillas());
    cont.classList.toggle('ac-cal-cont', vista === 'profesora' || vista === 'aula');
  }

  // ---------- ficha de una sesión ----------
  function abrirSesion(x, { dia, ini, recurso } = {}) {
    ocultarPop();
    if (!editor && !x) return;
    if (!grupos.length) { toast('Primero crea algún grupo en «Grupos».', 'error'); return; }
    const d = drawer({ titulo: x ? `Sesión · ${x.g.nombre}` : 'Nueva sesión', ancho: 500 });
    const rec = recurso === TODOS ? null : recurso;
    const prof0 = x ? x.prof : modo() === 'profesora' ? rec : null; const aula0 = x ? x.aula : modo() === 'aula' ? rec : null;
    const F = {
      grupo: sel(grupos.filter((g) => g.activo || g.id === x?.g.id).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true })).map((g) => [g.id, g.nombre]), x?.g.id, { vacio: x ? undefined : 'Elige grupo…', disabled: !!x }),
      dia: sel(DIAS.slice(1, 7).map((n, k) => [String(k + 1), n]), String(x ? x.s.dia : dia ?? 1)), ini: h('input', { type: 'time', value: x ? hhmm(x.s.hora_inicio) : aHora(ini ?? 17 * 60) }), fin: h('input', { type: 'time', value: x ? hhmm(x.s.hora_fin) : aHora((ini ?? 17 * 60) + 60) }),
      prof: sel(profes.filter((p) => p.activa || p.id === prof0).map((p) => [p.id, p.nombre]), prof0, { vacio: 'Sin asignar' }), aula: sel(aulas.filter((a) => a.activa || a.id === aula0).map((a) => [a.id, a.nombre]), aula0, { vacio: 'Sin asignar' }),
    };
    d.cuerpo.append(h('div', { class: 'form-section' }, campo('Grupo', F.grupo, { full: true, req: true }), campo('Día', F.dia), campo('Inicio', F.ini), campo('Fin', F.fin), campo('Profesora', F.prof), campo('Aula', F.aula)),
      h('div', { class: 'small muted' }, 'Si eliges la profesora o el aula del grupo, la sesión las hereda; si eliges otra, solo esta sesión cambia. También puedes arrastrar la sesión a otra hora, día o franja.'));
    const guardar = guardarBoton('Guardar', async () => {
      const g = grupos.find((q) => q.id === (x ? x.g.id : F.grupo.value));
      if (!g) { toast('Elige un grupo.', 'error'); return; }
      if (!F.ini.value || !F.fin.value || F.fin.value <= F.ini.value) { toast('El fin debe ser posterior al inicio.', 'error'); return; }
      const fila = { dia: Number(F.dia.value), hora_inicio: F.ini.value, hora_fin: F.fin.value, profesora_id: (F.prof.value || null) === (g.profesora_id || null) ? null : F.prof.value || null, aula_id: (F.aula.value || null) === (g.aula_id || null) ? null : F.aula.value || null };
      try { x ? await api.upd('ac_sesiones', x.s.id, fila) : await api.ins('ac_sesiones', { grupo_id: g.id, ...fila }); toast('Sesión guardada'); d.cerrar(); recargar(); } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
    });
    guardar.disabled = !editor;
    const ficha_ = x ? h('button', { class: 'btn', type: 'button', onclick: () => { d.cerrar(); abrirFicha(x.g); } }, 'Ficha del grupo') : null;
    const borrar = x && editor ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Quitar sesión', texto: `${x.g.nombre} · ${DIAS[x.s.dia]} ${hhmm(x.s.hora_inicio)}`, ok: 'Quitar', peligro: true })) { try { await api.del('ac_sesiones', x.s.id); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } } }, 'Quitar sesión') : h('span');
    d.pie.append(borrar, h('div', { class: 'ac-fila' }, ficha_, guardar));
  }

  const sub = editor ? 'Arrastra los grupos para moverlos, clic para editarlos; pasa el ratón por encima para ver sus alumnos' : 'Pasa el ratón por encima de un grupo para ver sus alumnos';
  clear(view, cabecera(`Horarios · ${curso.nombre}`, sub, seg, editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrirSesion(null, { dia: diaSel || 1, ini: 17 * 60 }) }, '+ Nueva sesión') : null), barra, aviso, cont);
  pintar();
}
