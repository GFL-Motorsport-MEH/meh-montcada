// Analiza las hojas de horario (KIDS, EXTRAESCOLARES, TEENS & ADULTS) del Excel «26_27 HORARIO».
// Cada grupo es un bloque: arriba «nombre del grupo · día · hora», debajo la profesora, años y nivel,
// y luego la lista de alumnos. Un mismo grupo aparece en varios bloques (uno por día). Sin dependencias del navegador.
const t = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
const norm = (s) => t(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const HORA = /^\s*(\d{1,2})[:.](\d{2})\s*(?:[-–]|a|\.)\s*(\d{1,2})[:.](\d{2})\s*$/;
const DIAS = [['lunes', 1], ['martes', 2], ['mierc', 3], ['jueves', 4], ['viernes', 5], ['sabado', 6]];
const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${m}`;

export function diaDe(s) { const n = norm(s); const d = DIAS.find(([k]) => n.startsWith(k)); return d ? d[1] : null; }

export function parseHoja(filas, hoja) {
  const cabeceras = [];
  filas.forEach((r, i) => (r || []).forEach((c, j) => {
    const m = typeof c === 'string' ? c.match(HORA) : null;
    if (m && j >= 2 && t(r[j - 1]) && t(r[j - 2])) cabeceras.push({ i, j, nombre: t(r[j - 2]), dia: t(r[j - 1]), ini: hhmm(m[1], m[2]), fin: hhmm(m[3], m[4]) });
  }));
  const filasCab = [...new Set(cabeceras.map((c) => c.i))].sort((a, b) => a - b);
  const grupos = new Map(); const aviso = [];
  for (const c of cabeceras) {
    const fin = filasCab.find((x) => x > c.i) ?? filas.length;
    const ficha = filas[c.i + 1] || [];
    const profesora = t(ficha[c.j - 2]); const anios = t(ficha[c.j - 1]); const nivel = t(ficha[c.j]).replace(/^level:?\s*/i, '');
    const alumnos = [];
    for (let i = c.i + 2; i < fin; i++) { const v = t((filas[i] || [])[c.j - 2]); if (v && !/^nombre$/i.test(v) && !/^\d+([.,]\d+)?$/.test(v) && v.length > 3) alumnos.push(v); }
    const dia = diaDe(c.dia);
    const profe = /^teacher$|^-$/i.test(profesora) ? '' : profesora;
    let nombre = c.nombre.toUpperCase();
    // nombres genéricos (sin número): se completan con nivel/profesora para no mezclar grupos distintos
    if (!/\d/.test(nombre) || /^LEVEL \d$/.test(nombre)) nombre = [nombre, nivel && !nombre.includes(nivel.toUpperCase()) ? nivel : '', profe].filter(Boolean).join(' · ').toUpperCase();
    const clave = `${hoja}|${norm(nombre)}|${norm(profe)}`;
    let g = grupos.get(clave);
    if (!g) { g = { hoja, nombre, profesora: profe, anios, nivel, sesiones: [], alumnos: new Set() }; grupos.set(clave, g); }
    if (dia) { if (!g.sesiones.some((s) => s.dia === dia && s.ini === c.ini)) g.sesiones.push({ dia, ini: c.ini, fin: c.fin }); }
    else aviso.push(`${nombre}: día «${c.dia}» no reconocido (no se crea esa sesión)`);
    for (const a of alumnos) g.alumnos.add(a);
  }
  return { grupos: [...grupos.values()].map((g) => ({ ...g, alumnos: [...g.alumnos] })), aviso };
}

export function modalidadDe(g) {
  const n = norm(g.nombre);
  if (g.hoja === 'EXTRAESCOLARES') return 'Extraescolar';
  if (/^babies/.test(n)) return 'Babies'; if (/^teens/.test(n)) return 'Teens'; if (/^adults/.test(n)) return 'Adults';
  if (/one to|1 to 1/.test(n)) return '1 to 1'; if (/^kids/.test(n)) return 'Kids';
  return g.hoja === 'KIDS' ? 'Kids' : null;
}
