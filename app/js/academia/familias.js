// Familias: hermanos y familiares de cada alumno, para avisar de los descuentos.
// Un familiar es quien comparte responsable, quien tiene los mismos apellidos o quien se ha vinculado a mano.
import { normalizar } from '../ui.js';

export const esActivo = (a) => a.estado === 'inscrito' || a.estado === 'prematricula';
export const esDescHermanos = (d) => /herman/i.test(d || '');
const claveApe = (a) => normalizar(a.apellidos || '').replace(/\s+/g, ' ').trim();

// devuelve { de(id) → [{ alumno, motivos:[…] }], resumen(id, descPorAlumno) }
export function calcularFamilias(alumnos, vinculos = []) {
  const porResp = new Map(); const porApe = new Map(); const manual = new Map();
  const add = (m, k, a) => { if (k) (m.get(k) || m.set(k, []).get(k)).push(a); };
  const porId = new Map(alumnos.map((a) => [a.id, a]));
  for (const a of alumnos) { add(porResp, a.responsable_id, a); add(porApe, claveApe(a), a); }
  for (const v of vinculos) {
    (manual.get(v.alumno_id) || manual.set(v.alumno_id, []).get(v.alumno_id)).push({ id: v.otro_id, tipo: v.tipo, vid: v.id });
    (manual.get(v.otro_id) || manual.set(v.otro_id, []).get(v.otro_id)).push({ id: v.alumno_id, tipo: v.tipo, vid: v.id });
  }
  const cache = new Map();
  function de(id) {
    if (cache.has(id)) return cache.get(id);
    const a = porId.get(id); const out = new Map();
    const suma = (b, motivo, vid) => { if (!b || b.id === id) return; const x = out.get(b.id) || out.set(b.id, { alumno: b, motivos: [], vid: null }).get(b.id); if (!x.motivos.includes(motivo)) x.motivos.push(motivo); if (vid) x.vid = vid; };
    if (a) {
      for (const b of porResp.get(a.responsable_id) || []) suma(b, 'mismo responsable');
      for (const b of porApe.get(claveApe(a)) || []) suma(b, 'mismos apellidos');
      for (const m of manual.get(id) || []) suma(porId.get(m.id), `vinculado (${m.tipo})`, m.vid);
    }
    const r = [...out.values()].sort((x, y) => (x.alumno.apellidos + x.alumno.nombre).localeCompare(y.alumno.apellidos + y.alumno.nombre, 'es'));
    cache.set(id, r);
    return r;
  }
  // estado de los descuentos de la familia del alumno: { activos, aplicado }
  // descPor: Map alumno_id → descuento de su inscripción del curso (solo si el usuario puede ver Pagos; si no, aplicado = null)
  function resumen(id, descPor) {
    const a = porId.get(id); if (!a) return { activos: 0, aplicado: null };
    const miembros = [a, ...de(id).map((x) => x.alumno)].filter(esActivo);
    if (miembros.length < 2) return { activos: miembros.length, aplicado: null };
    return { activos: miembros.length, aplicado: descPor ? miembros.some((m) => esDescHermanos(descPor.get(m.id))) : null };
  }
  return { de, resumen };
}
