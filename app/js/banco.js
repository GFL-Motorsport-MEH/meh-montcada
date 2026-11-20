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

// ---------- enlaces movimiento <-> gasto (tabla movimiento_gastos) ----------
// Un gasto puede estar pagado con varios movimientos y un movimiento puede pagar varios gastos: cada enlace guarda el importe
// (siempre positivo) que ese movimiento cubre de ese gasto. Los abonos son gastos con importe negativo y se enlazan con el
// movimiento positivo de la devolución.
const r2 = (n) => Math.round(n * 100) / 100;
export const asignadoGasto = (g, enlaces) => r2(enlaces.filter((e) => e.gasto_id === g.id).reduce((s, e) => s + num(e.importe), 0));
export const asignadoMov = (m, enlaces) => r2(enlaces.filter((e) => e.movimiento_id === m.id).reduce((s, e) => s + num(e.importe), 0));
export const restanteGasto = (g, enlaces) => r2(Math.abs(num(g.cantidad)) - asignadoGasto(g, enlaces));
export const restanteMov = (m, enlaces) => r2(Math.abs(num(m.importe)) - asignadoMov(m, enlaces));
export const esAbono = (g) => num(g.cantidad) < 0;
export const esDevolucion = (m) => /devoluc/.test(normalizar(m.concepto || ''));
const nombreEnConcepto = (g, m) => {
  const w = normalizar(g.empresa || '').split(/\s+/).find((x) => x.length >= 4);
  return !!w && normalizar(m.concepto || '').includes(w);
};

// Concilia gastos pendientes (importe > 0) con movimientos pendientes negativos, teniendo en cuenta lo que ya está enlazado.
// 1) un movimiento del mismo importe (±1 céntimo) en ±ventana días (el más cercano en fecha);
// 2) si no, la suma de 2 o 3 movimientos dentro de la ventana. Devuelve [{ gasto, movs, asignaciones: [{ mov, importe }] }]
export function conciliar(gastos, movimientos, { ventana = 20, enlaces = [] } = {}) {
  const libres = movimientos.filter((m) => m.estado === 'pendiente' && num(m.importe) < 0 && restanteMov(m, enlaces) > 0.009)
    .map((m) => ({ m, abs: Math.round(restanteMov(m, enlaces) * 100), usado: false }));
  const pend = gastos.filter((g) => !g.check_banca && num(g.cantidad) > 0 && fechaGasto(g) && restanteGasto(g, enlaces) > 0.009)
    .sort((a, b) => fechaGasto(a).localeCompare(fechaGasto(b)));
  const out = [], hechos = new Set();
  // 1.ª pasada: solo movimientos donde aparece el nombre de la empresa (más seguro); 2.ª: cualquiera con el mismo importe
  const pasada = (soloNombre) => {
    for (const g of pend) {
      if (hechos.has(g.id)) continue;
      const obj = Math.round(restanteGasto(g, enlaces) * 100), fg = fechaGasto(g);
      const cand = libres.filter((x) => !x.usado && dias(x.m.fecha, fg) <= ventana && x.abs <= obj + 1 && (!soloNombre || nombreEnConcepto(g, x.m)));
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
      if (elegidos) { hechos.add(g.id); elegidos.forEach((x) => { x.usado = true; }); out.push({ gasto: g, gastos: [g], movs: elegidos.map((x) => x.m), asignaciones: elegidos.map((x) => ({ mov: x.m, gasto: g, importe: x.abs / 100 })) }); }
    }
  };
  pasada(true);
  // 2.ª pasada: un pago que cubre 2 o 3 facturas de la misma empresa (su nombre aparece en el concepto del movimiento)
  for (const x of libres.filter((y) => !y.usado)) {
    const c = pend.filter((g) => !hechos.has(g.id) && nombreEnConcepto(g, x.m) && dias(x.m.fecha, fechaGasto(g)) <= ventana).slice(0, 12);
    const cents = (g) => Math.round(restanteGasto(g, enlaces) * 100);
    let sel = null;
    buscar2: for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
      if (Math.abs(cents(c[i]) + cents(c[j]) - x.abs) <= 1) { sel = [c[i], c[j]]; break buscar2; }
      for (let k = j + 1; k < c.length; k++) if (Math.abs(cents(c[i]) + cents(c[j]) + cents(c[k]) - x.abs) <= 1) { sel = [c[i], c[j], c[k]]; break buscar2; }
    }
    if (sel) { x.usado = true; sel.forEach((g) => hechos.add(g.id)); out.push({ gasto: sel[0], gastos: sel, movs: [x.m], asignaciones: sel.map((g) => ({ mov: x.m, gasto: g, importe: cents(g) / 100 })) }); }
  }
  pasada(false);   // 3.ª: cualquier movimiento con el mismo importe y fecha cercana
  return out;
}

// Devoluciones: movimientos positivos cuyo concepto dice DEVOLUCIÓN se enlazan solos con el abono / nota de crédito (gasto negativo)
// del mismo importe. Si hay varios posibles se prefiere el de la misma empresa y la fecha más cercana.
export function conciliarDevoluciones(gastos, movimientos, { ventana = 90, enlaces = [] } = {}) {
  const cobros = movimientos.filter((m) => m.estado === 'pendiente' && num(m.importe) > 0 && esDevolucion(m) && restanteMov(m, enlaces) > 0.009)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const abonos = gastos.filter((g) => esAbono(g) && !g.check_banca && fechaGasto(g) && restanteGasto(g, enlaces) > 0.009).map((g) => ({ g, usado: false }));
  const out = [];
  for (const m of cobros) {
    const imp = restanteMov(m, enlaces);
    const cand = abonos.filter((x) => !x.usado && Math.abs(restanteGasto(x.g, enlaces) - imp) <= 0.01 && dias(fechaGasto(x.g), m.fecha) <= ventana)
      .sort((a, b) => Number(nombreEnConcepto(b.g, m)) - Number(nombreEnConcepto(a.g, m)) || dias(fechaGasto(a.g), m.fecha) - dias(fechaGasto(b.g), m.fecha));
    if (cand[0]) { cand[0].usado = true; out.push({ gasto: cand[0].g, gastos: [cand[0].g], movs: [m], asignaciones: [{ mov: m, gasto: cand[0].g, importe: imp }] }); }
  }
  return out;
}

