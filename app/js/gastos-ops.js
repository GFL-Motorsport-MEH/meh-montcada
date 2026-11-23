// Operaciones sobre gastos sin DOM: dividir entre meses o centros y generar gastos desde plantillas.
import { num, MESES, capitalizar } from './ui.js';

// Reparte un importe en partes (en céntimos, sin perder ninguno). pesos: array de pesos (p.ej. [1,1,1] o [60,40]).
export function repartir(total, pesos) {
  const cent = Math.round(num(total) * 100);
  const suma = pesos.reduce((a, b) => a + b, 0);
  if (!suma) return pesos.map(() => 0);
  const partes = pesos.map((p) => Math.floor((cent * p) / suma));
  let resto = cent - partes.reduce((a, b) => a + b, 0);
  for (let i = 0; resto > 0; i = (i + 1) % partes.length) { if (pesos[i]) { partes[i]++; resto--; } }
  return partes.map((c) => c / 100);
}

const CAMPOS_COPIA = ['curso_id', 'tipo', 'empresa', 'factura_nr', 'fecha_factura', 'pago', 'concepto', 'fecha_pago', 'link_factura',
  'categoria_id', 'subcategoria_id', 'categoria_texto', 'subcategoria_texto', 'periodicidad', 'metodo_pago', 'comentarios',
  'nif', 'iban', 'swift', 'check_banca', 'fiscontal', 'fiscontal_fecha', 'sin_factura', 'centro_id', 'mes'];
const copia = (g) => Object.fromEntries(CAMPOS_COPIA.filter((c) => c in g).map((c) => [c, g[c]]));
export const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

// Devuelve { original: cambios para el gasto original, nuevos: [gastos a crear] }
export function dividirEnMeses(g, meses) {
  const orden = [...meses].sort((a, b) => MESES.indexOf(a) - MESES.indexOf(b));
  const importes = repartir(g.cantidad, orden.map(() => 1));
  const division_id = g.division_id || nuevoId();
  const n = orden.length;
  const base = (g.concepto || '').replace(/\s*\(\d+\/\d+\)$/, '');
  const parte = (i) => ({ mes: orden[i], cantidad: importes[i], concepto: `${base} (${i + 1}/${n})`.trim(), division_id });
  return { original: parte(0), nuevos: orden.slice(1).map((_, k) => ({ ...copia(g), ...parte(k + 1) })) };
}

// repartos: [{ centro_id, peso }]
export function dividirEnCentros(g, repartos, nombreCentro = (id) => id) {
  const importes = repartir(g.cantidad, repartos.map((r) => num(r.peso)));
  const division_id = g.division_id || nuevoId();
  const base = (g.concepto || '').replace(/\s*\[[^\]]*\]$/, '');
  const parte = (i) => ({ centro_id: repartos[i].centro_id, cantidad: importes[i], concepto: `${base} [${nombreCentro(repartos[i].centro_id)}]`.trim(), division_id });
  return { original: parte(0), nuevos: repartos.slice(1).map((_, k) => ({ ...copia(g), ...parte(k + 1) })) };
}

// Fecha dentro del mes del curso (sep-dic = año de inicio; ene-ago = año siguiente)
export function fechaEnMes(curso, mes, dia = 1) {
  const y0 = Number((curso.fecha_inicio || curso.nombre).slice(0, 4));
  const i = MESES.indexOf(mes);
  const anio = i <= 3 ? y0 : y0 + 1;
  const m = ((i + 8) % 12) + 1;
  const ultimo = new Date(anio, m, 0).getDate();
  return `${anio}-${String(m).padStart(2, '0')}-${String(Math.min(Math.max(1, dia || 1), ultimo)).padStart(2, '0')}`;
}

const clave = (empresa, concepto, mes) => `${(empresa || '').trim().toLowerCase()}|${(concepto || '').trim().toLowerCase()}|${mes}`;

