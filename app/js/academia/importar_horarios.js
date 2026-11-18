// Importa los grupos, horarios y listas de alumnos del Excel «26_27 HORARIO» (hojas KIDS, EXTRAESCOLARES, TEENS & ADULTS).
import { h, clear, cargando, toast, normalizar } from '../ui.js';
import * as api from './api.js';
import { cabecera, tabla, pill, guardarBoton, DIAS_CORTO, refrescar } from './kit.js';
import { parseHoja, modalidadDe } from './horarios_parse.js';

const HOJAS = ['KIDS', 'EXTRAESCOLARES', 'TEENS & ADULTS'];
const claveNombre = (s) => normalizar(s).split(/\s+/).filter(Boolean).sort().join(' ');
const bonito = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const nivelTxt = (n) => (/^\d$/.test(n) ? `Level ${n}` : n || null);

// dos grupos con el mismo nombre (p. ej. TEENS 5 con dos profesoras) se distinguen por nivel y, si hace falta, por profesora y hora
function nombresUnicos(grupos) {
  const cuenta = (l) => { const m = new Map(); l.forEach((g) => m.set(g.nombre.toLowerCase(), (m.get(g.nombre.toLowerCase()) || 0) + 1)); return m; };
  let m = cuenta(grupos);
  for (const g of grupos) if (m.get(g.nombre.toLowerCase()) > 1) g.nombre = `${g.nombre} · ${g.nivel || ''}`.replace(/ · $/, '');
  m = cuenta(grupos);
  for (const g of grupos) if (m.get(g.nombre.toLowerCase()) > 1) g.nombre = `${g.nombre} · ${g.profesora || g.sesiones[0]?.ini || ''}`.replace(/ · $/, '');
  return grupos;
}

