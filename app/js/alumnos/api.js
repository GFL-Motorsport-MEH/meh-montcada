// Acceso a datos del módulo ALUMNOS (tablas al_*). Lo que viene de Academia (alumnos, grupos, tutorías, biblioteca, calendario…) se reutiliza de academia/api.js.
// Los datos de al_* se leen sin caché (cada pantalla trae lo suyo) y se filtran por los alumnos del centro activo.
import { supabase, traducirError } from '../db.js';
import * as ac from '../academia/api.js';

export const { alumnos, profesoras, aulas, grupos, tutorias, prestamos, anotaciones, calendarioDias, formularios, formRespuestas, recogidas, invalidar } = ac;
export const actividades = ac.alActividades;
const chk = ({ data, error }) => { if (error) throw new Error(traducirError(error)); return data; };
const PAGE = 1000;

// lee todas las filas de una tabla (de 1000 en 1000)
async function todo(tabla, cols = '*', build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(tabla).select(cols);
    if (build) q = build(q);
    const rows = chk(await q.order('id').range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}
// solo las filas de alumnos del centro activo (ac.alumnos() ya viene filtrado por centro)
async function delCentro(filas) {
  const ids = new Set((await ac.alumnos()).map((a) => a.id));
  return filas.filter((f) => ids.has(f.alumno_id));
}
const deAlumno = (alumnoId) => (alumnoId ? (q) => q.eq('alumno_id', alumnoId) : undefined);
const porFecha = (campo) => (a, b) => String(b[campo] || '').localeCompare(String(a[campo] || '')) || String(b.created_at || '').localeCompare(String(a.created_at || ''));

const PROF = ', profesora:ac_profesoras(id,nombre)';
export const evaluaciones = async (alumnoId) => (await delCentro(await todo('al_evaluaciones', '*' + PROF, deAlumno(alumnoId)))).sort(porFecha('fecha'));
export const tareas = async (alumnoId) => (await delCentro(await todo('al_tareas_extra', '*' + PROF, deAlumno(alumnoId)))).sort(porFecha('fecha_asignada'));
export const informes = async (alumnoId) => (await delCentro(await todo('al_informes', '*' + PROF, deAlumno(alumnoId)))).sort(porFecha('created_at'));
export const mensajes = async (alumnoId) => (await delCentro(await todo('al_mensajes', '*', deAlumno(alumnoId)))).sort(porFecha('created_at'));
export const docsFamilia = async (alumnoId) => (await delCentro(await todo('al_documentos_familia', '*', deAlumno(alumnoId)))).sort(porFecha('created_at'));
// Study Club: sesiones (con su profesora), reservas y configuración. Las sesiones futuras las crea el servidor (studyclub_generar).
export const scConfig = async () => chk(await supabase.from('al_studyclub_config').select('*').eq('id', 1).maybeSingle());
export const scSesiones = async () => (await todo('al_studyclub_sesiones', '*' + PROF)).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora_inicio.localeCompare(b.hora_inicio));
export const scReservas = async () => todo('al_studyclub_reservas', '*');
export const scTokens = async () => chk(await supabase.from('al_studyclub_ics').select('*'));
export const scGenerar = async (desde, hasta) => chk(await supabase.rpc('studyclub_generar', { p_desde: desde, p_hasta: hasta }));
export const scNuevoToken = async (profesoraId) => chk(await supabase.from('al_studyclub_ics').upsert({ profesora_id: profesoraId, token: crypto.randomUUID() }).select().single());
export const inscritos = async ({ alumnoId, actividadId } = {}) => (await delCentro(await todo('al_actividad_inscritos', '*', (q) => (alumnoId ? q.eq('alumno_id', alumnoId) : actividadId ? q.eq('actividad_id', actividadId) : q))));

// ---------- escrituras ----------
export async function ins(tabla, fila) { return chk(await supabase.from(tabla).insert(fila).select().single()); }
export async function insMany(tabla, filas, lote = 200) {
  const out = [];
  for (let i = 0; i < filas.length; i += lote) out.push(...chk(await supabase.from(tabla).insert(filas.slice(i, i + lote)).select()));
  return out;
}
export async function upd(tabla, id, parche) { return chk(await supabase.from(tabla).update(parche).eq('id', id).select().single()); }
export async function del(tabla, id) { chk(await supabase.from(tabla).delete().eq('id', id)); }
export async function delWhere(tabla, col, valor) { chk(await supabase.from(tabla).delete().eq(col, valor)); }
// tablas que sí están en la caché de Academia (actividades y anotaciones): escribir por su API para que se refresque
export const insAc = ac.ins;
export const updAc = ac.upd;
export const delAc = ac.del;

// ---------- archivos (buckets privados; la primera carpeta de la ruta es el id del alumno) ----------
const seguro = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80);
export async function subir(bucket, alumnoId, file) {
  const ruta = `${alumnoId}/${Date.now()}-${seguro(file.name)}`;
  const { error } = await supabase.storage.from(bucket).upload(ruta, file, { contentType: file.type || 'application/pdf', upsert: false });
  if (error) throw new Error(traducirError(error));
  return ruta;
}
export async function abrir(bucket, ruta) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(ruta, 600);
  if (error) throw new Error(traducirError(error));
  window.open(data.signedUrl, '_blank', 'noopener');
}
export async function quitarArchivo(bucket, ruta) { if (ruta) await supabase.storage.from(bucket).remove([ruta]); }
export const BUCKET_DOCS = 'alumnos-docs';
export const BUCKET_MATERIAL = 'alumnos-material';
