// Acceso a datos del módulo Academia (tablas ac_*). Una pequeña caché de 60 s evita repetir consultas al cambiar de pestaña;
// cualquier escritura la vacía entera.
import { supabase, traducirError } from '../db.js';

const PAGE = 1000;
const chk = ({ data, error }) => { if (error) throw new Error(traducirError(error)); return data; };

// Lee todas las filas: la primera página y, si viene llena, las siguientes de 4 en 4 en paralelo (antes una a una).
async function all(tabla, cols = '*', build) {
  const pag = async (from) => {
    let q = supabase.from(tabla).select(cols);
    if (build) q = build(q);
    return chk(await q.order('id').range(from, from + PAGE - 1));
  };
  const out = await pag(0);
  if (out.length < PAGE) return out;
  const LOTE = 4;
  for (let n = 1; ; n += LOTE) {
    const lotes = await Promise.all(Array.from({ length: LOTE }, (_, i) => pag((n + i) * PAGE)));
    for (const rows of lotes) out.push(...rows);
    if (lotes[LOTE - 1].length < PAGE) break;
    if (lotes.some((r) => r.length < PAGE)) break;
  }
  return out;
}

// Caché «sirve lo que hay y refresca por detrás»: los datos se entregan al instante y, si tienen más de TTL, se renuevan en segundo plano.
// Cualquier escritura propia la vacía entera. Pasados MAX_EDAD sin renovarse se espera a los datos nuevos.
const cache = new Map();
const TTL = 30000;
const MAX_EDAD = 600000;
function cargar(key, fn) {
  const p = fn();
  const e = { t: Date.now(), p, fn, listo: false };
  cache.set(key, e);
  p.then(() => { e.listo = true; }, () => { if (cache.get(key) === e) cache.delete(key); });
  return e;
}
function memo(key, fn) {
  const c = cache.get(key);
  if (c) {
    const edad = Date.now() - c.t;
    if (edad < TTL || !c.listo) return c.p;
    if (edad < MAX_EDAD) { // refresco en segundo plano; si falla se conserva lo anterior
      c.t = Date.now();
      fn().then((v) => { if (cache.get(key) === c) { c.p = Promise.resolve(v); } }, () => { c.t = 0; });
      return c.p;
    }
  }
  return cargar(key, fn).p;
}
export const invalidar = () => cache.clear();
// Renueva por detrás todo lo que la app ya ha descargado (se llama cada pocos minutos mientras está abierta).
export function refrescarTodo() {
  for (const [key, c] of cache) {
    if (!c.listo || Date.now() - c.t < TTL) continue;
    c.t = Date.now();
    c.fn().then((v) => { if (cache.get(key) === c) c.p = Promise.resolve(v); }, () => { c.t = 0; });
  }
}