export async function renderImportarHorarios(view, ctx) {
  const editor = ctx.puedeEditar(); const curso = ctx.cursoActual(); const salida = h('div');
  const input = h('input', { type: 'file', accept: '.xlsx,.xls', disabled: !editor, 'aria-label': 'Archivo Excel' });
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    clear(salida, cargando());
    try {
      const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      let grupos = []; const avisos = []; const hojas = [];
      for (const n of wb.SheetNames) {
        const nombre = HOJAS.find((x) => normalizar(x) === normalizar(n.trim())); if (!nombre) continue;
        const r = parseHoja(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }), nombre);
        grupos.push(...r.grupos); avisos.push(...r.aviso); hojas.push(n);
      }
      if (!grupos.length) { clear(salida, h('div', { class: 'banner error' }, `No he encontrado hojas con grupos (busco ${HOJAS.join(', ')}). Hojas del archivo: ${wb.SheetNames.join(', ')}.`)); return; }
      await previa(nombresUnicos(grupos), avisos, hojas);
    } catch (ex) { clear(salida, h('div', { class: 'banner error' }, 'No se ha podido leer el archivo: ' + ex.message)); }
  });

  async function previa(grupos, avisos, hojas) {
    const [alumnos, profes, existentes] = await Promise.all([api.alumnos(), api.profesoras(), api.grupos(curso.id)]);
    const porNombre = new Map();
    for (const a of alumnos) { const k = claveNombre(`${a.nombre} ${a.apellidos}`); porNombre.set(k, porNombre.has(k) ? null : a); }
    const buscar = (n) => porNombre.get(claveNombre(n)) || null;
    const sin = new Set(); let total = 0;
    for (const g of grupos) { g._al = []; for (const n of g.alumnos) { total++; const a = buscar(n); if (a) g._al.push(a); else sin.add(n); } }
    const yaEstan = new Set(existentes.map((g) => g.nombre.toLowerCase()));
    const nuevasProfes = [...new Set(grupos.map((g) => g.profesora).filter(Boolean))].filter((n) => !profes.some((p) => normalizar(p.nombre) === normalizar(n)));
    clear(salida,
      h('div', { class: 'card' },
        h('p', {}, h('strong', {}, `${grupos.length} grupos`), ` (hojas ${hojas.join(', ')}); ${grupos.filter((g) => yaEstan.has(g.nombre.toLowerCase())).length} ya existen en ${curso.nombre} y solo se completan. `, h('strong', {}, `${total - sin.size > 0 ? total - sin.size : 0} de ${total}`), ' alumnos enlazados por nombre.'),
        nuevasProfes.length ? h('p', { class: 'small' }, 'Se crearán las profesoras: ', nuevasProfes.map(bonito).join(', '), '. «MAR», «TEACHER» o vacío sin nombre completo: revísalas después en Profesoras y aulas.') : null,
        avisos.length ? h('div', { class: 'banner warn' }, [...new Set(avisos)].join(' · ')) : null,
        tabla([
          { t: 'Grupo', v: (g) => h('strong', {}, g.nombre) }, { t: 'Modalidad · nivel', v: (g) => [modalidadDe(g), nivelTxt(g.nivel)].filter(Boolean).join(' · ') },
          { t: 'Profesora', v: (g) => bonito(g.profesora || '') }, { t: 'Horario', v: (g) => g.sesiones.map((s) => `${DIAS_CORTO[s.dia]} ${s.ini}–${s.fin}`).join(', ') },
          { t: 'Alumnos', num: true, v: (g) => `${g._al.length}/${g.alumnos.length}` }, { t: '', v: (g) => (yaEstan.has(g.nombre.toLowerCase()) ? pill('existe') : pill('nuevo', 'ok')) },
        ], grupos),
        sin.size ? h('details', {}, h('summary', {}, `${sin.size} nombres sin alumno en la base de datos (se ignoran; importa antes los alumnos o corrige el nombre)`), h('p', { class: 'small' }, [...sin].slice(0, 80).join(' · '))) : null,
        editor ? guardarBoton(`Crear ${grupos.length} grupos`, () => crear(grupos)) : null));
  }

  async function crear(grupos) {
    try {
      const profes = await api.profesoras(); const pid = new Map(profes.map((p) => [normalizar(p.nombre), p.id]));
      const nuevas = [...new Set(grupos.map((g) => g.profesora).filter(Boolean))].filter((n) => !pid.has(normalizar(n)));
      if (nuevas.length) for (const p of await api.insMany('ac_profesoras', nuevas.map((n, i) => ({ nombre: bonito(n), orden: profes.length + i })))) pid.set(normalizar(p.nombre), p.id);
      const existentes = await api.grupos(curso.id); const gPor = new Map(existentes.map((g) => [g.nombre.toLowerCase(), g]));
      const aNuevos = grupos.filter((g) => !gPor.has(g.nombre.toLowerCase()));
      const creados = await api.insMany('ac_grupos', aNuevos.map((g) => ({ curso_id: curso.id, nombre: g.nombre, modalidad: modalidadDe(g), nivel: nivelTxt(g.nivel), profesora_id: pid.get(normalizar(g.profesora)) || null, anios_nacimiento: g.anios || null })));
      for (const c of creados) gPor.set(c.nombre.toLowerCase(), { ...c, sesiones: [] });
      const sesiones = []; const miembros = new Map();
      for (const g of grupos) {
        const bd = gPor.get(g.nombre.toLowerCase()); if (!bd) continue;
        for (const s of g.sesiones) if (!(bd.sesiones || []).some((x) => x.dia === s.dia && String(x.hora_inicio).slice(0, 5) === s.ini)) sesiones.push({ grupo_id: bd.id, dia: s.dia, hora_inicio: s.ini, hora_fin: s.fin });
        for (const a of g._al) miembros.set(`${a.id}|${bd.id}`, { alumno_id: a.id, grupo_id: bd.id });
      }
      await api.insMany('ac_sesiones', sesiones);
      await api.insMany('ac_alumno_grupo', [...miembros.values()], { onConflict: 'alumno_id,grupo_id', ignorar: true });
      toast(`${creados.length} grupos nuevos, ${sesiones.length} sesiones y ${miembros.size} alumnos asignados.`);
      api.invalidar(); location.hash = '#/ac_grupos'; refrescar();
    } catch (ex) { toast('Error al importar: ' + ex.message, 'error'); }
  }

  clear(view, cabecera('Importar grupos y horarios', `Carga el Excel «26_27 HORARIO» en ${curso.nombre}`, h('a', { class: 'btn small', href: '#/ac_grupos' }, '← Volver a Grupos')),
    h('div', { class: 'banner' }, h('strong', {}, 'Importa antes los alumnos. '), 'Se leen las hojas KIDS, EXTRAESCOLARES y TEENS & ADULTS. Crea las profesoras que falten, los grupos, sus sesiones semanales y la lista de alumnos. Reimportar no duplica.'),
    editor ? null : h('div', { class: 'banner warn' }, 'Tu rol no permite importar.'),
    h('div', { class: 'card' }, input), salida);
}
