// Cliente de OneDrive: la web habla solo con la función «onedrive» de Supabase, que es la que tiene las credenciales de Microsoft.
import { supabase } from './db.js';

async function invocar(cuerpo) {
  const { data, error } = await supabase.functions.invoke('onedrive', { body: cuerpo });
  let det = data;
  if (error) { try { det = await error.context.json(); } catch { det = { error: error.message }; } }
  if (!det || det.error) throw new Error(det?.error || 'OneDrive no responde.');
  return det;
}
let estadoCache = null;
export async function estado(forzar = false) {
  if (!estadoCache || forzar) estadoCache = invocar({ accion: 'estado' }).catch(() => ({ conectado: false }));
  return estadoCache;
}
export async function conectar() {
  const { url } = await invocar({ accion: 'iniciar', volver: window.location.origin });
  window.location.href = url;
}
// area: portal | gastos | academia. Devuelve «od:<id>» para guardarlo en la columna del archivo.
export async function subir(area, carpeta, file) {
  const f = new FormData();
  f.append('accion', 'subir'); f.append('area', area); f.append('carpeta', carpeta || ''); f.append('file', file, file.name);
  const { data, error } = await supabase.functions.invoke('onedrive', { body: f });
  let det = data;
  if (error) { try { det = await error.context.json(); } catch { det = { error: error.message }; } }
  if (!det || det.error) throw new Error(det?.error || 'No se ha podido subir a OneDrive.');
  return 'od:' + det.id;
}
export const enlace = (tabla, id) => invocar({ accion: 'enlace', tabla, id }).then((r) => r.url);
export const quitar = (area, item) => invocar({ accion: 'quitar', area, item });
export const esOD = (v) => typeof v === 'string' && v.startsWith('od:');

// fecha de caducidad del secreto de la app de Microsoft (solo administradores)
export async function caducidad() {
  const { data } = await supabase.from('onedrive_ajustes').select('secreto_caduca').maybeSingle();
  return data?.secreto_caduca || null;
}
export async function guardarCaducidad(fecha) {
  const { error } = await supabase.from('onedrive_ajustes').upsert({ id: 1, secreto_caduca: fecha || null, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}
export const diasHasta = (iso) => (iso ? Math.ceil((new Date(iso + 'T00:00:00') - new Date()) / 86400000) : null);