// ---------- lecturas ----------
export const listas = () => memo('listas', async () => {
  const o = {};
  for (const x of (await all('ac_listas')).sort((a, b) => a.orden - b.orden)) (o[x.lista] ||= []).push(x.valor);
  // los descuentos se configuran en Configuración > Cuotas y descuentos: si hay, esos nombres sustituyen a los de la lista
  const d = await all('ac_descuentos').catch(() => []);
  if (d.length) o.descuento = d.filter((x) => x.activo).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)).map((x) => x.nombre);
  return o;
});
export const alumnos = () => memo('alumnos', () => all('ac_alumnos', '*, responsable:ac_responsables(id,apellidos,nombre,email,telefono)'));
export const vinculos = () => memo('vinculos', () => all('ac_vinculos'));
export const profesoras = () => memo('profesoras', () => all('ac_profesoras').then((l) => l.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))));
export const aulas = () => memo('aulas', () => all('ac_aulas').then((l) => l.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))));
export const grupos = (curso) => memo('grupos' + curso, () => all('ac_grupos', '*, sesiones:ac_sesiones(*), miembros:ac_alumno_grupo(id,alumno_id,fecha_alta,fecha_baja)', (q) => q.eq('curso_id', curso)));
export const gruposDeAlumnos = (curso) => memo('ag' + curso, async () => {
  const gs = await grupos(curso);
  const m = new Map();
  for (const g of gs) for (const x of g.miembros) if (!x.fecha_baja) (m.get(x.alumno_id) || m.set(x.alumno_id, []).get(x.alumno_id)).push(g);
  return m;
});
export const calendarioDias = (curso) => memo('cal' + curso, () => all('ac_calendario_marcas', '*', (q) => q.eq('curso_id', curso)));
export const inscripciones = (curso) => memo('ins' + curso, () => all('ac_inscripciones', '*', (q) => q.eq('curso_id', curso)));
export const cuotas = (curso) => memo('cuo' + curso, () => all('ac_cuotas', '*', (q) => q.eq('curso_id', curso)));
export const wpPrecios = (curso) => memo('wpp' + curso, () => all('ac_wp_precios', '*', (q) => q.eq('curso_id', curso)));
export const remesas = (curso) => memo('rem' + curso, () => all('ac_remesas', '*', (q) => q.eq('curso_id', curso)).then((l) => l.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))));
export const bajas = () => memo('bajas', () => all('ac_bajas', '*, alumno:ac_alumnos(id,num,apellidos,nombre,nivel,modalidad,estado)'));
export const contactos = () => memo('contactos', () => all('ac_contactos'));
export const tutorias = () => memo('tutorias', () => all('ac_tutorias', '*, alumno:ac_alumnos(id,apellidos,nombre), profesora:ac_profesoras(id,nombre)'));
export const anotaciones = (alumnoId) => memo('anot' + (alumnoId || ''), () => all('ac_anotaciones', '*, alumno:ac_alumnos(id,apellidos,nombre), profesora:ac_profesoras(id,nombre)', alumnoId ? (q) => q.eq('alumno_id', alumnoId) : undefined));
export const prestamos = () => memo('prestamos', () => all('ac_prestamos', '*, alumno:ac_alumnos(id,apellidos,nombre)'));
export const bibItems = () => memo('bibitems', () => all('ac_biblioteca_items'));
export const recogidas = (curso) => memo('rec' + curso, () => all('ac_recogidas', '*, alumno:ac_alumnos(id,apellidos,nombre,intolerancias,colegio)', (q) => q.eq('curso_id', curso)));
export const recogidasPagos = (curso) => memo('rpag' + curso, () => all('ac_recogidas_pagos', '*, alumno:ac_alumnos(id,apellidos,nombre)', (q) => q.eq('curso_id', curso)));
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
export const descuentos = () => memo('descuentos', () => all('ac_descuentos').then((l) => l.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))));
export const cuotasTarifa = () => memo('cuotasTarifa', () => all('ac_cuotas_tarifa').then((l) => l.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))));
// todos los grupos de todos los cursos con sus miembros (historial de niveles de cada alumno)
export const gruposTodos = () => memo('gruposTodos', () => all('ac_grupos', 'id,nombre,nivel,curso_id,miembros:ac_alumno_grupo(alumno_id,fecha_alta,fecha_baja)'));
export const nivelHistorial = () => memo('nivelHistorial', () => all('ac_nivel_historial'));
export const portalDocs = () => memo('portalDocs', () => all('ac_portal_docs').then((l) => l.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))));
// archivos del portal del trabajador (bucket privado «trabajadores»; ruta = <id del usuario>/<fecha>-<nombre>)
export async function subirPortal(profileId, file) {
  const limpio = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\-]+/g, '_');
  const ruta = `${profileId}/${Date.now()}-${limpio}`;
  const { error } = await supabase.storage.from('trabajadores').upload(ruta, file, { contentType: file.type || 'application/pdf', upsert: false });
  if (error) throw new Error(traducirError(error));
  return ruta;
}
export async function urlPortal(ruta) {
  const { data, error } = await supabase.storage.from('trabajadores').createSignedUrl(ruta, 600);
  if (error) throw new Error(traducirError(error));
  return data.signedUrl;
}
export async function quitarArchivoPortal(ruta) { await supabase.storage.from('trabajadores').remove([ruta]); }
export const responsables = () => memo('responsables', () => all('ac_responsables'));

// lee una foto o PDF de una ficha de inscripción (función del servidor «escanear-ficha»); no guarda nada
export async function escanearFicha(imagen, tipo) {
  const { data, error } = await supabase.functions.invoke('escanear-ficha', { body: { imagen, tipo } });
  let det = data;
  if (error) { try { det = await error.context.json(); } catch { det = { error: error.message }; } }
  if (!det || det.error) { const e = new Error(det?.error === 'sin_clave' ? 'La lectura de fichas aún no está activada (falta la clave del servicio).' : det?.error || 'No se ha podido leer la ficha'); e.sinClave = det?.error === 'sin_clave'; throw e; }
  return det.datos;
}

