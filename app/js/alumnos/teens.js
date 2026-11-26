// ALUMNOS · TEENS Championship: notas de los test de unidad y exámenes por nivel (A2 / B1 / B2), clasificación de grupos y de alumnos.
// Cuatro vistas: Clasificación · Alumnos y grupos · Notas · Configuración (pesos y total de cada prueba). Cálculo en teens-calc.js.
import { h, clear, cargando, toast, confirmar, normalizar } from '../ui.js';
import * as api from './api.js';
import { sel, txt, tabla, cabecera } from '../academia/kit.js';
import { NIVELES, PRUEBAS, CFG_DEF, configDe, mediaAlumno, notasPorAlumno, clasificacion } from './teens-calc.js';

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const porNombre = (a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true });
const VISTAS = [['clas', 'Clasificación'], ['alu', 'Alumnos y grupos'], ['notas', 'Notas'], ['cfg', 'Configuración']];
let nivel = 'A2', vista = 'clas', grupoNotas = '';

export async function renderTeens(view, ctx) {
  clear(view, cargando());
  const d0 = await api.teens();
  const D = { grupos: [...d0.grupos], alumnos: [...d0.alumnos], notas: [...d0.notas], config: [...d0.config] };
  const raiz = h('div'); // el router puede mover el contenido de «view»: se repinta siempre dentro de un contenedor propio
  clear(view, raiz);
  const editor = ctx.edita('al_teens');
  const guardar = (fn) => fn().catch((ex) => toast(ex.message, 'error'));
  let cola = Promise.resolve(); // las notas se guardan de una en una, para no duplicar filas al teclear deprisa
  const encolar = (fn) => { cola = cola.then(fn).catch((ex) => toast(ex.message, 'error')); return cola; };

  function pintar() {
    const c = configDe(D.config);
    const cuerpo = vista === 'clas' ? vClasificacion(c) : vista === 'alu' ? vAlumnos() : vista === 'notas' ? vNotas(c) : vConfig(c);
    clear(raiz, cabecera('TEENS Championship', 'Clasificación de los test de inglés por nivel y grupo'),
      h('div', { class: 'al-barra' }, VISTAS.map(([k, t]) => h('button', { class: 'btn small' + (k === vista ? ' primary' : ''), type: 'button', onclick: () => { vista = k; pintar(); } }, t))),
      vista === 'cfg' ? null : h('div', { class: 'al-barra' }, NIVELES.map(([k, t]) => h('button', { class: 'btn small' + (k === nivel ? ' primary' : ''), type: 'button', onclick: () => { nivel = k; grupoNotas = ''; pintar(); } }, t))),
      cuerpo);
  }

  // ---------- Clasificación ----------
  function vClasificacion(c) {
    const r = clasificacion(D.grupos, D.alumnos, D.notas, c, nivel);
    const podio = r.grupos.filter((x) => x.pos && x.pos <= 3), resto = r.grupos.filter((x) => !x.pos || x.pos > 3);
    return h('div', {},
      h('div', { class: 'teens-podio' }, podio.length ? podio.map((x) => h('div', { class: 'card teens-puesto p' + x.pos }, h('div', { class: 'teens-pos' }, x.pos + 'º'), h('strong', {}, x.g.nombre), h('div', { class: 'teens-media' }, fmt(x.media)), h('div', { class: 'muted' }, `${x.n} alumnos con nota`))) : h('div', { class: 'muted' }, 'Todavía no hay notas en este nivel.')),
      resto.length ? tabla([{ t: 'Pos.', num: true, v: (x) => x.pos || '—' }, { t: 'Grupo', v: (x) => h('strong', {}, x.g.nombre) }, { t: 'Alumnos', num: true, v: (x) => x.alumnos }, { t: 'Media', num: true, v: (x) => fmt(x.media) }], resto, { ordenable: false }) : null,
      h('h3', { class: 'sub-titulo' }, 'Clasificación individual'),
      tabla([{ t: 'Pos.', num: true, v: (x) => x.pos || '—' }, { t: 'Alumno', v: (x) => h('strong', {}, x.a.nombre) }, { t: 'Grupo', v: (x) => x.grupo.nombre },
        { t: 'Tests', num: true, v: (x) => `${x.n}/${PRUEBAS.length}` }, { t: 'Media', num: true, v: (x) => fmt(x.media) }], r.ranking, { ordenable: false, vacio: 'No hay alumnos activos en este nivel.' }));
  }

  // ---------- Alumnos y grupos ----------
  function vAlumnos() {
    const gs = D.grupos.filter((g) => g.nivel === nivel).sort(porNombre), idG = new Set(gs.map((g) => g.id));
    const als = D.alumnos.filter((a) => idG.has(a.grupo_id)).sort(porNombre);
    const nG = txt('', { placeholder: 'Nombre del grupo nuevo', 'aria-label': 'Nombre del grupo' });
    const nA = txt('', { placeholder: 'Nombre del alumno', 'aria-label': 'Nombre del alumno' });
    const gA = sel(gs.map((g) => [g.id, g.nombre]), gs[0]?.id || '', { 'aria-label': 'Grupo' });
    const opciones = D.grupos.slice().sort((a, b) => a.nivel.localeCompare(b.nivel) || porNombre(a, b)).map((g) => [g.id, `${g.nivel} · ${g.nombre}`]);
    return h('div', {},
      editor ? h('div', { class: 'al-barra' }, nG, h('button', { class: 'btn small', type: 'button', onclick: () => guardar(async () => {
        const n = nG.value.trim(); if (!n) { toast('Escribe el nombre del grupo.', 'error'); return; }
        if (gs.some((g) => normalizar(g.nombre) === normalizar(n))) { toast('Ya hay un grupo con ese nombre en este nivel.', 'error'); return; }
        D.grupos.push(await api.insAc('al_teens_grupos', { nombre: n, nivel })); toast('Grupo creado'); pintar();
      }) }, '+ Grupo')) : null,
      tabla([{ t: 'Grupo', v: (g) => h('strong', {}, g.nombre), s: (g) => g.nombre }, { t: 'Alumnos', num: true, v: (g) => D.alumnos.filter((a) => a.grupo_id === g.id).length },
        { t: '', v: (g) => (editor ? h('button', { class: 'btn danger small', type: 'button', onclick: () => guardar(async () => {
          if (D.alumnos.some((a) => a.grupo_id === g.id)) { toast('El grupo tiene alumnos: muévelos o elimínalos antes.', 'error'); return; }
          if (!await confirmar({ titulo: 'Eliminar grupo', texto: `Se eliminará el grupo ${g.nombre}.`, ok: 'Eliminar', peligro: true })) return;
          await api.delAc('al_teens_grupos', g.id); D.grupos = D.grupos.filter((x) => x.id !== g.id); toast('Grupo eliminado'); pintar();
        }) }, 'Eliminar') : '') }], gs, { ordenable: false, vacio: 'Este nivel no tiene grupos todavía.' }),
      h('h3', { class: 'sub-titulo' }, 'Alumnos'),
      editor && gs.length ? h('div', { class: 'al-barra' }, nA, gA, h('button', { class: 'btn small', type: 'button', onclick: () => guardar(async () => {
        const n = nA.value.trim(); if (!n || !gA.value) { toast('Escribe el nombre y elige grupo.', 'error'); return; }
        D.alumnos.push(await api.insAc('al_teens_alumnos', { nombre: n, grupo_id: gA.value, activo: true })); toast('Alumno añadido'); pintar();
      }) }, '+ Alumno')) : null,
      tabla([{ t: 'Alumno', v: (a) => h('strong', {}, a.nombre), s: (a) => a.nombre },
        { t: 'Grupo', v: (a) => sel(opciones, a.grupo_id, { disabled: !editor, 'aria-label': 'Grupo de ' + a.nombre, onchange: (e) => guardar(async () => {
          const r = await api.updAc('al_teens_alumnos', a.id, { grupo_id: e.target.value }); a.grupo_id = r.grupo_id || e.target.value; pintar(); }) }) },
        { t: 'Activo', v: (a) => h('input', { type: 'checkbox', checked: a.activo, disabled: !editor, 'aria-label': 'Activo ' + a.nombre, onchange: (e) => guardar(async () => { await api.updAc('al_teens_alumnos', a.id, { activo: e.target.checked }); a.activo = e.target.checked; }) }) },
        { t: '', v: (a) => (editor ? h('button', { class: 'btn danger small', type: 'button', onclick: () => guardar(async () => {
          if (!await confirmar({ titulo: 'Eliminar alumno', texto: `Se eliminará a ${a.nombre} y todas sus notas. Si solo quieres sacarlo de la clasificación, desmarca «Activo».`, ok: 'Eliminar', peligro: true })) return;
          await api.delAc('al_teens_alumnos', a.id); D.alumnos = D.alumnos.filter((x) => x.id !== a.id); D.notas = D.notas.filter((n) => n.teen_id !== a.id); toast('Alumno eliminado'); pintar();
        }) }, 'Eliminar') : '') }], als, { ordenable: false, vacio: 'Este nivel no tiene alumnos todavía.' }));
  }

  // ---------- Notas (tabla editable; se guarda al cambiar cada casilla) ----------
  function vNotas(c) {
    const gs = D.grupos.filter((g) => g.nivel === nivel).sort(porNombre);
    if (!gs.some((g) => g.id === grupoNotas)) grupoNotas = gs[0]?.id || '';
    const als = D.alumnos.filter((a) => a.grupo_id === grupoNotas).sort(porNombre);
    const selG = sel(gs.map((g) => [g.id, g.nombre]), grupoNotas, { 'aria-label': 'Grupo', onchange: (e) => { grupoNotas = e.target.value; pintar(); } });
    const pn = () => notasPorAlumno(D.notas);
    const celdaMedia = (a) => h('td', { class: 'num' }, h('strong', {}, fmt(mediaAlumno(pn().get(a.id) || {}, c).media)));
    const filas = als.map((a) => {
      const tdMedia = celdaMedia(a);
      const val = (k) => pn().get(a.id)?.[k];
      const celdas = PRUEBAS.map(([k, t]) => {
        const inp = h('input', { type: 'text', inputmode: 'decimal', class: 'teens-nota', value: val(k) ?? '', disabled: !editor, 'aria-label': `${t} de ${a.nombre}`, onchange: () => {
          const txtv = inp.value.trim().replace(',', '.'), v = txtv === '' ? null : Number(txtv);
          if (v !== null && (!Number.isFinite(v) || v < 0)) { toast('Escribe un número (0 o más).', 'error'); inp.value = val(k) ?? ''; return; }
          encolar(async () => {
            const ex = D.notas.find((n) => n.teen_id === a.id && n.prueba === k);
            if (v === null) { if (ex) { await api.delAc('al_teens_notas', ex.id); D.notas = D.notas.filter((n) => n !== ex); } }
            else if (ex) { await api.updAc('al_teens_notas', ex.id, { valor: v }); ex.valor = v; }
            else D.notas.push(await api.insAc('al_teens_notas', { teen_id: a.id, prueba: k, valor: v }));
            tdMedia.replaceChildren(...celdaMedia(a).childNodes); // media recalculada al momento
          });
        } });
        return h('td', {}, inp);
      });
      return h('tr', {}, h('td', {}, h('strong', {}, a.nombre), a.activo ? '' : h('span', { class: 'muted' }, ' (inactivo)')), ...celdas, tdMedia);
    });
    return h('div', {}, h('div', { class: 'al-barra' }, selG, h('span', { class: 'muted' }, 'Escribe la nota tal cual la corriges (p. ej. 13 en un test de 16): se pasa sola a base 10 según la Configuración.')),
      als.length ? h('div', { class: 'teens-scroll' }, h('table', { class: 'tbl teens-tabla' }, h('thead', {}, h('tr', {}, h('th', {}, 'Alumno'), ...PRUEBAS.map(([, t]) => h('th', { class: 'num' }, t)), h('th', { class: 'num' }, 'Media'))), h('tbody', {}, filas)))
        : h('div', { class: 'muted' }, gs.length ? 'Este grupo no tiene alumnos.' : 'Crea primero un grupo en «Alumnos y grupos».'));
  }

  // ---------- Configuración ----------
  function vConfig(c) {
    const campos = {};
    const num = (k) => (campos[k] = h('input', { type: 'text', inputmode: 'decimal', class: 'teens-nota', value: c[k], disabled: !editor, 'aria-label': k }));
    return h('div', { class: 'card' },
      h('h3', { class: 'sub-titulo' }, 'Peso de cada tipo de prueba en la media'),
      h('div', { class: 'al-barra' }, h('label', {}, 'Test de unidad ×', num('peso_unidad')), h('label', {}, 'Examen medio ×', num('peso_mid')), h('label', {}, 'Examen final ×', num('peso_final'))),
      h('h3', { class: 'sub-titulo' }, 'Total de preguntas / puntos de cada prueba'),
      h('div', { class: 'al-barra' }, PRUEBAS.map(([k, t]) => h('label', {}, t + ' ', num('total_' + k)))),
      h('p', { class: 'muted' }, 'Los cambios afectan también a las notas ya introducidas: fija el total de una prueba antes de corregirla.'),
      editor ? h('button', { class: 'btn primary', type: 'button', onclick: () => guardar(async () => {
        const nuevos = {};
        for (const k of Object.keys(CFG_DEF)) { const v = Number(String(campos[k].value).trim().replace(',', '.')); if (!Number.isFinite(v) || v <= 0) { toast('Todos los valores deben ser números mayores que 0.', 'error'); return; } nuevos[k] = v; }
        for (const [k, v] of Object.entries(nuevos)) {
          if (v === c[k]) continue;
          const ex = D.config.find((f) => f.clave === k);
          if (ex) { await api.updAc('al_teens_config', ex.id, { valor: v }); ex.valor = v; } else D.config.push(await api.insAc('al_teens_config', { clave: k, valor: v }));
        }
        toast('Configuración guardada'); pintar();
      }) }, 'Guardar configuración') : null);
  }

  pintar();
}
