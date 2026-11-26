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
// Clave del concepto de un movimiento sin números ni palabras genéricas («COMPRA TARJ. 5540… AMAZON…» -> «amazon luxembourg»)
const GENERICAS = new Set(['compra', 'tarj', 'tarjeta', 'transferencia', 'transf', 'adeudo', 'recibo', 'factura', 'cuota', 'pago', 'servicio', 'servicios', 'cliente', 'clientes']);
const LUGARES = new Set(['murcia', 'montcada', 'alcantarilla', 'barcelona', 'madrid', 'espana', 'catalunya', 'cataluna', 'valencia', 'palmar', 'reixac', 'sabadell']);
export function claveConcepto(concepto) {
  const t = normalizar(concepto || '').split(/[^a-z0-9ñ]+/).filter((x) => x.length >= 3 && !/\d/.test(x) && !GENERICAS.has(x));
  return t.slice(0, 3).join(' ');
}
// Aprende, de lo ya enlazado a mano o automáticamente, qué empresa corresponde a cada tipo de concepto del banco
// (p. ej. «AGUA VEOLIA…» = «Hidrogea Agua Murcia»). Devuelve Map(claveConcepto -> Set(empresa normalizada)).
export function aprenderAlias(enlaces, movimientos, gastos) {
  const mp = new Map(movimientos.map((m) => [m.id, m])), gp = new Map(gastos.map((g) => [g.id, g])), out = new Map();
  for (const e of enlaces || []) {
    const m = mp.get(e.movimiento_id), g = gp.get(e.gasto_id);
    if (!m || !g || !g.empresa) continue;
    const k = claveConcepto(m.concepto); if (!k) continue;
    if (!out.has(k)) out.set(k, new Set());
    out.get(k).add(normalizar(g.empresa).trim());
  }
  return out;
}
export const nombreEnConcepto = (g, m, alias = null) => {
  const w = normalizar(g.empresa || '').split(/\s+/).find((x) => x.length >= 4 && !LUGARES.has(x)); // un lugar («Murcia») no identifica a una empresa
  if (w && normalizar(m.concepto || '').includes(w)) return true;
  const a = alias && alias.get(claveConcepto(m.concepto));
  return !!(a && a.has(normalizar(g.empresa || '').trim()));
};
// Un pago de la cuenta de un centro solo se concilia con gastos de ese centro (sin centro = el principal)
export const mismoCentro = (g, m, principal = null) => (g.centro_id || principal || null) === (m.centro_id || principal || null);

