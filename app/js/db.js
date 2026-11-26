// Acceso a datos (Supabase). Todo lo que toca la base de datos pasa por aquí.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { registrar, agrupar } from './deshacer.js';
export { agrupar };
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
  // primera página con el total de filas; el resto de páginas se piden a la vez (antes, una tras otra)
  const pagina = (from, opts) => { let q = supabase.from(table).select(columns, opts); if (build) q = build(q); return q.range(from, from + PAGE - 1); };
  const r0 = await pagina(0, { count: 'exact' });
  const out = check(r0);
  const total = r0.count;
  if (out.length < PAGE) return out;
  if (!Number.isFinite(total)) { // sin total disponible: páginas una tras otra, como antes
    for (let from = PAGE; ; from += PAGE) { const rows = check(await pagina(from)); out.push(...rows); if (rows.length < PAGE) break; }
    return out;
  }
  if (total <= PAGE) return out;
  const resto = await Promise.all(Array.from({ length: Math.ceil((total - PAGE) / PAGE) }, (_, k) => pagina(PAGE * (k + 1)).then(check)));
  for (const rows of resto) out.push(...rows);
  return out;
}

// ---------- preferencias de interfaz (orden de pestañas por usuario) ----------
export async function getPrefsTabs() {
  const { data, error } = await supabase.from('ui_preferencias').select('tabs').maybeSingle();
  if (error) return null;
  return (data && data.tabs) || {};
}
export async function setPrefsTabs(tabs) {
  const { data: u } = await supabase.auth.getUser();
  const id = u && u.user && u.user.id; if (!id) return;
  const { error } = await supabase.from('ui_preferencias').upsert({ user_id: id, tabs, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(traducirError(error));
}

// ajustes personales (colores de pestañas, pantalla de inicio, datos en segundo plano)
export async function getAjustes() {
  const { data, error } = await supabase.from('ui_preferencias').select('ajustes').maybeSingle();
  if (error) return null;
  return (data && data.ajustes) || {};
}
export async function setAjustes(ajustes) {
  const { data: u } = await supabase.auth.getUser();
  const id = u && u.user && u.user.id; if (!id) return;
  const { error } = await supabase.from('ui_preferencias').upsert({ user_id: id, ajustes, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(traducirError(error));
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
// roles y permisos (tablas roles / rol_permisos). Si todavía no existen, se devuelven vacíos y solo el administrador tiene acceso.
export async function getRoles() {
  const r = await supabase.from('roles').select('*').order('orden');
  return r.error ? [] : r.data;
}
export async function getPermisosRoles() {
  const r = await supabase.from('rol_permisos').select('*');
  return r.error ? [] : r.data;
}
// guarda de golpe los cambios de la matriz: [{rol, permiso, valor}] (valor '' = quitar el permiso)
export async function guardarPermisos(cambios) {
  const quitar = cambios.filter((c) => !c.valor);
  const poner = cambios.filter((c) => c.valor).map((c) => { const [alcance, e] = c.valor.split(':'); return { rol: c.rol, permiso: c.permiso, alcance, editar: e === '1' }; });
  for (const q of quitar) check(await supabase.from('rol_permisos').delete().eq('rol', q.rol).eq('permiso', q.permiso));
  if (poner.length) check(await supabase.from('rol_permisos').upsert(poner, { onConflict: 'rol,permiso' }));
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
export const GASTO_COLS = 'id,curso_id,mes,tipo,empresa,factura_nr,fecha_factura,pago,concepto,fecha_pago,cantidad,link_factura,categoria_id,subcategoria_id,categoria_texto,subcategoria_texto,periodicidad,metodo_pago,comentarios,nif,iban,swift,check_banca,fiscontal,fiscontal_fecha,sin_factura,centro_id,division_id,revisado,revisado_at,created_by,resaltado,created_at,updated_at';

export async function getGastos(cursoId) {
  return selectAll('gastos', GASTO_COLS, (q) => q.eq('curso_id', cursoId).order('fecha_factura', { ascending: false }).order('id', { ascending: true }));
}
// solo los gastos sin enlace a factura y sin marcar «sin factura» (Control → Facturas pendientes), de varios cursos a la vez
export async function getGastosSinFactura(cursoId) {
  return selectAll('gastos', GASTO_COLS, (q) => q.eq('curso_id', cursoId).or('link_factura.is.null,link_factura.eq.').or('sin_factura.is.null,sin_factura.eq.false').neq('cantidad', 0).order('fecha_factura', { ascending: false }).order('id', { ascending: true }));
}
export async function getSugerenciasGastos() {
  return selectAll('gastos', 'tipo,empresa,periodicidad,metodo_pago', (q) => q.order('id', { ascending: true }));
}
const nombreGasto = (g) => [g?.empresa, g?.concepto].filter(Boolean).join(' · ') || 'gasto';
// valores anteriores de los campos que se van a cambiar (solo los que cambian de verdad)
function antesDe(prev, cambios) {
  const igual = (a, b) => (a ?? null) === (b ?? null) || (typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) : false);
  const out = {};
  for (const k of Object.keys(cambios)) if (!igual(prev?.[k], cambios[k])) out[k] = prev?.[k] ?? null;
  return out;
}
const DESCRIPCION_CAMPO = { cantidad: 'importe', fecha_factura: 'fecha de factura', fecha_pago: 'fecha de pago', mes: 'mes contable', check_banca: 'banco', fiscontal: 'gestoría', pago: 'pagado', categoria_id: 'categoría', subcategoria_id: 'subcategoría', metodo_pago: 'método', centro_id: 'centro', comentarios: 'comentario', factura_nr: 'nº factura', revisado: 'revisado' };

export async function crearGasto(gasto) {
  const nuevo = check(await supabase.from('gastos').insert(gasto).select(GASTO_COLS).single());
  registrar(`Alta: ${nombreGasto(nuevo)}`, () => borrarGastos([nuevo.id]));
  return nuevo;
}
export async function crearGastos(lista) {
  if (!lista.length) return [];
  const nuevos = check(await supabase.from('gastos').insert(lista).select(GASTO_COLS));
  registrar(nuevos.length === 1 ? `Alta: ${nombreGasto(nuevos[0])}` : `Alta de ${nuevos.length} gastos`, () => borrarGastos(nuevos.map((g) => g.id)));
  return nuevos;
}
export async function actualizarGasto(id, cambios) {
  const prev = check(await supabase.from('gastos').select(GASTO_COLS).eq('id', id).maybeSingle());
  const nuevo = check(await supabase.from('gastos').update(cambios).eq('id', id).select(GASTO_COLS).single());
  const antes = antesDe(prev, cambios);
  delete antes.fiscontal_fecha; delete antes.categoria_texto; delete antes.subcategoria_texto;
  if (Object.keys(antesDe(prev, cambios)).length) {
    const restaurar = antesDe(prev, cambios);
    const campos = Object.keys(antes).map((k) => DESCRIPCION_CAMPO[k] || k.replace(/_/g, ' '));
    registrar(`${campos.slice(0, 2).join(', ') || 'cambio'} de ${nombreGasto(prev)}`, async () => {
      await supabase.from('gastos').update(restaurar).eq('id', id).then(check);
    });
  }
  return nuevo;
}
// borra sin registrar (para deshacer altas). Solo admin por RLS.
async function borrarGastos(ids) {
  const { error, count } = await supabase.from('gastos').delete({ count: 'exact' }).in('id', ids);
  if (error) throw new Error(traducirError(error));
  if (!count) throw new Error('Para deshacer un alta hay que borrar el gasto, y solo un administrador puede borrar.');
}
export async function borrarGasto(id) {
  const fila = check(await supabase.from('gastos').select('*').eq('id', id).maybeSingle());
  const { error, count } = await supabase.from('gastos').delete({ count: 'exact' }).eq('id', id);
  if (error) throw new Error(traducirError(error));
  if (count === 0) throw new Error('No tienes permiso para borrar gastos (solo administradores).');
  if (fila) registrar(`Borrado: ${nombreGasto(fila)}`, async () => { check(await supabase.from('gastos').insert(fila).select('id')); });
}
// gastos pendientes de revisar (añadidos con el escáner)
export async function getGastosPendientes() {
  return selectAll('gastos', GASTO_COLS, (q) => q.eq('revisado', false).order('fecha_factura', { ascending: false }));
}
export async function contarPendientes() {
  const { count, error } = await supabase.from('gastos').select('id', { count: 'exact', head: true }).eq('revisado', false);
  if (error) return 0;
  return count || 0;
}
// ayudas del escáner (funciones de la BD: no necesitan ver los gastos)
export async function escanerProveedores() { return check(await supabase.rpc('escaner_proveedores')) || []; }
export async function escanerEmpresas() { return check(await supabase.rpc('escaner_empresas')) || []; }
export async function escanerSugerencia(empresa, nif) { return (check(await supabase.rpc('escaner_sugerencia', { p_empresa: empresa, p_nif: nif || null })) || [])[0] || null; }
// gastos de un trabajador en un mes (para no duplicar nómina / SS / IRPF al escanear una nómina)
export async function gastosDeEmpresaMes(empresa, cursoId, mes) {
  return check(await supabase.from('gastos').select('id,concepto,cantidad,subcategoria_id,subcategoria_texto,tipo').eq('curso_id', cursoId).eq('mes', mes).ilike('empresa', empresa)) || [];
}
export async function escanerDuplicado(empresa, numero, fecha, importe) {
  return (check(await supabase.rpc('escaner_duplicado', { p_empresa: empresa, p_numero: numero || null, p_fecha: fecha || null, p_importe: importe ?? null })) || [])[0] || null;
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
// Totales ya sumados en la base de datos (Control > FactCheck): evitan descargar todas las líneas.
export async function getFactcheckFacturacion(desde, hasta) {
  return check(await supabase.rpc('factcheck_facturacion', { p_desde: desde, p_hasta: hasta })) || [];
}
export async function getFactcheckBanco(desde, hasta) {
  return check(await supabase.rpc('factcheck_banco', { p_desde: desde, p_hasta: hasta })) || [];
}
export async function getFacturacion() {
  return selectAll('facturacion', FACT_COLS, (q) => q.order('fecha_pago', { ascending: false }).order('id', { ascending: true }));
}
export async function actualizarFacturacion(id, cambios) {
  const prev = check(await supabase.from('facturacion').select(FACT_COLS).eq('id', id).maybeSingle());
  const nuevo = check(await supabase.from('facturacion').update(cambios).eq('id', id).select(FACT_COLS).single());
  const antes = antesDe(prev, cambios);
  if (Object.keys(antes).length) registrar(`Marca en recibo ${prev?.num_recibo || ''} ${prev?.alumno || ''}`.trim(), async () => { check(await supabase.from('facturacion').update(antes).eq('id', id).select('id')); });
  return nuevo;
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
  const prev = [];
  for (let i = 0; i < ids.length; i += 100) prev.push(...check(await supabase.from('gastos').select('id,centro_id').in('id', ids.slice(i, i + 100))));
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    out.push(...check(await supabase.from('gastos').update({ centro_id: centroId }).in('id', ids.slice(i, i + 100)).select(GASTO_COLS)));
  }
  registrar(`Mover ${ids.length} gastos de centro`, async () => {
    for (const p of prev) check(await supabase.from('gastos').update({ centro_id: p.centro_id }).eq('id', p.id).select('id'));
  });
  return out;
}

// ---------- plantillas de gastos (mensuales y nóminas) ----------
const PLA_COLS = 'id,grupo,activo,orden,empresa,concepto,cantidad,tipo,categoria_id,subcategoria_id,metodo_pago,periodicidad,dia_pago,centro_id';
export async function getPlantillas() {
  return check(await supabase.from('plantillas_gasto').select(PLA_COLS).order('orden', { ascending: true }));
}
export async function crearPlantilla(datos) {
  return check(await supabase.from('plantillas_gasto').insert(datos).select(PLA_COLS).single());
}
export async function actualizarPlantilla(id, cambios) {
  return check(await supabase.from('plantillas_gasto').update(cambios).eq('id', id).select(PLA_COLS).single());
}
export async function borrarPlantilla(id) {
  check(await supabase.from('plantillas_gasto').delete().eq('id', id));
}

// ---------- conciliación bancaria ----------
const CTA_COLS = 'id,nombre,banco,iban,referencia,centro_id,activo,orden';
const MOV_COLS = 'id,cuenta_id,fecha,fecha_valor,concepto,importe,saldo,clave,estado,gasto_id,centro_id,notas,archivo';
export async function getCuentas() {
  return check(await supabase.from('cuentas_bancarias').select(CTA_COLS).order('orden', { ascending: true }));
}
export async function crearCuenta(datos) {
  return check(await supabase.from('cuentas_bancarias').insert(datos).select(CTA_COLS).single());
}
export async function actualizarCuenta(id, cambios) {
  return check(await supabase.from('cuentas_bancarias').update(cambios).eq('id', id).select(CTA_COLS).single());
}
// Borra una cuenta bancaria. Solo es posible si no tiene movimientos ni extractos (lo impide la base de datos).
export async function borrarCuenta(id) {
  const { error } = await supabase.from('cuentas_bancarias').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') throw new Error('Esta cuenta tiene movimientos o extractos importados y no se puede eliminar.');
    throw new Error(error.message);
  }
}
export async function getMovimientos() {
  return selectAll('movimientos_banco', MOV_COLS, (q) => q.order('fecha', { ascending: false }).order('id', { ascending: true }));
}
// Inserta los movimientos nuevos; los ya importados (misma cuenta y clave) se ignoran.
export async function insertarMovimientos(movs) {
  const out = [];
  for (let i = 0; i < movs.length; i += 500) {
    out.push(...check(await supabase.from('movimientos_banco').upsert(movs.slice(i, i + 500), { onConflict: 'cuenta_id,clave', ignoreDuplicates: true }).select(MOV_COLS)));
  }
  return out;
}
export async function actualizarMovimientos(ids, cambios) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...check(await supabase.from('movimientos_banco').update(cambios).in('id', ids.slice(i, i + 100)).select(MOV_COLS)));
  return out;
}
// Enlaces movimiento <-> gasto (un pago puede cubrir varias facturas y una factura puede pagarse en varios pagos)
const MG_COLS = 'id,movimiento_id,gasto_id,importe';
export async function getMovGastos() {
  return selectAll('movimiento_gastos', MG_COLS, (q) => q.order('id', { ascending: true }));
}
// Sustituye los enlaces de un movimiento (o de un gasto) por el conjunto indicado. filas: [{ movimiento_id, gasto_id, importe }]
export async function reemplazarEnlaces({ movimiento_id = null, gasto_id = null }, filas) {
  const col = movimiento_id ? 'movimiento_id' : 'gasto_id', val = movimiento_id || gasto_id;
  check(await supabase.from('movimiento_gastos').delete().eq(col, val).select('id'));
  return filas.length ? check(await supabase.from('movimiento_gastos').insert(filas).select(MG_COLS)) : [];
}
export async function insertarEnlaces(filas) {
  const out = [];
  for (let i = 0; i < filas.length; i += 200) out.push(...check(await supabase.from('movimiento_gastos').upsert(filas.slice(i, i + 200), { onConflict: 'movimiento_id,gasto_id' }).select(MG_COLS)));
  return out;
}
export async function quitarEnlacesMov(ids) {
  for (let i = 0; i < ids.length; i += 100) check(await supabase.from('movimiento_gastos').delete().in('movimiento_id', ids.slice(i, i + 100)).select('id'));
}
// Ingresos de remesas: un movimiento del banco corresponde a las remesas de un mes y banco (por curso + mes + banco, no por el envío)
const MR_COLS = 'id,movimiento_id,curso_id,mes,banco,remesa_nombre,importe';
export async function getMovRemesas() {
  return selectAll('movimiento_remesas', MR_COLS, (q) => q.order('id', { ascending: true }));
}
// Envíos guardados en Remesas (Academia) con su resumen por remesa: lo que se esperaba cobrar
export async function getRemesaEnvios() {
  return check(await supabase.from('ac_remesa_envios').select('id,curso_id,mes,enviado_el,resumen:ac_remesa_envio_resumen(remesa_nombre,banco,orden,cobros,total)').order('enviado_el', { ascending: false }));
}
// Sustituye los enlaces de un grupo (curso + mes + banco) por el conjunto indicado
export async function reemplazarMovRemesas({ curso_id, mes, banco }, filas) {
  check(await supabase.from('movimiento_remesas').delete().eq('curso_id', curso_id).eq('mes', mes).eq('banco', banco).select('id'));
  return filas.length ? check(await supabase.from('movimiento_remesas').insert(filas).select(MR_COLS)) : [];
}
export async function insertarMovRemesas(filas) {
  return filas.length ? check(await supabase.from('movimiento_remesas').insert(filas).select(MR_COLS)) : [];
}
export async function quitarMovRemesasMov(ids) {
  for (let i = 0; i < ids.length; i += 100) check(await supabase.from('movimiento_remesas').delete().in('movimiento_id', ids.slice(i, i + 100)).select('id'));
}
export async function marcarGastosBanca(ids, valor = true) {
  const prev = [];
  for (let i = 0; i < ids.length; i += 100) prev.push(...check(await supabase.from('gastos').select('id,check_banca').in('id', ids.slice(i, i + 100))));
  const out = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...check(await supabase.from('gastos').update({ check_banca: valor }).in('id', ids.slice(i, i + 100)).select(GASTO_COLS)));
  registrar(`Marcar ${ids.length} gastos en banco`, async () => {
    for (const p of prev) check(await supabase.from('gastos').update({ check_banca: p.check_banca }).eq('id', p.id).select('id'));
  });
  return out;
}

// ---------- FactCheck (valores manuales) ----------
export async function getFactcheckManual() {
  return check(await supabase.from('factcheck_manual').select('id,periodo,campo,valor,texto'));
}
export async function guardarFactcheckManual(periodo, campo, valor, texto = null) {
  return check(await supabase.from('factcheck_manual').upsert({ periodo, campo, valor, texto }, { onConflict: 'periodo,campo' }).select('id,periodo,campo,valor,texto').single());
}

// ---------- notas (cuaderno de revisiones) ----------
const NOTA_COLS = 'id,fecha,ultimo_cargo,comentario,hecho,created_at';
export async function getNotas() {
  return check(await supabase.from('notas').select(NOTA_COLS).order('fecha', { ascending: false }).order('created_at', { ascending: false }));
}
export async function crearNota(datos) {
  return check(await supabase.from('notas').insert(datos).select(NOTA_COLS).single());
}
export async function actualizarNota(id, cambios) {
  return check(await supabase.from('notas').update(cambios).eq('id', id).select(NOTA_COLS).single());
}

// ---------- datos de interés (tarifas y parámetros de costes) ----------
export async function getTarifas() {
  return check(await supabase.from('tarifas').select('id,nombre,cuota,horas_mes,max_grupo,orden').order('orden', { ascending: true }));
}
export async function crearTarifa(datos) {
  return check(await supabase.from('tarifas').insert(datos).select('id,nombre,cuota,horas_mes,max_grupo,orden').single());
}
export async function actualizarTarifa(id, cambios) {
  return check(await supabase.from('tarifas').update(cambios).eq('id', id).select('id,nombre,cuota,horas_mes,max_grupo,orden').single());
}
export async function getParametros() {
  return check(await supabase.from('parametros').select('clave,valor,etiqueta,orden').order('orden', { ascending: true }));
}
export async function guardarParametro(clave, valor) {
  return check(await supabase.from('parametros').update({ valor }).eq('clave', clave).select('clave,valor,etiqueta,orden').single());
}

// ---------- PDFs de facturas (Storage, bucket privado "facturas") ----------
// Sube el archivo y devuelve el valor para link_factura: "storage:<ruta>"
export async function subirFactura(file, carpeta = 'general') {
  const nombre = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\-]+/g, '_').slice(-90);
  const ruta = `${carpeta.replace(/[^\w.\-]+/g, '_')}/${Date.now()}-${nombre}`;
  const { error } = await supabase.storage.from('facturas').upload(ruta, file, { contentType: file.type || 'application/pdf', upsert: false });
  if (error) throw new Error(traducirError(error));
  return `storage:${ruta}`;
}
// Devuelve una URL para abrir la factura: enlace firmado (10 min) si está en Storage, o el enlace http tal cual.
export async function urlFactura(link) {
  if (!link) return null;
  if (link.startsWith('storage:')) {
    const { data, error } = await supabase.storage.from('facturas').createSignedUrl(link.slice(8), 600);
    if (error) throw new Error(traducirError(error));
    return data.signedUrl;
  }
  return /^https?:\/\//i.test(link) ? link : null;
}