// Búsqueda manual: gastos que puede pagar este movimiento (pago -> facturas; cobro/devolución -> abonos). Con texto busca en todos.
export function gastosParaMov(mov, gastos, enlaces, q = '', { limite = 40 } = {}) {
  const signo = num(mov.importe) < 0 ? 1 : -1, imp = Math.abs(num(mov.importe)), nq = normalizar(String(q).trim());
  return gastos.filter((g) => Math.sign(num(g.cantidad)) === signo && restanteGasto(g, enlaces) > 0.009
    && (!nq || normalizar(`${g.empresa} ${g.concepto} ${g.factura_nr} ${num(g.cantidad).toFixed(2).replace('.', ',')} ${g.cantidad}`).includes(nq)))
    .sort((a, b) => Number(nombreEnConcepto(b, mov)) - Number(nombreEnConcepto(a, mov))
      || Math.abs(restanteGasto(a, enlaces) - imp) - Math.abs(restanteGasto(b, enlaces) - imp)
      || dias(fechaGasto(a) || mov.fecha, mov.fecha) - dias(fechaGasto(b) || mov.fecha, mov.fecha))
    .slice(0, limite);
}
// Búsqueda manual desde un gasto (p. ej. un abono): movimientos del banco que lo pueden cubrir (abono -> ingresos del banco)
export function movsParaGasto(gasto, movimientos, enlaces, q = '', { limite = 40 } = {}) {
  const signo = num(gasto.cantidad) > 0 ? -1 : 1, imp = Math.abs(num(gasto.cantidad)), nq = normalizar(String(q).trim());
  const fg = fechaGasto(gasto);
  return movimientos.filter((m) => m.estado !== 'ignorado' && Math.sign(num(m.importe)) === signo && restanteMov(m, enlaces) > 0.009
    && (!nq || normalizar(`${m.concepto} ${fmtImp(m.importe)} ${m.importe} ${m.fecha}`).includes(nq)))
    .sort((a, b) => Number(esDevolucion(b)) - Number(esDevolucion(a)) || Number(nombreEnConcepto(gasto, b)) - Number(nombreEnConcepto(gasto, a))
      || Math.abs(restanteMov(a, enlaces) - imp) - Math.abs(restanteMov(b, enlaces) - imp) || (fg ? dias(a.fecha, fg) - dias(b.fecha, fg) : 0))
    .slice(0, limite);
}
const fmtImp = (n) => Math.abs(num(n)).toFixed(2).replace('.', ',');

// Resumen de la conciliación para la gestoría: una fila por enlace con el tipo de situación, y listas aparte de los casos especiales.
export function resumenConciliacion({ gastos, movimientos, enlaces }) {
  const gPorId = new Map(gastos.map((g) => [g.id, g])), mPorId = new Map(movimientos.map((m) => [m.id, m]));
  const nPorGasto = new Map(), nPorMov = new Map();
  for (const e of enlaces) { nPorGasto.set(e.gasto_id, (nPorGasto.get(e.gasto_id) || 0) + 1); nPorMov.set(e.movimiento_id, (nPorMov.get(e.movimiento_id) || 0) + 1); }
  const filas = [];
  for (const e of enlaces) {
    const g = gPorId.get(e.gasto_id), m = mPorId.get(e.movimiento_id);
    if (!g || !m) continue;
    const multiPagos = nPorGasto.get(g.id) > 1, multiFacturas = nPorMov.get(m.id) > 1;
    const situacion = esAbono(g) ? 'Abono ↔ devolución' : multiPagos && multiFacturas ? 'Varios pagos ↔ varias facturas' : multiPagos ? '1 factura pagada en varios pagos' : multiFacturas ? '1 pago de varias facturas' : '1 pago ↔ 1 factura';
    filas.push({ situacion, g, m, importe: num(e.importe), pendienteGasto: restanteGasto(g, enlaces), pendienteMov: restanteMov(m, enlaces) });
  }
  const abonos = gastos.filter(esAbono).map((g) => ({ g, cobrado: asignadoGasto(g, enlaces), pendiente: restanteGasto(g, enlaces) }));
  const parciales = gastos.filter((g) => asignadoGasto(g, enlaces) > 0.009 && restanteGasto(g, enlaces) > 0.009);
  return { filas, abonos, parciales,
    variosPagos: filas.filter((f) => /varios pagos|en varios pagos/.test(f.situacion)), variosFacturas: filas.filter((f) => /varias facturas/.test(f.situacion)) };
}

// Candidatos para vincular a mano un movimiento: gastos pendientes con importe parecido y fecha cercana
export function candidatosGasto(mov, gastos, { ventana = 45 } = {}) {
  const imp = Math.abs(num(mov.importe));
  return gastos.filter((g) => !g.check_banca && fechaGasto(g) && dias(fechaGasto(g), mov.fecha) <= ventana && Math.abs(num(g.cantidad) - imp) <= Math.max(0.01, imp * 0.02))
    .sort((a, b) => Math.abs(num(a.cantidad) - imp) - Math.abs(num(b.cantidad) - imp) || dias(fechaGasto(a), mov.fecha) - dias(fechaGasto(b), mov.fecha))
    .slice(0, 8);
}
