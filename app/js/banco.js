// Extractos bancarios y conciliación con los gastos (Mod_Conciliacion_Bancaria del Excel), sin DOM.
import { num, normalizar } from './ui.js';
import { aFechaISO, aNumero } from './facturacion.js';

const COLS = {
  fecha: /^(f\.?\s*contable|f\.?\s*operativa|fecha( (de )?operaci[oó]n| contable)?|date)$/,
  fecha_valor: /valor/,
  concepto: /^(concepto|descripci[oó]n|description|movimiento)/,
  concepto2: /beneficiario|ordenante|observaci|m[aá]s datos|detalle|referencia/,
  importe: /^(importe|cantidad|amount)/,
  debe: /^(debe|cargo|cargos)$/,
  haber: /^(haber|abono|abonos)$/,
  saldo: /saldo|balance/,
};

// filas: array de arrays (la hoja tal cual). Devuelve { banco, movimientos, cabecera (texto de las filas de arriba), errores }
export function parsearExtracto(filas) {
  let fc = -1, map = null;
  for (let i = 0; i < Math.min(filas.length, 40); i++) {
    const cab = (filas[i] || []).map((c) => normalizar(String(c ?? '')).trim().replace(/\s+/g, ' '));
    const idx = (re, excl) => cab.findIndex((c, j) => c && re.test(c) && !(excl || []).includes(j));
    const f = idx(COLS.fecha);
    const imp = idx(COLS.importe), debe = idx(COLS.debe), haber = idx(COLS.haber);
    if (f >= 0 && (imp >= 0 || (debe >= 0 && haber >= 0))) {
      fc = i;
      map = { fecha: f, fecha_valor: idx(COLS.fecha_valor, [f]), concepto: idx(COLS.concepto), concepto2: idx(COLS.concepto2), importe: imp, debe, haber, saldo: idx(COLS.saldo) };
      break;
    }
  }
  if (fc < 0) return { banco: null, movimientos: [], cabecera: '', errores: ['No encuentro la fila de cabeceras (fecha e importe).'] };
  const cabTxt = normalizar(String((filas[fc] || []).join(' ')));
  const banco = /f\.? ?contable/.test(cabTxt) ? 'BBVA' : /f\.? ?operativa/.test(cabTxt) ? 'SABADELL' : null;
  const cabecera = filas.slice(0, fc).map((f) => (f || []).filter((v) => v !== null && v !== '').join(' ')).join(' \n ');
  const movimientos = [], errores = [];
  for (let i = fc + 1; i < filas.length; i++) {
    const f = filas[i] || [];
    if (f.every((v) => v === null || v === undefined || String(v).trim() === '')) continue;
    const fecha = aFechaISO(f[map.fecha]);
    let importe = map.importe >= 0 ? aNumero(f[map.importe]) : (aNumero(f[map.haber]) || 0) - (aNumero(f[map.debe]) || 0);
    if (!fecha || importe === null || Number.isNaN(importe)) {
      if (fecha || importe) errores.push(`Fila ${i + 1}: ${!fecha ? 'fecha' : 'importe'} no reconocido`);
      continue;
    }
    const concepto = [map.concepto >= 0 ? f[map.concepto] : null, map.concepto2 >= 0 ? f[map.concepto2] : null]
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== '').map((v) => String(v).trim()).join(' - ');
    movimientos.push({ fecha, fecha_valor: map.fecha_valor >= 0 ? aFechaISO(f[map.fecha_valor]) : null, concepto: concepto || null,
      importe: Math.round(importe * 100) / 100, saldo: map.saldo >= 0 ? aNumero(f[map.saldo]) : null });
  }
  return { banco, movimientos, cabecera, errores };
}

