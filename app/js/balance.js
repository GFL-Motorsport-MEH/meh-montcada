// Cálculos de los balances, igual que las hojas Balance, Balance Subcat y Balance Anual del Excel.
// Funciones puras (sin DOM) para poder probarlas.
import { num, MESES, mesDeFecha } from './ui.js';

export const GRUPOS_ING = ['Babies', 'Kids', 'Teens', 'Adultos', '1 to 1', 'Activities', 'Empresas'];
export const CATS_BALANCE = ['BANCO', 'MATERIAL', 'LOCAL', 'GESTORIA', 'TRABAJADORES', 'FRANQUICIA', 'SEGUROS'];
export const SUBCAT_IS = 'Impuesto Sociedades';
const esWP = (tipo) => /welcome/i.test(tipo || '');
const vacio = () => Array(12).fill(0);
const suma = (a) => a.reduce((s, v) => s + v, 0);
export const mesIdx = (g) => MESES.indexOf((g.mes || mesDeFecha(g.fecha_pago || g.fecha_factura) || '').toLowerCase());

function nombres(taxonomia) {
  const cat = new Map(), sub = new Map();
  for (const c of taxonomia) { cat.set(c.id, c.nombre); for (const s of c.subcategorias || []) sub.set(s.id, s.nombre); }
  return { cat: (g) => cat.get(g.categoria_id) || (g.categoria_texto || 'SIN CATEGORÍA').toUpperCase(), sub: (g) => sub.get(g.subcategoria_id) || g.subcategoria_texto || 'Sin subcategoría' };
}

// Balance del curso (hoja Balance)
export function calcularBalance(gastos, ingresos, taxonomia, isPct = 0.25) {
  const n = nombres(taxonomia);
  const ingGrupo = new Map(GRUPOS_ING.map((g) => [g, vacio()]));
  const wpGrupo = new Map();
  let ingSinMes = 0;
  for (const r of ingresos) {
    const v = num(r.cantidad);
    if (esWP(r.tipo)) { wpGrupo.set(r.grupo, (wpGrupo.get(r.grupo) || 0) + v); continue; }
    const i = MESES.indexOf((r.mes || '').trim().toLowerCase());
    if (i < 0) { ingSinMes += v; continue; }
    if (!ingGrupo.has(r.grupo)) ingGrupo.set(r.grupo, vacio());
    ingGrupo.get(r.grupo)[i] += v;
  }
  const gasCat = new Map(CATS_BALANCE.map((c) => [c, vacio()]));
  const is = vacio(), inv = vacio(), wpGas = vacio();
  let gasSinMes = 0;
  for (const g of gastos) {
    const v = num(g.cantidad), i = mesIdx(g), cat = n.cat(g);
    if (i < 0) { gasSinMes += v; continue; }
    if (n.sub(g) === SUBCAT_IS) is[i] += v;
    else if (cat === 'INVERSION') inv[i] += v;
    else if (cat === 'WELCOME PACK') wpGas[i] += v;
    else { if (!gasCat.has(cat)) gasCat.set(cat, vacio()); gasCat.get(cat)[i] += v; }
  }
  const totIng = vacio(), totGas = vacio();
  for (const a of ingGrupo.values()) a.forEach((v, i) => { totIng[i] += v; });
  for (const a of gasCat.values()) a.forEach((v, i) => { totGas[i] += v; });
  const wpIngTotal = suma([...wpGrupo.values()]);
  const margenWP = wpIngTotal - suma(wpGas);
  const operativo = totIng.map((v, i) => v - totGas[i]);
  const operativoAnual = suma(operativo) + margenWP;
  const real = operativo.map((v, i) => v - is[i]);
  const final = real.map((v, i) => v - inv[i]);
  return {
    isPct, ingGrupo, wpGrupo, gasCat, is, inv, wpGas, totIng, totGas, ingSinMes, gasSinMes,
    wpIngTotal, margenWP, operativo,
    anual: {
      ingresos: suma(totIng), gastos: suma(totGas), operativo: operativoAnual,
      estimado: operativoAnual * (1 - isPct), is: suma(is), real: operativoAnual - suma(is),
      inversion: suma(inv), final: operativoAnual - suma(is) - suma(inv), wpGastos: suma(wpGas),
    },
    estimado: operativo.map((v) => v * (1 - isPct)), real, final,
  };
}