// Concilia gastos pendientes (importe > 0) con movimientos pendientes negativos, teniendo en cuenta lo que ya está enlazado.
// 1) un movimiento del mismo importe (±1 céntimo) en ±ventana días (el más cercano en fecha);
// 2) si no, la suma de 2 o 3 movimientos dentro de la ventana. Devuelve [{ gasto, movs, asignaciones: [{ mov, importe }] }]
export function conciliar(gastos, movimientos, { ventana = 20, enlaces = [], principal = null, alias = null } = {}) {
  const libres = movimientos.filter((m) => m.estado === 'pendiente' && num(m.importe) < 0 && restanteMov(m, enlaces) > 0.009)
    .map((m) => ({ m, abs: Math.round(restanteMov(m, enlaces) * 100), usado: false }));
  // Los gastos ya marcados «en banco» (p. ej. desde el Excel) pero sin enlace también se concilian: lo que cuenta es el enlace, no la marca
  const pend = gastos.filter((g) => num(g.cantidad) > 0 && fechaGasto(g) && restanteGasto(g, enlaces) > 0.009)
    .sort((a, b) => fechaGasto(a).localeCompare(fechaGasto(b)));
  const out = [], hechos = new Set();
  // 1.ª pasada: solo movimientos donde aparece el nombre de la empresa (más seguro); 2.ª: cualquiera con el mismo importe
  // Parejas de mismo importe: se asignan primero las más cercanas en fecha (con varios pagos iguales, p. ej. cuotas mensuales, cada mes con el suyo)
  const exactos = (soloNombre) => {
    const pares = [];
    for (const g of pend) {
      if (hechos.has(g.id)) continue;
      const obj = Math.round(restanteGasto(g, enlaces) * 100), fg = fechaGasto(g);
      for (const x of libres) if (!x.usado && x.abs === obj && dias(x.m.fecha, fg) <= ventana && mismoCentro(g, x.m, principal) && (!soloNombre || nombreEnConcepto(g, x.m, alias)))
        pares.push({ g, x, d: dias(x.m.fecha, fg) });
    }
    pares.sort((a, b) => a.d - b.d);
    for (const { g, x } of pares) {
      if (hechos.has(g.id) || x.usado) continue;
      hechos.add(g.id); x.usado = true;
      out.push({ gasto: g, gastos: [g], movs: [x.m], asignaciones: [{ mov: x.m, gasto: g, importe: x.abs / 100 }] });
    }
  };
  const pasada = (soloNombre) => {
    for (const g of pend) {
      if (hechos.has(g.id)) continue;
      const obj = Math.round(restanteGasto(g, enlaces) * 100), fg = fechaGasto(g);
      const cand = libres.filter((x) => !x.usado && dias(x.m.fecha, fg) <= ventana && x.abs <= obj && mismoCentro(g, x.m, principal) && (!soloNombre || nombreEnConcepto(g, x.m, alias)));
      const uno = cand.filter((x) => x.abs === obj).sort((a, b) => dias(a.m.fecha, fg) - dias(b.m.fecha, fg))[0];
      let elegidos = uno ? [uno] : null;
      if (!elegidos) {
        const c = cand.slice(0, 40);
        buscar: for (let i = 0; i < c.length; i++) {
          for (let j = i + 1; j < c.length; j++) {
            const s2 = c[i].abs + c[j].abs;
            if (s2 === obj) { elegidos = [c[i], c[j]]; break buscar; }
            if (s2 > obj) continue;
            for (let k = j + 1; k < c.length; k++) {
              if (s2 + c[k].abs === obj) { elegidos = [c[i], c[j], c[k]]; break buscar; }
            }
          }
        }
      }
      if (elegidos) { hechos.add(g.id); elegidos.forEach((x) => { x.usado = true; }); out.push({ gasto: g, gastos: [g], movs: elegidos.map((x) => x.m), asignaciones: elegidos.map((x) => ({ mov: x.m, gasto: g, importe: x.abs / 100 })) }); }
    }
  };
  exactos(true);
  pasada(true);
  // 2.ª pasada: un pago que cubre 2 o 3 facturas de la misma empresa (su nombre aparece en el concepto del movimiento)
  for (const x of libres.filter((y) => !y.usado)) {
    const c = pend.filter((g) => !hechos.has(g.id) && nombreEnConcepto(g, x.m, alias) && mismoCentro(g, x.m, principal) && dias(x.m.fecha, fechaGasto(g)) <= ventana).slice(0, 12);
    const cents = (g) => Math.round(restanteGasto(g, enlaces) * 100);
    let sel = null;
    buscar2: for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
      if (cents(c[i]) + cents(c[j]) === x.abs) { sel = [c[i], c[j]]; break buscar2; }
      for (let k = j + 1; k < c.length; k++) if (cents(c[i]) + cents(c[j]) + cents(c[k]) === x.abs) { sel = [c[i], c[j], c[k]]; break buscar2; }
    }
    if (sel) { x.usado = true; sel.forEach((g) => hechos.add(g.id)); out.push({ gasto: sel[0], gastos: sel, movs: [x.m], asignaciones: sel.map((g) => ({ mov: x.m, gasto: g, importe: cents(g) / 100 })) }); }
  }
  // (ya no hay pasada «solo por importe»: un mismo importe sin la empresa en el concepto se enlaza a mano)
  // 4.ª: un gasto de otro centro pagado desde esta cuenta (se puede pagar con la cuenta de la otra academia): solo con mismo importe Y la empresa reconocida en el concepto
  for (const g of pend) {
    if (hechos.has(g.id)) continue;
    const obj = Math.round(restanteGasto(g, enlaces) * 100), fg = fechaGasto(g);
    const x = libres.filter((y) => !y.usado && y.abs === obj && dias(y.m.fecha, fg) <= ventana && !mismoCentro(g, y.m, principal) && nombreEnConcepto(g, y.m, alias))
      .sort((a, b) => dias(a.m.fecha, fg) - dias(b.m.fecha, fg))[0];
    if (x) { hechos.add(g.id); x.usado = true; out.push({ gasto: g, gastos: [g], movs: [x.m], otroCentro: true, asignaciones: [{ mov: x.m, gasto: g, importe: x.abs / 100 }] }); }
  }
  return out;
}

