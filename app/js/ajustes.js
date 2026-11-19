// Ajustes personales de la app (cada usuario los suyos, en todos sus dispositivos): colores de pestañas, pantalla de inicio y datos en segundo plano.
import * as db from './db.js';

const LS = 'meh.ajustes';
export const AJUSTES_BASE = { colorTabs: true, coloresTabs: {}, refresco: true, inicio: 'ultimo' };
let A = { ...AJUSTES_BASE };
let alCambiar = () => {};
export const ajustes = () => A;
export const alCambiarAjustes = (fn) => { alCambiar = fn; };
const guardarLocal = () => { try { localStorage.setItem(LS, JSON.stringify(A)); } catch { /* sin almacenamiento */ } };

export async function cargarAjustes() {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(LS) || 'null'); } catch { /* */ }
  const remoto = await db.getAjustes().catch(() => null);
  A = { ...AJUSTES_BASE, ...((remoto && Object.keys(remoto).length ? remoto : local) || {}) };
  guardarLocal();
}
export function cambiarAjustes(parche) {
  A = { ...A, ...parche };
  guardarLocal();
  db.setAjustes(A).catch(() => { /* sin red: queda en este dispositivo */ });
  alCambiar();
}