// Balance por subcategorías (hoja Balance Subcat): categoría -> subcategoría -> 12 meses
export function calcularSubcategorias(gastos, taxonomia) {
  const n = nombres(taxonomia);
  const orden = new Map(taxonomia.map((c, i) => [c.nombre, i]));
  const cats = new Map();
  for (const g of gastos) {
    const i = mesIdx(g); if (i < 0) continue;
    const c = n.cat(g), s = n.sub(g);
    if (!cats.has(c)) cats.set(c, { nombre: c, meses: vacio(), subs: new Map() });
    const cc = cats.get(c);
    if (!cc.subs.has(s)) cc.subs.set(s, vacio());
    cc.subs.get(s)[i] += num(g.cantidad); cc.meses[i] += num(g.cantidad);
  }
  // incluir las subcategorías sin gasto, como el Excel
  for (const c of taxonomia) {
    if (!cats.has(c.nombre)) cats.set(c.nombre, { nombre: c.nombre, meses: vacio(), subs: new Map() });
    for (const s of c.subcategorias || []) if (!cats.get(c.nombre).subs.has(s.nombre)) cats.get(c.nombre).subs.set(s.nombre, vacio());
  }
  const lista = [...cats.values()].sort((a, b) => (orden.get(a.nombre) ?? 99) - (orden.get(b.nombre) ?? 99));
  for (const c of lista) c.subs = [...c.subs.entries()].map(([nombre, meses]) => ({ nombre, meses })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return lista;
}

// Informe tipo tabla dinámica: gastos agrupados por un campo x mes
export const DIMENSIONES = {
  categoria: { label: 'Categoría', fn: (n) => (g) => n.cat(g) },
  subcategoria: { label: 'Subcategoría', fn: (n) => (g) => `${n.cat(g)} › ${n.sub(g)}` },
  metodo_pago: { label: 'Método de pago', fn: () => (g) => g.metodo_pago || 'Sin método' },
  periodicidad: { label: 'Periodicidad', fn: () => (g) => g.periodicidad || 'Sin periodicidad' },
  empresa: { label: 'Empresa / proveedor', fn: () => (g) => g.empresa || 'Sin empresa' },
  tipo: { label: 'Tipo de documento', fn: () => (g) => g.tipo || 'Sin tipo' },
};
export function calcularInforme(gastos, taxonomia, dimension, { excluirInvWP = false } = {}) {
  const n = nombres(taxonomia);
  const clave = DIMENSIONES[dimension].fn(n);
  const filas = new Map();
  for (const g of gastos) {
    if (excluirInvWP && ['INVERSION', 'WELCOME PACK'].includes(n.cat(g))) continue;
    const i = mesIdx(g); if (i < 0) continue;
    const k = clave(g);
    if (!filas.has(k)) filas.set(k, vacio());
    filas.get(k)[i] += num(g.cantidad);
  }
  return [...filas.entries()].map(([nombre, meses]) => ({ nombre, meses, total: suma(meses) })).sort((a, b) => b.total - a.total);
}

// Balance anual comparando cursos (hoja Balance Anual)
export function calcularAnual(gastos, ingresos, taxonomia) {
  const b = calcularBalance(gastos, ingresos, taxonomia);
  const ing = new Map([...b.ingGrupo.entries()].map(([g, a]) => [g, suma(a)]));
  ing.set('Welcome Pack', b.wpIngTotal);
  const gas = new Map([...b.gasCat.entries()].map(([c, a]) => [c, suma(a)]));
  gas.set('WELCOME PACK', b.anual.wpGastos);
  const totIng = suma([...ing.values()]), totGas = suma([...gas.values()]);
  const operativo = totIng - totGas;
  return { ing, gas, totIng, totGas, operativo, is: b.anual.is, real: operativo - b.anual.is, inversion: b.anual.inversion, final: operativo - b.anual.is - b.anual.inversion };
}