// Devoluciones: movimientos positivos cuyo concepto dice DEVOLUCIÓN se enlazan solos con el abono / nota de crédito (gasto negativo)
// del mismo importe. Si hay varios posibles se prefiere el de la misma empresa y la fecha más cercana.
export function conciliarDevoluciones(gastos, movimientos, { ventana = 90, enlaces = [], principal = null, alias = null } = {}) {
  const cobros = movimientos.filter((m) => m.estado === 'pendiente' && num(m.importe) > 0 && esDevolucion(m) && restanteMov(m, enlaces) > 0.009)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const abonos = gastos.filter((g) => esAbono(g) && !g.check_banca && fechaGasto(g) && restanteGasto(g, enlaces) > 0.009).map((g) => ({ g, usado: false }));
  const out = [];
  for (const m of cobros) {
    const imp = restanteMov(m, enlaces);
    const cand = abonos.filter((x) => !x.usado && Math.round(restanteGasto(x.g, enlaces) * 100) === Math.round(imp * 100) && dias(fechaGasto(x.g), m.fecha) <= ventana && mismoCentro(x.g, m, principal))
      .sort((a, b) => Number(nombreEnConcepto(b.g, m, alias)) - Number(nombreEnConcepto(a.g, m, alias)) || dias(fechaGasto(a.g), m.fecha) - dias(fechaGasto(b.g), m.fecha));
    if (cand[0]) { cand[0].usado = true; out.push({ gasto: cand[0].g, gastos: [cand[0].g], movs: [m], asignaciones: [{ mov: m, gasto: cand[0].g, importe: imp }] }); }
  }
  return out;
}

