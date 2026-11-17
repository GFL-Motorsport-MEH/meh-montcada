// Historial de deshacer de esta sesión (botón «Deshacer» y Ctrl+Z fuera de los campos de texto).
// Cada cambio guardado en la base de datos registra cómo volver atrás. Se guardan los últimos 50.
const pila = [];
const MAX = 50;
const subs = new Set();
let grupo = null;
let alDeshacer = () => {};

const avisar = () => subs.forEach((cb) => cb(ultimo()));
export const ultimo = () => pila.at(-1) || null;
export function suscribir(cb) { subs.add(cb); cb(ultimo()); return () => subs.delete(cb); }
export function alTerminar(cb) { alDeshacer = cb; }

// registra una acción: texto para el botón y función que la revierte
export function registrar(texto, revertir) {
  if (grupo) { grupo.pasos.push(revertir); if (!grupo.texto) grupo.texto = texto; return; }
  pila.push({ texto, pasos: [revertir] });
  if (pila.length > MAX) pila.shift();
  avisar();
}

// agrupa varias acciones (p.ej. marcar 20 gastos de golpe) en un solo paso de deshacer
export async function agrupar(texto, fn) {
  if (grupo) return fn();
  grupo = { texto, pasos: [] };
  try { return await fn(); } finally {
    const g = grupo; grupo = null;
    if (g.pasos.length) { pila.push({ texto: g.texto, pasos: g.pasos }); if (pila.length > MAX) pila.shift(); avisar(); }
  }
}

let enCurso = false;
export async function deshacer() {
  const e = pila.pop();
  if (!e || enCurso) { if (e) pila.push(e); return null; }
  enCurso = true; avisar();
  try {
    for (const paso of [...e.pasos].reverse()) await paso();
    await alDeshacer(e);
    return e;
  } catch (ex) {
    pila.push(e);
    throw ex;
  } finally { enCurso = false; avisar(); }
}

export const vaciar = () => { pila.length = 0; avisar(); };
