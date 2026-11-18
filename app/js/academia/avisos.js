// Avisos al meter un alumno en un grupo: nivel distinto, año de nacimiento fuera del grupo y horarios que se pisan.
// Devuelve una lista de textos; si hay alguno se pide confirmación antes de guardar (no se bloquea nada).
import { confirmar } from '../ui.js';
import { nivelNum, hhmm, DIAS_CORTO } from './kit.js';

const aMin = (t) => { const [a, b] = hhmm(t).split(':').map(Number); return a * 60 + b; };
const nivelTxt = (n) => `L${nivelNum(n)}`;
// años de nacimiento del grupo: «2015-2016», «2015 y 2016», «2015»… -> [mínimo, máximo]
export function rangoAnios(txt) {
  const ys = String(txt || '').match(/\b(19|20)\d{2}\b/g)?.map(Number);
  return ys?.length ? [Math.min(...ys), Math.max(...ys)] : null;
}

// alumno: ficha (nivel, fecha_nacimiento) · grupo: con sesiones · otrosGrupos: grupos del curso (con miembros y sesiones)
export function avisosAlumnoGrupo(alumno, grupo, otrosGrupos = []) {
  const av = [];
  const na = nivelNum(alumno.nivel); const ng = nivelNum(grupo.nivel);
  if (na && ng && na !== ng) av.push(`Su nivel es ${nivelTxt(alumno.nivel)} y el grupo ${grupo.nombre} es de nivel ${nivelTxt(grupo.nivel)}.`);
  else if (!na && ng && !alumno.nivel) av.push(`El alumno no tiene nivel asignado y el grupo es de nivel ${nivelTxt(grupo.nivel)}.`);
  const anios = rangoAnios(grupo.anios_nacimiento);
  const nac = alumno.fecha_nacimiento ? Number(String(alumno.fecha_nacimiento).slice(0, 4)) : null;
  if (anios && nac && (nac < anios[0] || nac > anios[1])) av.push(`Nació en ${nac} y el grupo es de nacidos en ${grupo.anios_nacimiento}.`);
  for (const o of otrosGrupos) {
    if (o.id === grupo.id || !o.miembros?.some((m) => m.alumno_id === alumno.id && !m.fecha_baja)) continue;
    for (const s of grupo.sesiones || []) for (const t of o.sesiones || []) {
      if (s.dia === t.dia && aMin(s.hora_inicio) < aMin(t.hora_fin) && aMin(t.hora_inicio) < aMin(s.hora_fin)) av.push(`El horario coincide con el del grupo ${o.nombre} (${DIAS_CORTO[t.dia]} ${hhmm(t.hora_inicio)}–${hhmm(t.hora_fin)}).`);
    }
  }
  return [...new Set(av)];
}

// true = seguir adelante (sin avisos, o el usuario confirma)
export async function confirmarAvisos(avisos, titulo = 'Revisa antes de añadir') {
  if (!avisos.length) return true;
  return confirmar({ titulo, texto: avisos.join(' '), ok: 'Añadir igualmente' });
}
