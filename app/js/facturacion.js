// Lógica de facturación (hoja Fact Meharic + macro Mod_Facturacion_Import), sin DOM.
import { num } from './ui.js';

// Columnas del Excel que exporta el CRM (pagos_alumnos_*.xlsx), en este orden.
export const COLUMNAS_CRM = ['centro', 'alumno', 'id_crm', 'fecha_pago', 'tipo_operacion', 'fecha_operacion', 'num_factura', 'num_recibo',
  'metodo_pago', 'modalidad_pago', 'descripcion', 'qty', 'cantidad', 'iva', 'importe', 'total'];
const NUMERICAS = ['qty', 'cantidad', 'iva', 'importe', 'total'];
const FECHAS = ['fecha_pago', 'fecha_operacion'];

// Misma clave que la columna generada clave_linea de la BD y que ClaveLinea() del Excel.
export function claveLinea(r) {
  const imp = r.importe === null || r.importe === undefined || r.importe === '' ? '' : num(r.importe).toFixed(2);
  return [r.id_crm ?? '', r.num_recibo ?? '', r.num_factura ?? '', r.descripcion ?? '', imp].map((v) => String(v)).join('|');
}

const pad = (n) => String(n).padStart(2, '0');
// Fecha del CRM -> 'YYYY-MM-DD' (acepta Date, número de serie de Excel, '2026-06-28 10:00', '28/06/2026')
export function aFechaISO(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}
export function aNumero(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  let s = String(v).trim().replace(/\s|€/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// filas: array de arrays (sin cabecera) tal como salen de la hoja del CRM
export function filasCRMaRegistros(filas) {
  const out = [], errores = [];
  filas.forEach((f, i) => {
    if (!f || f.every((v) => v === null || v === undefined || String(v).trim() === '')) return;
    const r = {};
    COLUMNAS_CRM.forEach((c, j) => {
      const v = f[j];
      if (NUMERICAS.includes(c)) r[c] = aNumero(v);
      else if (FECHAS.includes(c)) r[c] = aFechaISO(v);
      else r[c] = v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim();
    });
    if (!r.num_recibo && !r.num_factura && !r.id_crm) return;
    if (!r.fecha_pago) errores.push(`Fila ${i + 2}: fecha de pago no reconocida (${f[3] ?? 'vacía'})`);
    r.fecha_inicio = r.fecha_pago; r.fecha_fin = r.fecha_pago; // como el FillDown del Excel (=MID(fecha_pago))
    r.mimag_comprobacion = 'False'; r.fiscontal_comprobacion = 'False';
    out.push(r);
  });
  return { registros: out, errores };
}

// Separa nuevas de duplicadas (por clave) frente a las existentes y dentro del propio archivo
export function separarNuevas(registros, existentes) {
  const claves = new Set(existentes.map(claveLinea));
  const nuevas = [];
  let duplicadas = 0;
  for (const r of registros) {
    const k = claveLinea(r);
    if (claves.has(k)) { duplicadas++; continue; }
    claves.add(k); nuevas.push(r);
  }
  return { nuevas, duplicadas };
}

// Huecos en la numeración de recibos por serie (prefijo = todo menos los dígitos finales), como ResaltarSaltosNumRecibo
export function huecosRecibos(registros) {
  const series = new Map();
  for (const r of registros) {
    const m = String(r.num_recibo || '').trim().match(/^(.*?)(\d+)$/);
    if (!m) continue;
    if (!series.has(m[1])) series.set(m[1], new Set());
    series.get(m[1]).add(Number(m[2]));
  }
  const huecos = [];
  for (const [prefijo, set] of series) {
    const nums = [...set].sort((a, b) => a - b);
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] - nums[i - 1] > 1) huecos.push({ prefijo, despues: nums[i - 1], antes: nums[i], faltan: nums[i] - nums[i - 1] - 1 });
    }
  }
  return { series: [...series.entries()].map(([p, s]) => ({ prefijo: p, n: s.size, min: Math.min(...s), max: Math.max(...s) })), huecos };
}

// Resumen por trimestre natural de la fecha de pago: total (columna CANTIDAD, como el Excel) y por método
export const METODOS_FACT = ['Domiciliacion bancaria', 'Transferencia', 'Tarjeta', 'Efectivo'];
export function trimestreDeFecha(iso) {
  if (!iso) return null;
  return `${Math.ceil(Number(iso.slice(5, 7)) / 3)}T ${iso.slice(0, 4)}`;
}
export function resumenTrimestral(registros) {
  const t = new Map();
  for (const r of registros) {
    const k = trimestreDeFecha(r.fecha_pago); if (!k) continue;
    if (!t.has(k)) t.set(k, { trimestre: k, total: 0, lineas: 0, metodos: Object.fromEntries(METODOS_FACT.map((m) => [m, 0])), otros: 0 });
    const x = t.get(k), v = num(r.cantidad);
    x.total += v; x.lineas++;
    if (r.metodo_pago in x.metodos) x.metodos[r.metodo_pago] += v; else x.otros += v;
  }
  const orden = (k) => Number(k.slice(3)) * 10 + Number(k[0]);
  return [...t.values()].sort((a, b) => orden(a.trimestre) - orden(b.trimestre));
}

export const esVerdadero = (v) => v === true || /^(true|verdadero|1|s[ií])$/i.test(String(v ?? ''));