// ---------- usuarios ----------
export async function getPerfiles() {
  return check(await supabase.from('profiles').select('*').order('created_at', { ascending: true }));
}
export async function passwordCambiada() { check(await supabase.rpc('password_cambiada')); }
// crear usuarios y poner contraseñas provisionales (función del servidor, solo admin)
export async function adminUsuarios(cuerpo) {
  const { data, error } = await supabase.functions.invoke('admin-usuarios', { body: cuerpo });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch { /* */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
export async function actualizarPerfil(id, cambios) {
  return check(await supabase.from('profiles').update(cambios).eq('id', id).select('*').single());
}

// ---------- gestoría: extractos, envíos y notas ----------
const EXT_COLS = 'id,cuenta_id,fecha_desde,fecha_hasta,archivo_pdf,nombre_pdf,archivo_n43,nombre_n43,saldo_inicial,saldo_final,movimientos,notas,created_at';
export async function getExtractos() {
  return check(await supabase.from('extractos').select(EXT_COLS).order('fecha_hasta', { ascending: false }));
}
export async function crearExtracto(datos) {
  return check(await supabase.from('extractos').insert(datos).select(EXT_COLS).single());
}
export async function actualizarExtracto(id, cambios) {
  return check(await supabase.from('extractos').update(cambios).eq('id', id).select(EXT_COLS).single());
}
export async function subirArchivoGestoria(file, carpeta) {
  const nombre = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-90);
  const ruta = `${carpeta.replace(/[^\w.\-/]+/g, '_')}/${Date.now()}-${nombre}`;
  const { error } = await supabase.storage.from('gestoria').upload(ruta, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (error) throw new Error(traducirError(error));
  return ruta;
}
// Descarga un archivo de Storage como Blob (bucket "facturas" o "gestoria")
export async function descargarArchivo(bucket, ruta) {
  const { data, error } = await supabase.storage.from(bucket).download(ruta);
  if (error) throw new Error(traducirError(error));
  return data;
}
export async function urlArchivo(bucket, ruta) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(ruta, 600);
  if (error) throw new Error(traducirError(error));
  return data.signedUrl;
}
const ENV_COLS = 'id,periodo,estado,fecha_envio,incompleto,faltaba,notas,updated_at';
export async function getEnvios() {
  return check(await supabase.from('gestoria_envios').select(ENV_COLS).order('periodo', { ascending: false }));
}
export async function guardarEnvio(periodo, cambios) {
  return check(await supabase.from('gestoria_envios').upsert({ periodo, ...cambios }, { onConflict: 'periodo' }).select(ENV_COLS).single());
}
const GN_COLS = 'id,periodo,texto,hecho,created_at';
export async function getGestoriaNotas() {
  return check(await supabase.from('gestoria_notas').select(GN_COLS).order('created_at', { ascending: true }));
}
export async function crearGestoriaNota(datos) {
  return check(await supabase.from('gestoria_notas').insert(datos).select(GN_COLS).single());
}
export async function actualizarGestoriaNota(id, cambios) {
  return check(await supabase.from('gestoria_notas').update(cambios).eq('id', id).select(GN_COLS).single());
}
// Marca gastos como enviados a la gestoría (FISCONTAL) con la fecha de envío
export async function marcarGastosGestoria(ids, fecha) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...check(await supabase.from('gastos').update({ fiscontal: 'True', fiscontal_fecha: fecha }).in('id', ids.slice(i, i + 100)).select(GASTO_COLS)));
  return out;
}

// ---------- historial de cambios y copia de seguridad ----------
export async function getAuditoria({ tabla = '', desde = '', hasta = '', limite = 500 } = {}) {
  let q = supabase.from('auditoria').select('id,at,usuario,tabla,registro_id,accion,antes,despues,restaurado_de').order('id', { ascending: false }).limit(limite);
  if (tabla) q = q.eq('tabla', tabla);
  if (desde) q = q.gte('at', desde);
  if (hasta) q = q.lte('at', hasta);
  return check(await q);
}
export async function restaurarAuditoria(id) {
  return check(await supabase.rpc('auditoria_restaurar', { p_id: id }));
}
export async function exportarTabla(tabla) {
  return selectAll(tabla, '*', (q) => q);
}
