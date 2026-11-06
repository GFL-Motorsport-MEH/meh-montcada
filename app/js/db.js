// Acceso a datos (Supabase). Todo lo que toca la base de datos pasa por aquí.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const PAGE = 1000; // límite de filas por petición en Supabase

function check({ data, error }) {
  if (error) throw new Error(traducirError(error));
  return data;
}

export function traducirError(error) {
  const msg = (error && (error.message || error.error_description)) || String(error);
  if (/Invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
  if (/Email not confirmed/i.test(msg)) return 'Falta confirmar el email. Revisa tu correo.';
  if (/row-level security|permission denied/i.test(msg)) return 'No tienes permiso para hacer esto.';
  if (/Password should be at least/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/rate limit|too many/i.test(msg)) return 'Demasiados intentos. Espera un momento y vuelve a probar.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'No hay conexión con el servidor. Revisa tu internet.';
  return msg;
}

async function selectAll(table, columns, build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(columns);
    if (build) q = build(q);
    const rows = check(await q.range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// ---------- sesión ----------
export async function getSession() {
  return check(await supabase.auth.getSession()).session;
}
export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((event, session) => cb(event, session));
}
export async function login(email, password) {
  check(await supabase.auth.signInWithPassword({ email, password }));
}
export async function logout() {
  await supabase.auth.signOut();
}
export async function pedirResetPassword(email) {
  check(await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/' }));
}
export async function cambiarPassword(password) {
  check(await supabase.auth.updateUser({ password }));
}

// ---------- maestros ----------
export async function getPerfil(userId) {
  return check(await supabase.from('profiles').select('*').eq('id', userId).maybeSingle());
}
export async function getCursos() {
  return check(await supabase.from('cursos').select('*').order('fecha_inicio', { ascending: true }));
}
export async function getTaxonomia() {
  const cats = check(await supabase.from('categorias').select('*').order('orden', { ascending: true }));
  const subs = check(await supabase.from('subcategorias').select('*').order('orden', { ascending: true }));
  return cats.map((c) => ({ ...c, subcategorias: subs.filter((s) => s.categoria_id === c.id) }));
}

// ---------- gastos ----------
export const GASTO_COLS = 'id,curso_id,mes,tipo,empresa,factura_nr,fecha_factura,pago,concepto,fecha_pago,cantidad,link_factura,categoria_id,subcategoria_id,categoria_texto,subcategoria_texto,periodicidad,metodo_pago,comentarios,nif,iban,swift,check_banca,fiscontal,sin_factura,updated_at';

export async function getGastos(cursoId) {
  return selectAll('gastos', GASTO_COLS, (q) => q.eq('curso_id', cursoId).order('fecha_factura', { ascending: false }).order('id', { ascending: true }));
}
export async function getSugerenciasGastos() {
  return selectAll('gastos', 'tipo,empresa,periodicidad,metodo_pago', (q) => q.order('id', { ascending: true }));
}
export async function crearGasto(gasto) {
  return check(await supabase.from('gastos').insert(gasto).select(GASTO_COLS).single());
}
export async function actualizarGasto(id, cambios) {
  return check(await supabase.from('gastos').update(cambios).eq('id', id).select(GASTO_COLS).single());
}
export async function borrarGasto(id) {
  const { error, count } = await supabase.from('gastos').delete({ count: 'exact' }).eq('id', id);
  if (error) throw new Error(traducirError(error));
  if (count === 0) throw new Error('No tienes permiso para borrar gastos (solo administradores).');
}

// ---------- ingresos ----------
const INGRESO_COLS = 'id,curso_id,trimestre,mes,grupo,level,tipo,cantidad';
export async function getIngresos(cursoId) {
  return selectAll('ingresos', INGRESO_COLS, (q) => q.eq('curso_id', cursoId).order('id', { ascending: true }));
}

export async function crearIngreso(datos) {
  return check(await supabase.from('ingresos').insert(datos).select(INGRESO_COLS).single());
}
export async function actualizarIngreso(id, cambios) {
  return check(await supabase.from('ingresos').update(cambios).eq('id', id).select(INGRESO_COLS).single());
}

// ---------- resumen de ingresos (modalidad de pago y alumnos por mes) ----------
const MET_COLS = 'id,curso_id,mes,metodo,importe';
const ALU_COLS = 'id,curso_id,mes,grupo,alumnos';
export async function getIngresosMetodo(cursoId) {
  return selectAll('ingresos_metodo', MET_COLS, (q) => q.eq('curso_id', cursoId).order('id', { ascending: true }));
}
export async function crearIngresoMetodo(datos) {
  return check(await supabase.from('ingresos_metodo').insert(datos).select(MET_COLS).single());
}
export async function actualizarIngresoMetodo(id, cambios) {
  return check(await supabase.from('ingresos_metodo').update(cambios).eq('id', id).select(MET_COLS).single());
}
export async function getAlumnosMes(cursoId) {
  return selectAll('alumnos_mes', ALU_COLS, (q) => q.eq('curso_id', cursoId).order('id', { ascending: true }));
}
export async function crearAlumnosMes(datos) {
  return check(await supabase.from('alumnos_mes').insert(datos).select(ALU_COLS).single());
}
export async function actualizarAlumnosMes(id, cambios) {
  return check(await supabase.from('alumnos_mes').update(cambios).eq('id', id).select(ALU_COLS).single());
}

// ---------- usuarios ----------
export async function getPerfiles() {
  return check(await supabase.from('profiles').select('*').order('created_at', { ascending: true }));
}
export async function actualizarPerfil(id, cambios) {
  return check(await supabase.from('profiles').update(cambios).eq('id', id).select('*').single());
}