// Propuesta de gastos del mes a partir de las plantillas activas. existentes: gastos del curso (para avisar de duplicados)
export function propuestaDesdePlantillas(plantillas, { curso, mes, existentes, centroPorDefecto }) {
  const ya = new Set(existentes.map((g) => clave(g.empresa, g.concepto, g.mes)));
  return plantillas.filter((p) => p.activo !== false).map((p) => {
    const concepto = (p.concepto || '').replace(/\{mes\}/gi, capitalizar(mes)) || `${p.empresa} ${capitalizar(mes)}`;
    const fecha = fechaEnMes(curso, mes, p.dia_pago);
    const gasto = {
      curso_id: curso.id, mes, empresa: p.empresa, concepto, cantidad: num(p.cantidad), tipo: p.tipo || (p.grupo === 'nomina' ? 'Nomina' : 'Factura'),
      categoria_id: p.categoria_id || null, subcategoria_id: p.subcategoria_id || null, metodo_pago: p.metodo_pago || null,
      periodicidad: p.periodicidad || 'Mensual', fecha_factura: fecha, fecha_pago: null, pago: 'False', fiscontal: 'False',
      check_banca: false, sin_factura: false, centro_id: p.centro_id || centroPorDefecto || null,
    };
    return { plantilla: p, gasto, duplicado: ya.has(clave(gasto.empresa, gasto.concepto, mes)) };
  });
}

// Sugerencias de plantillas: gastos que se repiten (misma empresa y subcategoría) en al menos `minMeses` meses del curso
export function sugerirPlantillas(gastos, plantillas, minMeses = 5) {
  // Solo lo que se repite de verdad: aparece en >= minMeses meses, más o menos una vez al mes (las nóminas pueden tener extras),
  // y sigue vivo (último pago en los 4 últimos meses con datos). De cada mes se toma el pago principal (el mayor).
  const ya = new Set(plantillas.map((p) => `${p.empresa.toLowerCase()}|${p.subcategoria_id || ''}`));
  const fecha = (g) => g.fecha_pago || g.fecha_factura || '';
  const fMax = gastos.reduce((m, g) => (fecha(g) > m ? fecha(g) : m), '');
  const limite = fMax ? new Date(new Date(fMax).getTime() - 120 * 864e5).toISOString().slice(0, 10) : '';
  const grupos = new Map();
  for (const g of gastos) {
    if (!g.empresa || !g.mes) continue;
    const k = `${g.empresa.trim().toLowerCase()}|${g.subcategoria_id || ''}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(g);
  }
  const out = [];
  for (const [k, lista] of grupos) {
    if (ya.has(k)) continue;
    const porMes = new Map();
    for (const g of lista) { const a = porMes.get(g.mes); if (!a || num(g.cantidad) > num(a.cantidad)) porMes.set(g.mes, g); }
    if (porMes.size < minMeses) continue;
    const principales = [...porMes.values()].sort((a, b) => fecha(b).localeCompare(fecha(a)));
    const importes = principales.map((g) => num(g.cantidad)).sort((a, b) => a - b);
    const mediana = importes[Math.floor(importes.length / 2)];
    // El último mes "normal" (evita coger un mes a medias, p.ej. solo un extra o un 0)
    const ult = principales.find((g) => num(g.cantidad) >= mediana * 0.5) || principales[0];
    const nomina = /nomina|nómina/i.test(ult.tipo || '');
    if (/impuesto/i.test(ult.tipo || '')) continue;
    if (limite && fecha(principales[0]) < limite) continue;
    if (!nomina) {
      if (lista.length / porMes.size > 1.5) continue;
      const media = importes.reduce((a, b) => a + b, 0) / importes.length;
      const cv = media ? Math.sqrt(importes.reduce((a, b) => a + (b - media) ** 2, 0) / importes.length) / media : 1;
      if (cv > 0.6) continue; // compras sueltas de importe muy variable: no son un gasto fijo
    }
    const reMes = new RegExp(`\\b(${MESES.join('|')})\\b`, 'gi');
    const c0 = ult.concepto || '';
    const concepto = (c0.match(reMes) || []).length === 1 ? c0.replace(reMes, '{mes}') : c0;
    out.push({ grupo: nomina ? 'nomina' : 'mensual', empresa: ult.empresa.trim(), concepto, cantidad: num(ult.cantidad), tipo: ult.tipo, categoria_id: ult.categoria_id,
      subcategoria_id: ult.subcategoria_id, metodo_pago: ult.metodo_pago, periodicidad: 'Mensual', dia_pago: Number(fecha(ult).slice(8, 10)) || 1,
      centro_id: ult.centro_id || null, meses: porMes.size });
  }
  return out.sort((a, b) => (a.grupo === b.grupo ? b.meses - a.meses || a.empresa.localeCompare(b.empresa, 'es') : a.grupo === 'nomina' ? -1 : 1));
}
