// Acceso a datos del módulo TRABAJADORES (tablas tr_*). Los documentos (nóminas, contratos firmados…) reutilizan lo de ac_portal_docs.
// Son pocos datos (equipo de la academia): se leen enteros en cada pantalla, sin caché.
import { supabase, traducirError } from '../db.js';
import * as ac from '../academia/api.js';

export const { portalDocs, subirPortal, urlPortal, quitarArchivoPortal, usuarios } = ac;
const chk = ({ data, error }) => { if (error) throw new Error(traducirError(error)); return data; };

export const contratos = async () => chk(await supabase.from('tr_contratos').select('*').order('fecha_inicio', { ascending: false }));
export const horario = async () => chk(await supabase.from('tr_horario').select('*').order('dia').order('hora_inicio'));
export const horas = async () => chk(await supabase.from('tr_horas').select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false }));

export const ins = async (tabla, fila) => chk(await supabase.from(tabla).insert(fila).select().single());
export const upd = async (tabla, id, parche) => chk(await supabase.from(tabla).update(parche).eq('id', id).select().single());
export const del = async (tabla, id) => { chk(await supabase.from(tabla).delete().eq('id', id)); };
// quitar un documento del portal también vacía la caché de Academia
export const delDocumento = async (d) => { await ac.del('ac_portal_docs', d.id); await ac.quitarArchivoPortal(d.ruta); };
export const insDocumento = (fila) => ac.ins('ac_portal_docs', fila);
