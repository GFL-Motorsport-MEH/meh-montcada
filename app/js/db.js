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
export const GASTO_COLS = 'id,curso_id,mes,tipo,empresa,factura_nr,fecha_factura,pago,concepto,fecha_pago,cantidad,link_factura,categoria_id,subcategoria_id,categoria_texto,subcategoria_texto,periodicidad,metodo_pago,comentarios,nif,iban,swift,check_banca,fiscontal,sin_factura,centro_id,updated_at';

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

// ---------- facturación (import del CRM) ----------
export const FACT_COLS = 'id,centro,alumno,id_crm,fecha_pago,tipo_operacion,fecha_operacion,num_factura,num_recibo,metodo_pago,modalidad_pago,descripcion,qty,cantidad,iva,importe,total,mimag_comprobacion,fiscontal_comprobacion';
export async function getFacturacion() {
  return selectAll('facturacion', FACT_COLS, (q) => q.order('fecha_pago', { ascending: false }).order('id', { ascending: true }));
}
export async function actualizarFacturacion(id, cambios) {
  return check(await supabase.from('facturacion').update(cambios).eq('id', id).select(FACT_COLS).single());
}
// Inserta las líneas nuevas; las que ya existen (misma clave_linea) se ignoran en la BD.
export async function insertarFacturacion(lineas) {
  const out = [];
  for (let i = 0; i < lineas.length; i += 500) {
    out.push(...check(await supabase.from('facturacion').upsert(lineas.slice(i, i + 500), { onConflict: 'clave_linea', ignoreDuplicates: true }).select(FACT_COLS)));
  }
  return out;
}

// ---------- empresas / proveedores ----------
const EMP_COLS = 'id,nombre_comercial,razon_social,cif,iban,fecha_registro';
export async function getEmpresas() {
  return selectAll('empresas', EMP_COLS, (q) => q.order('nombre_comercial', { ascending: true }));
}
export async function crearEmpresa(datos) {
  return check(await supabase.from('empresas').insert(datos).select(EMP_COLS).single());
}
export async function actualizarEmpresa(id, cambios) {
  return check(await supabase.from('empresas').update(cambios).eq('id', id).select(EMP_COLS).single());
}
// Cambia el nombre de empresa en todos los gastos (todos los cursos). Devuelve cuántos se han cambiado.
export async function renombrarEmpresaEnGastos(anterior, nuevo) {
  const filas = check(await supabase.from('gastos').update({ empresa: nuevo }).eq('empresa', anterior).select('id'));
  return filas.length;
}

// ---------- listas editables ----------
export async function getListas() {
  return check(await supabase.from('listas').select('id,lista,valor,orden').order('orden', { ascending: true }));
}
export async function crearValorLista(lista, valor, orden) {
  return check(await supabase.from('listas').insert({ lista, valor, orden }).select('id,lista,valor,orden').single());
}
// Cambia el valor en la lista y en todos los gastos (función de la BD, solo admin). Devuelve nº de gastos cambiados.
export async function renombrarValorLista(lista, anterior, nuevo) {
  return check(await supabase.rpc('renombrar_valor_lista', { p_lista: lista, p_anterior: anterior, p_nuevo: nuevo }));
}
export async function crearCategoria(nombre, orden) {
  return check(await supabase.from('categorias').insert({ nombre, orden }).select('*').single());
}
export async function actualizarCategoria(id, cambios) {
  return check(await supabase.from('categorias').update(cambios).eq('id', id).select('*').single());
}
export async function crearSubcategoria(categoria_id, nombre, orden) {
  return check(await supabase.from('subcategorias').insert({ categoria_id, nombre, orden }).select('*').single());
}
export async function actualizarSubcategoria(id, cambios) {
  return check(await supabase.from('subcategorias').update(cambios).eq('id', id).select('*').single());
}

// ---------- centros ----------
export async function getCentros() {
  return check(await supabase.from('centros').select('id,nombre,principal,activo,orden').order('orden', { ascending: true }));
}
export async function crearCentro(nombre, orden) {
  return check(await supabase.from('centros').insert({ nombre, orden }).select('id,nombre,principal,activo,orden').single());
}
export async function actualizarCentro(id, cambios) {
  return check(await supabase.from('centros').update(cambios).eq('id', id).select('id,nombre,principal,activo,orden').single());
}
// Mueve varios gastos a otro centro. Devuelve los gastos actualizados.
export async function moverGastosACentro(ids, centroId) {
  const out = [];
  for (let i = 0; i < ids.length; i += 200) {
    out.push(...check(await supabase.from('gastos').update({ centro_id: centroId }).in('id', ids.slice(i, i + 200)).select(GASTO_COLS)));
  }
  return out;
}

// ---------- usuarios ----------
export async function getPerfiles() {
  return check(await supabase.from('profiles').select('*').order('created_at', { ascending: true }));
}
export async function actualizarPerfil(id, cambios) {
  return check(await supabase.from('profiles').update(cambios).eq('id', id).select('*').single());
}
