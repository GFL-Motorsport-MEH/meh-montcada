// Orden de las tablas compartido por todo el equipo: se guarda la última vista elegida de cada tabla y se aplica al recargar.
import { supabase } from './db.js';

const cache = new Map();
let cargado = false;
const pendiente = new Map();
let timer = null;

export async function cargarOrdenes() {
  try {
    const { data, error } = await supabase.from('ui_orden_tablas').select('clave,orden');
    if (error) return;
    cache.clear();
    for (const r of data || []) cache.set(r.clave, r.orden);
    cargado = true;
  } catch { /* sin red: cada tabla arranca por su orden por defecto */ }
}
export const ordenGuardado = (clave) => (cargado ? cache.get(clave) || null : null);

export function guardarOrden(clave, orden) {
  cache.set(clave, orden);
  pendiente.set(clave, orden);
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const lote = [...pendiente.entries()].map(([c, o]) => ({ clave: c, orden: o, updated_at: new Date().toISOString() }));
    pendiente.clear();
    try { await supabase.from('ui_orden_tablas').upsert(lote, { onConflict: 'clave' }); } catch { /* se reintentará con el siguiente cambio */ }
  }, 400);
}
