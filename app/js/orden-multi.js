// Orden por varias columnas. El último clic manda y los anteriores desempatan:
// ordenar por ID y luego por Modo de pago → agrupado por modo y, dentro de cada grupo, por ID.
// La pila es una lista [{ k, dir }] (k = clave de columna, dir = 1 ascendente / -1 descendente); la primera es la principal.
export const MAX_NIVELES = 4;

// Clic en una cabecera. dirIni = sentido la primera vez (1 o -1). ciclo: a la 3.ª vez la quita (A→Z, Z→A, sin orden).
export function pulsar(pila, k, dirIni = 1, ciclo = false) {
  const i = pila.findIndex((x) => x.k === k);
  if (i === 0) {
    if (ciclo && pila[0].dir === -dirIni) return pila.slice(1);
    return [{ k, dir: -pila[0].dir }, ...pila.slice(1)];
  }
  return [{ k, dir: dirIni }, ...pila.filter((x) => x.k !== k)].slice(0, MAX_NIVELES);
}

// Comparador por toda la pila. cmp(k, x, y) devuelve el orden ascendente de x frente a y para esa columna.
export const comparar = (pila, cmp) => (x, y) => {
  for (const { k, dir } of pila) { const r = cmp(k, x, y); if (r) return r * dir; }
  return 0;
};

// Flecha de una columna: ▲/▼, con su nivel (▲2) cuando hay más de una columna ordenando.
export function flecha(pila, k) {
  const i = pila.findIndex((x) => x.k === k);
  if (i < 0) return '';
  return (pila[i].dir > 0 ? '▲' : '▼') + (pila.length > 1 ? i + 1 : '');
}
export const ariaSort = (pila, k) => (pila[0]?.k === k ? (pila[0].dir > 0 ? 'ascending' : 'descending') : 'none');

// Para guardar/leer: la pila se guarda con claves de texto (estables aunque cambie el orden de las columnas).
export const aGuardar = (pila, clave) => pila.map(({ k, dir }) => ({ k: clave(k), dir }));
export function deGuardado(lista, indice) {
  const pila = [];
  for (const x of Array.isArray(lista) ? lista : []) {
    const k = indice(x?.k);
    if (k !== undefined && k !== null && k !== -1 && !pila.some((p) => p.k === k)) pila.push({ k, dir: x.dir === -1 ? -1 : 1 });
  }
  return pila.slice(0, MAX_NIVELES);
}