// ---------- Recogidas: documentos de los padres (bucket privado) y traspaso de pagos a Ingresos ----------
const NOMBRE_SEGURO = (n) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80);
export async function subirDocRecogida(file, alumnoId, tipo) {
  const ruta = `${alumnoId}/${tipo}-${Date.now()}-${NOMBRE_SEGURO(file.name)}`;
  const { error } = await supabase.storage.from('recogidas-docs').upload(ruta, file, { contentType: file.type || 'application/pdf', upsert: false });
  if (error) throw new Error(traducirError(error));
  return ruta;
}
export async function urlDocRecogida(ruta) {
  const { data, error } = await supabase.storage.from('recogidas-docs').createSignedUrl(ruta, 600);
  if (error) throw new Error(traducirError(error));
  return data.signedUrl;
}

// Lleva pagos de recogidas a la hoja Ingresos (fila Activities / All / Recogidas, una celda por mes). Solo se llama a petición del usuario.
// Primero marca los pagos (solo los que aún no estaban traspasados, así un doble clic no duplica) y luego suma a la celda de cada mes.
const MES_NATURAL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export async function traspasarPagosAIngresos(curso, ids, perfilId) {
  const marcados = chk(await supabase.from('ac_recogidas_pagos').update({ traspasado_at: new Date().toISOString(), traspasado_por: perfilId || null })
    .in('id', ids).is('traspasado_at', null).select('id,fecha,importe'));
  const porMes = new Map();
  for (const p of marcados) { const mes = MES_NATURAL[Number(p.fecha.slice(5, 7)) - 1]; porMes.set(mes, Math.round(((porMes.get(mes) || 0) + Number(p.importe)) * 100) / 100); }
  const hecho = [];
  try {
    for (const [mes, suma] of porMes) {
      const filas = chk(await supabase.from('ingresos').select('id,cantidad').eq('curso_id', curso.id).eq('grupo', 'Activities').eq('level', 'All').eq('tipo', 'Recogidas').eq('mes', mes));
      if (filas.length) chk(await supabase.from('ingresos').update({ cantidad: Math.round((Number(filas[0].cantidad) + suma) * 100) / 100 }).eq('id', filas[0].id));
      else {
        const i = MES_NATURAL.indexOf(mes); const y1 = Number(String(curso.nombre).slice(0, 4)); const anio = i + 1 >= 9 ? y1 : y1 + 1;
        chk(await supabase.from('ingresos').insert({ curso_id: curso.id, trimestre: `${Math.ceil((i + 1) / 3)}T ${anio}`, mes, grupo: 'Activities', level: 'All', tipo: 'Recogidas', cantidad: suma }));
      }
      hecho.push([mes, suma]);
    }
  } catch (ex) {
    // si algo falla a medias, se desmarcan los pagos de los meses que no llegaron a sumarse
    const pendientes = marcados.filter((p) => !hecho.some(([m]) => m === MES_NATURAL[Number(p.fecha.slice(5, 7)) - 1])).map((p) => p.id);
    if (pendientes.length) await supabase.from('ac_recogidas_pagos').update({ traspasado_at: null, traspasado_por: null }).in('id', pendientes);
    invalidar(); throw ex;
  }
  invalidar();
  return { pagos: marcados.length, total: marcados.reduce((s, p) => s + Number(p.importe), 0), meses: hecho };
}

// Precarga en segundo plano tras entrar: lo que usan Alumnos, Pagos, Remesas, Horarios… del curso para que al cambiar de pestaña ya esté descargado.
export function precargar(curso) {
  if (!curso) return;
  const t = [listas, alumnos, vinculos, profesoras, aulas, cuotasTarifa, () => grupos(curso), () => inscripciones(curso), () => cuotas(curso), () => wpPrecios(curso), () => remesas(curso)];
  let i = 0;
  const siguiente = () => { const f = t[i++]; if (!f) return; Promise.resolve().then(f).catch(() => {}).finally(() => setTimeout(siguiente, 30)); };
  siguiente(); siguiente(); // dos en paralelo para no saturar la conexión
}
