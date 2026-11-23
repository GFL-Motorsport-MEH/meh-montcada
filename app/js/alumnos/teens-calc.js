// TEENS Championship · cálculo de medias y clasificaciones (sin acceso a datos: se puede probar con node).
export const NIVELES = [['A2', 'A2 Básico'], ['B1', 'B1 Medio'], ['B2', 'B2 Alto']];
export const PRUEBAS = [...Array.from({ length: 10 }, (_, i) => [`u${i + 1}`, `T${i + 1}`]), ['mid', 'Ex. Medio'], ['final', 'Ex. Final']];
// por defecto: test de unidad ×1, los dos exámenes ×2; cada prueba sobre 10
export const CFG_DEF = { peso_unidad: 1, peso_mid: 2, peso_final: 2, ...Object.fromEntries(PRUEBAS.map(([k]) => ['total_' + k, 10])) };

export function configDe(filas) {
  const c = { ...CFG_DEF };
  for (const f of filas || []) if (f.clave in c && Number(f.valor) > 0) c[f.clave] = Number(f.valor);
  return c;
}
const pesoDe = (k, c) => (k === 'mid' ? c.peso_mid : k === 'final' ? c.peso_final : c.peso_unidad);

// notas: { u1: 13, mid: 7.5, ... } en bruto. Solo cuentan las pruebas con nota (las que faltan no puntúan como 0).
export function mediaAlumno(notas, c) {
  let s = 0, w = 0, n = 0;
  for (const [k] of PRUEBAS) {
    const v = notas[k];
    if (v === undefined || v === null || v === '') continue;
    const x = Number(v);
    if (!Number.isFinite(x)) continue;
    const p = pesoDe(k, c);
    s += (x / c['total_' + k]) * 10 * p; w += p; n++;
  }
  return { media: w > 0 ? s / w : null, n };
}
export function notasPorAlumno(notas) {
  const m = new Map();
  for (const x of notas) { if (!m.has(x.teen_id)) m.set(x.teen_id, {}); m.get(x.teen_id)[x.prueba] = x.valor; }
  return m;
}
const nombre = (a, b) => a.nombre.localeCompare(b.nombre, 'es');

// clasificación de un nivel: grupos (media simple de las medias de sus alumnos activos con alguna nota) y alumnos
export function clasificacion(grupos, alumnos, notas, c, nivel) {
  const pn = notasPorAlumno(notas);
  const gs = grupos.filter((g) => g.nivel === nivel);
  const idG = new Map(gs.map((g) => [g.id, g]));
  const ind = alumnos.filter((a) => a.activo && idG.has(a.grupo_id)).map((a) => ({ a, grupo: idG.get(a.grupo_id), ...mediaAlumno(pn.get(a.id) || {}, c) }));
  const conNota = ind.filter((x) => x.media !== null).sort((x, y) => y.media - x.media || nombre(x.a, y.a));
  const sinNota = ind.filter((x) => x.media === null).sort((x, y) => nombre(x.a, y.a));
  const ranking = [...conNota, ...sinNota].map((x, i) => ({ ...x, pos: x.media === null ? null : i + 1 }));
  const rg = gs.map((g) => {
    const ms = conNota.filter((x) => x.a.grupo_id === g.id);
    return { g, alumnos: ind.filter((x) => x.a.grupo_id === g.id).length, n: ms.length, media: ms.length ? ms.reduce((s, x) => s + x.media, 0) / ms.length : null };
  });
  const con = rg.filter((x) => x.media !== null).sort((x, y) => y.media - x.media || x.g.nombre.localeCompare(y.g.nombre, 'es'));
  const sin = rg.filter((x) => x.media === null).sort((x, y) => x.g.nombre.localeCompare(y.g.nombre, 'es'));
  return { grupos: [...con, ...sin].map((x, i) => ({ ...x, pos: x.media === null ? null : i + 1 })), ranking };
}
