// Colores de las personas (círculos de siglas en tareas y reuniones). Cada usuario puede tener un color elegido (profiles.color);
// a quien no lo tiene se le reparte uno distinto de la paleta, para que nadie se confunda con otra persona.
export const PALETA = ['#3b6fd8', '#d6455d', '#23966b', '#d17a12', '#7c4dcc', '#0f95aa', '#b83b86', '#6f8416', '#cf5b2b', '#4b6676', '#9a3f27', '#2f7fbf'];
const clave = (s) => String(s || '').trim().toLowerCase();
const porClave = new Map(); // nombre / email / id -> color
let auto = new Map(); // id -> color repartido (solo quien no tiene color elegido)

export function registrarPersonas(lista) {
  const gente = (lista || []).filter(Boolean);
  porClave.clear(); auto = new Map();
  const usados = new Set(gente.map((p) => (p.color || '').toLowerCase()).filter(Boolean));
  const libres = PALETA.filter((c) => !usados.has(c.toLowerCase()));
  const nombre = (p) => String(p.nombre || p.email || '');
  let i = 0;
  for (const p of gente.filter((x) => !x.color).sort((a, b) => nombre(a).localeCompare(nombre(b)))) {
    auto.set(p.id, libres.length ? libres[i % libres.length] : PALETA[i % PALETA.length]); i++;
  }
  for (const p of gente) {
    const c = p.color || auto.get(p.id);
    for (const k of [p.nombre, p.email, p.id]) if (k) porClave.set(clave(k), c);
  }
}
export const colorPersona = (nombreOEmail) => porClave.get(clave(nombreOEmail)) || null;
export const colorAuto = (id) => auto.get(id) || null;
