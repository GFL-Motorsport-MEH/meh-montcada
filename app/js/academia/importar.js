// Importar del Excel «Control Alumnos»: alumnos (hoja DATABASE) y bajas (hoja BAJAS).
// El archivo se lee en el navegador y los datos van directos a la base de datos: no pasan por ningún otro sitio.
import { h, clear, toast, normalizar, fmtFecha } from '../ui.js';
import * as api from './api.js';
import { cabecera, tabla, pill, esVerdad, nombreAlumno, guardarBoton } from './kit.js';

const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
export function parseFecha(v) {
  if (!v && v !== 0) return null;
  if (v instanceof Date) { const d = new Date(v.getTime() + 12 * 3600e3); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
const claveResp = (apellidos, nombre, tel) => normalizar(`${apellidos}|${nombre}|${(tel || '').replace(/\D/g, '')}`);
const claveAl = (a) => `${normalizar(a.apellidos)}|${normalizar(a.nombre)}|${a.fecha_nacimiento || ''}`;
// alumnos ya creados a mano (sin nº) que coinciden por nombre y fecha de nacimiento con una fila del Excel: se enlazan en vez de duplicarse
function enlazarManuales(filas, alumnosBD) {
  const sinNum = new Map(alumnosBD.filter((a) => !a.num).map((a) => [claveAl(a), a]));
  const nums = new Set(alumnosBD.map((a) => a.num).filter(Boolean));
  return filas.map((f) => ({ f, manual: f.num && !nums.has(f.num) ? sinNum.get(claveAl(f)) || null : null }));
}
const claveNombre = (s) => normalizar(s).split(/\s+/).filter(Boolean).sort().join(' ');

async function leerLibro(file) {
  const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const hoja = (nombre) => { const n = wb.SheetNames.find((x) => normalizar(x.trim()) === normalizar(nombre)); return n ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) : null; };
  return { nombres: wb.SheetNames, hoja };
}

// ---- alumnos (DATABASE) ----
function leerAlumnos(filas) {
  if (!filas?.length) return { error: 'No se ha encontrado la hoja DATABASE.' };
  const cab = filas[0].map((c) => normalizar(texto(c)));
  const todos = (re) => cab.map((c, i) => (re.test(c) ? i : -1)).filter((i) => i >= 0);
  const col = {
    entrada: cab.findIndex((c) => /fecha entrada/.test(c)), inscrito: cab.findIndex((c) => c === 'inscrito'), num: todos(/^id$/)[0], ape: cab.findIndex((c) => /alumnos? apellidos/.test(c)),
    nombre: todos(/^nombre$/)[0], nac: cab.findIndex((c) => /fecha nac/.test(c)), rApe: cab.findIndex((c) => /responsable apellidos/.test(c)), rNom: todos(/^nombre$/)[1], dni: cab.findIndex((c) => c === 'dni'),
    mail: cab.findIndex((c) => /^mail|email|correo/.test(c)), tel: cab.findIndex((c) => /^telefono|^tel/.test(c)), intol: cab.findIndex((c) => /intoler/.test(c)), colegio: cab.findIndex((c) => c === 'colegio'),
    iban: cab.findIndex((c) => c === 'iban'), modalidad: cab.findIndex((c) => c === 'modalidad'), nivel: cab.findIndex((c) => c === 'nivel'), pago: cab.findIndex((c) => /metodo pago/.test(c)),
    conocio: cab.findIndex((c) => /como nos conocio/.test(c)), info: cab.findIndex((c) => c === 'informacion'), rrss: cab.findIndex((c) => c === 'rrss'), cp: cab.findIndex((c) => /codigo postal/.test(c)),
  };
  if (col.ape < 0 || col.nombre === undefined) return { error: 'La hoja DATABASE no tiene las columnas «Alumnos Apellidos» y «Nombre».' };
  const g = (f, k) => (col[k] >= 0 && col[k] !== undefined ? f[col[k]] : null);
  const out = [];
  for (const f of filas.slice(1)) {
    const ape = texto(g(f, 'ape')); const nom = texto(g(f, 'nombre'));
    if (!ape && !nom) continue;
    const num = Number(g(f, 'num')); const ins = g(f, 'inscrito');
    out.push({
      num: Number.isInteger(num) && num > 0 ? num : null, apellidos: ape, nombre: nom, fecha_nacimiento: parseFecha(g(f, 'nac')), fecha_entrada: parseFecha(g(f, 'entrada')),
      estado: esVerdad(ins) ? 'inscrito' : 'antiguo', colegio: texto(g(f, 'colegio')) || null, modalidad: texto(g(f, 'modalidad')) || null, nivel: texto(g(f, 'nivel')) || null,
      metodo_pago: texto(g(f, 'pago')) || null, como_nos_conocio: texto(g(f, 'conocio')) || null, info: texto(g(f, 'info')) || null, intolerancias: texto(g(f, 'intol')) || null,
      autoriza_rrss: esVerdad(g(f, 'rrss')), codigo_postal: texto(g(f, 'cp')) || null,
      _resp: { apellidos: texto(g(f, 'rApe')), nombre: texto(g(f, 'rNom')), email: texto(g(f, 'mail')) || null, telefono: texto(g(f, 'tel')) || null, dni: texto(g(f, 'dni')) || null, iban: texto(g(f, 'iban')).replace(/\s+/g, '').toUpperCase() || null },
    });
  }
  return { filas: out };
}

async function importarAlumnos(filas, avance) {
  const existentes = await api.responsables();
  const idPor = new Map(existentes.map((r) => [claveResp(r.apellidos, r.nombre, r.telefono), r.id]));
  // mismo nombre y teléfono; o, si el que ya existía no tenía teléfono (creado a mano), mismo nombre
  const idDe = (r) => idPor.get(claveResp(r.apellidos, r.nombre, r.telefono)) || idPor.get(claveResp(r.apellidos, r.nombre, ''));
  const nuevos = new Map();
  for (const f of filas) {
    const r = f._resp; if (!r.apellidos && !r.nombre) continue;
    const k = claveResp(r.apellidos, r.nombre, r.telefono);
    if (!idDe(r) && !nuevos.has(k)) nuevos.set(k, { apellidos: r.apellidos, nombre: r.nombre, email: r.email, telefono: r.telefono });
  }
  avance(`Creando ${nuevos.size} responsables…`);
  const creados = await api.insMany('ac_responsables', [...nuevos.values()], { lote: 200 });
  for (const r of creados) idPor.set(claveResp(r.apellidos, r.nombre, r.telefono), r.id);
  // DNI / IBAN (solo de los responsables con datos)
  const privados = new Map();
  for (const f of filas) { const r = f._resp; const id = idDe(r); if (id && (r.dni || r.iban) && !privados.has(id)) privados.set(id, { responsable_id: id, dni: r.dni, iban: r.iban }); }
  avance(`Guardando datos bancarios de ${privados.size} responsables…`);
  await api.insMany('ac_responsables_priv', [...privados.values()], { onConflict: 'responsable_id' });
  avance(`Guardando ${filas.length} alumnos…`);
  const { enlazados } = { enlazados: enlazarManuales(filas, await api.alumnos()).filter((x) => x.manual) };
  const usadas = new Set(enlazados.map((x) => x.f));
  for (const { f, manual } of enlazados) { const { _resp, ...a } = f; await api.upd('ac_alumnos', manual.id, { ...a, responsable_id: idDe(_resp) || manual.responsable_id || null }); }
  filas = filas.filter((f) => !usadas.has(f));
  const conNum = filas.filter((f) => f.num).map(({ _resp, ...a }) => ({ ...a, responsable_id: idDe(_resp) || null }));
  const sinNum = filas.filter((f) => !f.num).map(({ _resp, ...a }) => ({ ...a, responsable_id: idDe(_resp) || null }));
  await api.insMany('ac_alumnos', conNum, { lote: 200, onConflict: 'num' });
  if (sinNum.length) await api.insMany('ac_alumnos', sinNum, { lote: 200 });
  return { responsables: nuevos.size, alumnos: filas.length };
}

// ---- bajas (BAJAS) ----
function leerBajas(filas, alumnos) {
  if (!filas?.length) return { error: 'No se ha encontrado la hoja BAJAS.' };
  const cab = filas[0].map((c) => normalizar(texto(c)));
  const ix = (re) => cab.findIndex((c) => re.test(c));
  const col = { id: ix(/control bajas id|^id$/), nom: ix(/nombre/), alta: ix(/fecha alta/), baja: ix(/fecha baja/), motivo: ix(/motivo baja/), com: ix(/comentario/) };
  if (col.nom < 0 || col.baja < 0) return { error: 'La hoja BAJAS no tiene las columnas «Nombre» y «Fecha baja».' };
  const porNum = new Map(alumnos.filter((a) => a.num).map((a) => [a.num, a])); const porNombre = new Map();
  for (const a of alumnos) { const k = claveNombre(`${a.nombre} ${a.apellidos}`); porNombre.set(k, porNombre.has(k) ? null : a); }
  const ok = []; const sin = [];
  for (const f of filas.slice(1)) {
    const nom = texto(f[col.nom]); if (!nom) continue;
    const a = porNum.get(Number(f[col.id])) || porNombre.get(claveNombre(nom)) || null;
    const fila = { nombre: nom, alta: parseFecha(f[col.alta]), baja: parseFecha(f[col.baja]), motivo: col.motivo >= 0 ? texto(f[col.motivo]) || null : null, comentarios: col.com >= 0 ? texto(f[col.com]) || null : null };
    if (a && fila.baja) ok.push({ a, ...fila }); else sin.push(fila);
  }
  return { ok, sin };
}

export async function renderImportar(view, ctx) {
  const editor = ctx.puedeEditar();
  const salida = h('div');
  const estado = h('div', { class: 'small muted' });
  let libro = null;
  const input = h('input', { type: 'file', accept: '.xlsx,.xls', disabled: !editor, 'aria-label': 'Archivo Excel' });
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    clear(salida, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Leyendo el Excel…'));
    try { libro = await leerLibro(file); } catch (ex) { clear(salida, h('div', { class: 'banner error' }, 'No se ha podido leer el archivo: ' + ex.message)); return; }
    await preparar();
  });

  async function preparar() {
    const alumnosBD = await api.alumnos();
    const A = leerAlumnos(libro.hoja('DATABASE'));
    const B = leerBajas(libro.hoja('BAJAS'), alumnosBD);
    const nums = new Set(alumnosBD.map((a) => a.num).filter(Boolean));
    const nuevos = A.filas ? enlazarManuales(A.filas, alumnosBD).filter((x) => (!x.f.num || !nums.has(x.f.num)) && !x.manual).length : 0;
    const caja = (titulo, cuerpo, boton) => h('div', { class: 'card' }, h('h3', { class: 'sub-titulo' }, titulo), cuerpo, boton);
    clear(salida,
      h('div', { class: 'small muted' }, `Hojas encontradas: ${libro.nombres.join(', ')}`),
      A.error ? h('div', { class: 'banner warn' }, A.error) : caja('Alumnos (hoja DATABASE)',
        h('div', {}, h('p', {}, `${A.filas.length} filas: `, h('strong', {}, `${nuevos} nuevos`), `, ${A.filas.length - nuevos} ya existentes (se actualizan por su nº o por nombre y fecha de nacimiento).`),
          h('p', { class: 'small muted' }, `${A.filas.filter((f) => f.estado === 'inscrito').length} marcados como inscritos y ${A.filas.filter((f) => f.estado === 'antiguo').length} como antiguos (columna INSCRITO). Los responsables repetidos se unen en uno solo.`),
          tabla([{ t: 'Nº', v: (f) => f.num ?? '' }, { t: 'Alumno', v: (f) => nombreAlumno(f) }, { t: 'Nacimiento', v: (f) => fmtFecha(f.fecha_nacimiento) }, { t: 'Estado', v: (f) => f.estado }], A.filas.slice(0, 5))),
        guardarBoton(`Importar ${A.filas.length} alumnos`, async () => {
          try { const r = await importarAlumnos(A.filas, (m) => { estado.textContent = m; }); estado.textContent = ''; toast(`Importados ${r.alumnos} alumnos y ${r.responsables} responsables nuevos.`); await preparar(); } catch (ex) { estado.textContent = ''; toast('Error al importar: ' + ex.message, 'error'); }
        })),
      B.error ? h('div', { class: 'banner warn' }, B.error + ' (se importa después de los alumnos).') : caja('Bajas (hoja BAJAS)',
        h('div', {}, h('p', {}, h('strong', {}, `${B.ok.length}`), ' bajas enlazadas con un alumno existente', B.sin.length ? [', ', h('strong', {}, `${B.sin.length}`), ' sin enlazar (importa antes los alumnos o revisa los nombres).'] : '.'),
          B.sin.length ? h('details', {}, h('summary', {}, 'Ver las que no se pueden enlazar'), h('ul', {}, B.sin.slice(0, 40).map((s) => h('li', {}, s.nombre)))) : null),
        B.ok.length ? guardarBoton(`Importar ${B.ok.length} bajas`, async () => {
          try {
            const previas = await api.bajas(); const claves = new Set(previas.map((b) => `${b.alumno_id}|${b.fecha_baja}`));
            const nuevas = B.ok.filter((b) => !claves.has(`${b.a.id}|${b.baja}`));
            await api.insMany('ac_bajas', nuevas.map((b) => ({ alumno_id: b.a.id, fecha_alta: b.alta, fecha_baja: b.baja, motivo: b.motivo, comentarios: b.comentarios })));
            const bajaAl = new Map(); for (const b of B.ok) if (!bajaAl.has(b.a.id) || b.baja > bajaAl.get(b.a.id)) bajaAl.set(b.a.id, b.baja);
            const { supabase } = await import('../db.js');
            for (const [id, f] of bajaAl) { const a = alumnosBD.find((x) => x.id === id); if (a.estado === 'inscrito' || a.estado === 'prematricula') continue; await supabase.from('ac_alumnos').update({ estado: 'baja', fecha_baja: f }).eq('id', id); }
            api.invalidar(); toast(`${nuevas.length} bajas importadas (${B.ok.length - nuevas.length} ya estaban).`);
          } catch (ex) { toast('Error al importar: ' + ex.message, 'error'); }
        }) : null));
  }

  clear(view, cabecera('Importar del Excel', 'Carga el Excel «Control Alumnos» una sola vez para llenar la base de datos', h('a', { class: 'btn small', href: '#/ac_alumnos' }, '← Volver a Alumnos')),
    h('div', { class: 'banner' }, h('strong', {}, 'Datos personales. '), 'El archivo se lee en tu navegador y se guarda directamente en la base de datos de la academia. Incluye DNI e IBAN de los responsables, que solo verán administración y gestión.'),
    editor ? null : h('div', { class: 'banner warn' }, 'Tu rol no permite importar.'),
    h('div', { class: 'card' }, h('p', { class: 'small' }, 'Elige el Excel «26/27 - Control Alumnos» (descárgalo de Drive: Archivo → Descargar → Microsoft Excel). Se leen las hojas DATABASE y BAJAS. Volver a importar no duplica alumnos: se actualizan por su número.'), input), estado, salida);
}