// Por qué un gasto se propone para un movimiento (para mostrarlo en la ventana de enlazar)
export function motivoGasto(g, mov, enlaces = [], alias = null) {
  const imp = Math.abs(num(mov.importe)), rest = restanteGasto(g, enlaces), f = fechaGasto(g);
  const m = [];
  if (Math.abs(rest - imp) <= 0.01) m.push('mismo importe'); else if (rest < imp - 0.01) m.push('importe menor (puede ser parte)');
  if (nombreEnConcepto(g, mov, alias)) m.push('empresa en el concepto');
  if (f) { const d = Math.round(dias(f, mov.fecha)); m.push(d === 0 ? 'mismo día' : `${d} día${d === 1 ? '' : 's'}`); }
  return m.join(' · ');
}
// Búsqueda manual: gastos que puede pagar este movimiento (pago -> facturas; cobro/devolución -> abonos).
// Sin texto solo salen los candidatos claros: mismo importe o empresa reconocida en el concepto, del mismo centro y de fechas cercanas.
// Los importes tienen que coincidir exactamente. otrosCentros: incluye gastos de otros centros. Con texto busca en todos los gastos del centro.
export function gastosParaMov(mov, gastos, enlaces, q = '', { limite = 40, principal = null, alias = null, otrosCentros = false, ventana = 90 } = {}) {
  const signo = num(mov.importe) < 0 ? 1 : -1, imp = Math.abs(num(mov.importe)), nq = normalizar(String(q).trim());
  const puntos = (g) => {
    const rest = restanteGasto(g, enlaces), f = fechaGasto(g);
    return (Math.abs(rest - imp) <= 0.01 ? 4 : 0) + (nombreEnConcepto(g, mov, alias) ? 3 : 0) - (f ? Math.min(dias(f, mov.fecha), 365) / 400 : 0.9);
  };
  const claro = (g) => {
    const rest = restanteGasto(g, enlaces), f = fechaGasto(g);
    if (f && dias(f, mov.fecha) > ventana) return false;
    if (Math.abs(rest - imp) <= 0.01 || nombreEnConcepto(g, mov, alias)) return true;
    return false;
  };
  return gastos.filter((g) => Math.sign(num(g.cantidad)) === signo && restanteGasto(g, enlaces) > 0.009
    && (otrosCentros || mismoCentro(g, mov, principal))
    && (nq ? normalizar(`${g.empresa} ${g.concepto} ${g.factura_nr} ${num(g.cantidad).toFixed(2).replace('.', ',')} ${g.cantidad}`).includes(nq) : claro(g)))
    .sort((a, b) => puntos(b) - puntos(a))
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

// ---------- ingresos de remesas (solo totales) ----------
// Banco de una cuenta: por el texto «banco»/nombre o por el código de entidad del IBAN (0182 BBVA, 0081 Sabadell)
export function bancoDeCuenta(c) {
  const iban = (c?.iban || '').replace(/\s/g, '').toUpperCase(); const t = normalizar(`${c?.banco || ''} ${c?.nombre || ''}`);
  if (/bbva/.test(t) || iban.slice(4, 8) === '0182') return 'BBVA';
  if (/sabadell/.test(t) || iban.slice(4, 8) === '0081') return 'SABADELL';
  return null;
}
export const esperadoRemesas = (env, banco, remesa = null) => r2((env?.resumen || []).filter((x) => x.banco === banco && (!remesa || x.remesa_nombre === remesa)).reduce((s, x) => s + num(x.total), 0));
export const ingresadoRemesas = (movRemesas, env, banco, remesa = null) => r2(movRemesas.filter((x) => x.curso_id === env.curso_id && x.mes === env.mes && x.banco === banco && (!remesa || x.remesa_nombre === remesa)).reduce((s, x) => s + num(x.importe), 0));
// importe asignado en valor absoluto (un enlace negativo es una devolución de recibos: el movimiento del banco también es negativo)
export const asignadoRemesasMov = (m, movRemesas) => r2(movRemesas.filter((x) => x.movimiento_id === m.id).reduce((s, x) => s + Math.abs(num(x.importe)), 0));
// Propone enlazar ingresos con el total esperado de un envío (solo grupos sin ingresos aún y movimientos sin ningún enlace):
// 1) un único ingreso con el mismo total (o el de una remesa de BBVA); 2) varios ingresos con «remesa/adeudos/recibos» en el concepto que suman el total.
export function sugerirRemesas(envios, movimientos, { movRemesas = [], enlaces = [], cuentas = [], ventana = 75 } = {}) {
  const cta = new Map(cuentas.map((c) => [c.id, c]));
  const libres = movimientos.filter((m) => m.estado === 'pendiente' && num(m.importe) > 0 && !esDevolucion(m)
    && !enlaces.some((e) => e.movimiento_id === m.id) && !movRemesas.some((x) => x.movimiento_id === m.id));
  const usados = new Set(); const out = [];
  const cands = (env, banco) => { const f0 = Date.parse((env.enviado_el || '').slice(0, 10));
    return libres.filter((m) => !usados.has(m.id) && (() => { const d = (Date.parse(m.fecha) - f0) / 86400000; return d >= -7 && d <= ventana; })()
      && [null, banco].includes(bancoDeCuenta(cta.get(m.cuenta_id)))); };
  const unico = (lista, esp) => { const e = lista.filter((m) => Math.abs(num(m.importe) - esp) <= 0.01); return e.length === 1 ? e[0] : null; };
  for (const env of [...envios].sort((a, b) => (a.enviado_el || '').localeCompare(b.enviado_el || ''))) {
    for (const banco of ['SABADELL', 'BBVA']) {
      const esp = esperadoRemesas(env, banco);
      if (esp <= 0 || ingresadoRemesas(movRemesas, env, banco) > 0) continue;
      const base = { curso_id: env.curso_id, mes: env.mes, banco };
      const lista = cands(env, banco);
      const uno = unico(lista, esp);
      if (uno) { usados.add(uno.id); out.push({ ...base, total: esp, movs: [uno], asignaciones: [{ mov: uno, importe: num(uno.importe), remesa_nombre: null }] }); continue; }
      const kw = lista.filter((m) => /remesa|adeudo|recibo|sepa|domicili/.test(normalizar(m.concepto || '')));
      if (kw.length > 1 && Math.abs(r2(kw.reduce((s, m) => s + num(m.importe), 0)) - esp) <= 0.01) {
        kw.forEach((m) => usados.add(m.id)); out.push({ ...base, total: esp, movs: kw, asignaciones: kw.map((m) => ({ mov: m, importe: num(m.importe), remesa_nombre: null })) }); continue;
      }
      if (banco === 'BBVA') { // BBVA ingresa cada remesa por separado
        const asig = [];
        for (const r of env.resumen.filter((x) => x.banco === 'BBVA' && num(x.total) > 0)) {
          const m = unico(cands(env, 'BBVA').filter((x) => bancoDeCuenta(cta.get(x.cuenta_id)) === 'BBVA'), num(r.total));
          if (m) { usados.add(m.id); asig.push({ mov: m, importe: num(m.importe), remesa_nombre: r.remesa_nombre }); }
        }
        if (asig.length) out.push({ ...base, total: r2(asig.reduce((s, x) => s + x.importe, 0)), movs: asig.map((x) => x.mov), asignaciones: asig });
      }
    }
  }
  return out;
}