// Clave para no duplicar al reimportar: fecha|importe|concepto|nº de repetición dentro del archivo
export function ponerClaves(movs) {
  const vistos = new Map();
  return movs.map((m) => {
    const base = `${m.fecha}|${m.importe.toFixed(2)}|${normalizar(m.concepto || '').replace(/\s+/g, ' ').trim()}`;
    const n = (vistos.get(base) || 0) + 1; vistos.set(base, n);
    return { ...m, clave: `${base}|${n}` };
  });
}

const soloDigitos = (s) => String(s || '').replace(/[^0-9A-Z]/gi, '').toUpperCase();
// Busca a qué cuenta pertenece el archivo: IBAN o referencia de la cuenta que aparezca en las filas de arriba (o en el nombre)
export function cuentaDeArchivo(texto, cuentas) {
  const t = soloDigitos(texto);
  return cuentas.find((c) => {
    const iban = soloDigitos(c.iban);
    const ref = soloDigitos(c.referencia);
    return (iban && (t.includes(iban) || t.includes(iban.slice(4)) || (iban.length > 10 && t.includes(iban.slice(-10))))) || (ref && ref.length >= 4 && t.includes(ref));
  }) || null;
}

const dias = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);
const fechaGasto = (g) => g.fecha_pago || g.fecha_factura;

// Concilia gastos pendientes (sin check_banca, importe > 0) con movimientos pendientes negativos.
// 1) un movimiento del mismo importe (±1 céntimo) en ±ventana días (el más cercano en fecha);
// 2) si no, la suma de 2 o 3 movimientos dentro de la ventana. Devuelve [{ gasto, movs }]
export function conciliar(gastos, movimientos, { ventana = 20 } = {}) {
  const libres = movimientos.filter((m) => m.estado === 'pendiente' && num(m.importe) < 0)
    .map((m) => ({ m, abs: Math.round(-num(m.importe) * 100), usado: false }));
  const pend = gastos.filter((g) => !g.check_banca && num(g.cantidad) > 0 && fechaGasto(g))
    .sort((a, b) => fechaGasto(a).localeCompare(fechaGasto(b)));
  const out = [];
  for (const g of pend) {
    const obj = Math.round(num(g.cantidad) * 100), fg = fechaGasto(g);
    const cand = libres.filter((x) => !x.usado && dias(x.m.fecha, fg) <= ventana && x.abs <= obj + 1);
    const uno = cand.filter((x) => Math.abs(x.abs - obj) <= 1).sort((a, b) => dias(a.m.fecha, fg) - dias(b.m.fecha, fg))[0];
    let elegidos = uno ? [uno] : null;
    if (!elegidos) {
      const c = cand.slice(0, 40);
      buscar: for (let i = 0; i < c.length; i++) {
        for (let j = i + 1; j < c.length; j++) {
          const s2 = c[i].abs + c[j].abs;
          if (Math.abs(s2 - obj) <= 1) { elegidos = [c[i], c[j]]; break buscar; }
          if (s2 > obj + 1) continue;
          for (let k = j + 1; k < c.length; k++) {
            if (Math.abs(s2 + c[k].abs - obj) <= 1) { elegidos = [c[i], c[j], c[k]]; break buscar; }
          }
        }
      }
    }
    if (elegidos) { elegidos.forEach((x) => { x.usado = true; }); out.push({ gasto: g, movs: elegidos.map((x) => x.m) }); }
  }
  return out;
}

// Candidatos para vincular a mano un movimiento: gastos pendientes con importe parecido y fecha cercana
export function candidatosGasto(mov, gastos, { ventana = 45 } = {}) {
  const imp = Math.abs(num(mov.importe));
  return gastos.filter((g) => !g.check_banca && fechaGasto(g) && dias(fechaGasto(g), mov.fecha) <= ventana && Math.abs(num(g.cantidad) - imp) <= Math.max(0.01, imp * 0.02))
    .sort((a, b) => Math.abs(num(a.cantidad) - imp) - Math.abs(num(b.cantidad) - imp) || dias(fechaGasto(a), mov.fecha) - dias(fechaGasto(b), mov.fecha))
    .slice(0, 8);
}
