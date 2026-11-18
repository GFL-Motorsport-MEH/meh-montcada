// Acceso a datos del módulo Academia (tablas ac_*). Una pequeña caché de 60 s evita repetir consultas al cambiar de pestaña;
// cualquier escritura la vacía entera.
import { supabase, traducirError } from '../db.js';

const PAGE = 1000;
const chk = ({ data, error }) => { if (error) throw new Error(traducirError(error)); return data; };

async function all(tabla, cols = '*', build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(tabla).select(cols);
    if (build) q = build(q);
    const rows = chk(await q.order('id').range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const cache = new Map();
const TTL = 60000;
function memo(key, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.t < TTL) return c.p;
  const p = fn().catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { t: Date.now(), p });
  return p;
}
export const invalidar = () => cache.clear();

// ---------- lecturas ----------
export const listas = () => memo('listas', async () => {
  const o = {};
  for (const x of (await all('ac_listas')).sort((a, b) => a.orden - b.orden)) (o[x.lista] ||= []).push(x.valor);
  return o;
});
export const alumnos = () => memo('alumnos', () => all('ac_alumnos', '*, responsable:ac_responsables(id,apellidos,nombre,email,telefono)'));
export const profesoras = () => memo('profesoras', () => all('ac_profesoras').then((l) => l.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))));
export const aulas = () => memo('aulas', () => all('ac_aulas').then((l) => l.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))));
export const grupos = (curso) => memo('grupos' + curso, () => all('ac_grupos', '*, sesiones:ac_sesiones(*), miembros:ac_alumno_grupo(id,alumno_id,fecha_alta,fecha_baja)', (q) => q.eq('curso_id', curso)));
export const gruposDeAlumnos = (curso) => memo('ag' + curso, async () => {
  const gs = await grupos(curso);
  const m = new Map();
  for (const g of gs) for (const x of g.miembros) if (!x.fecha_baja) (m.get(x.alumno_id) || m.set(x.alumno_id, []).get(x.alumno_id)).push(g);
  return m;
});
export const calendarioDias = (curso) => memo('cal' + curso, () => all('ac_calendario_dias', '*', (q) => q.eq('curso_id', curso)));
export const inscripciones = (curso) => memo('ins' + curso, () => all('ac_inscripciones', '*', (q) => q.eq('curso_id', curso)));
export const cuotas = (curso) => memo('cuo' + curso, () => all('ac_cuotas', '*', (q) => q.eq('curso_id', curso)));
export const remesas = (curso) => memo('rem' + curso, () => all('ac_remesas', '*', (q) => q.eq('curso_id', curso)).then((l) => l.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))));
export const bajas = () => memo('bajas', () => all('ac_bajas', '*, alumno:ac_alumnos(id,num,apellidos,nombre,nivel,modalidad,estado)'));
export const contactos = () => memo('contactos', () => all('ac_contactos'));
export const tutorias = () => memo('tutorias', () => all('ac_tutorias', '*, alumno:ac_alumnos(id,apellidos,nombre), profesora:ac_profesoras(id,nombre)'));
export const anotaciones = (alumnoId) => memo('anot' + (alumnoId || ''), () => all('ac_anotaciones', '*, alumno:ac_alumnos(id,apellidos,nombre), profesora:ac_profesoras(id,nombre)', alumnoId ? (q) => q.eq('alumno_id', alumnoId) : undefined));
export const prestamos = () => memo('prestamos', () => all('ac_prestamos', '*, alumno:ac_alumnos(id,apellidos,nombre)'));
export const recogidas = (curso) => memo('rec' + curso, () => all('ac_recogidas', '*, alumno:ac_alumnos(id,apellidos,nombre,intolerancias,colegio)', (q) => q.eq('curso_id', curso)));
export const autorizados = () => memo('autorizados', () => all('ac_autorizados').then((l) => l.sort((a, b) => a.orden - b.orden)));
export const autorizadosPriv = (ids) => (ids?.length ? supabase.from('ac_autorizados_priv').select('*').in('autorizado_id', ids).then(chk) : Promise.resolve([]));
export const tareas = () => memo('tareas', () => all('ac_tareas'));
export const reuniones = () => memo('reuniones', () => all('ac_reuniones'));
export const temas = () => memo('temas', () => all('ac_reunion_temas'));
export const documentos = () => memo('documentos', () => all('ac_documentos'));
// compañeros de equipo (para asignar tareas): lo devuelve una función del servidor porque un usuario normal solo puede leer su propio perfil
export const usuarios = () => memo('usuarios', async () => chk(await supabase.rpc('equipo_tareas')));
// DNI / IBAN: solo los devuelve la base de datos a quien tiene el permiso de Pagos
export const privados = (ids) => (ids?.length ? supabase.from('ac_responsables_priv').select('*').in('responsable_id', ids).then(chk) : Promise.resolve([]));

// ---------- escrituras ----------
export async function ins(tabla, fila) { const r = chk(await supabase.from(tabla).insert(fila).select().single()); invalidar(); return r; }
export async function insMany(tabla, filas, { lote = 200, onConflict, ignorar = false } = {}) {
  const out = [];
  for (let i = 0; i < filas.length; i += lote) {
    const trozo = filas.slice(i, i + lote);
    const q = onConflict ? supabase.from(tabla).upsert(trozo, { onConflict, ignoreDuplicates: ignorar }) : supabase.from(tabla).insert(trozo);
    const r = chk(await q.select());
    out.push(...(r || []));
  }
  invalidar();
  return out;
}
export async function upd(tabla, id, parche) { const r = chk(await supabase.from(tabla).update(parche).eq('id', id).select().single()); invalidar(); return r; }
export async function del(tabla, id) { chk(await supabase.from(tabla).delete().eq('id', id)); invalidar(); }
export async function delMany(tabla, ids, lote = 100) { for (let i = 0; i < ids.length; i += lote) chk(await supabase.from(tabla).delete().in('id', ids.slice(i, i + lote))); invalidar(); }
export async function delWhere(tabla, col, valor) { chk(await supabase.from(tabla).delete().eq(col, valor)); invalidar(); }
export async function guardarPrivados(responsable_id, datos) {
  chk(await supabase.from('ac_responsables_priv').upsert({ responsable_id, ...datos }, { onConflict: 'responsable_id' }));
}
export async function generarCuotas(curso, mes) { const r = chk(await supabase.rpc('ac_generar_cuotas', { p_curso: curso, p_mes: mes })); invalidar(); return r; }
export async function updMany(tabla, ids, parche, lote = 100) {
  for (let i = 0; i < ids.length; i += lote) chk(await supabase.from(tabla).update(parche).in('id', ids.slice(i, i + lote)));
  invalidar();
}
export const responsables = () => memo('responsables', () => all('ac_responsables'));
