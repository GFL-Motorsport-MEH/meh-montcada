// Lectura de una nómina (PDF digital u OCR): trabajador, periodo y los tres importes que se llevan a Gastos.
//   · Nómina = LÍQUIDO a percibir
//   · SS     = cuota del trabajador + cuota de la empresa (cotización total a la Seguridad Social)
//   · IRPF   = retención de IRPF de la nómina (si no hay retención, no hay gasto de IRPF)
// Sin DOM: se prueba con node (test/test_nomina.mjs). Lo que no se encuentra queda en null para revisarlo a mano.
import { normalizar, importesEn, fechasEn, nifsEn } from './escaner-parse.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const pad = (n) => String(n).padStart(2, '0');
const finDeMes = (y, m) => `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
const r2 = (n) => Math.round(n * 100) / 100;

// importes de una línea sin contar los porcentajes («4,70 %», «13,5%»)
const importes = (l) => importesEn(l.replace(/\d{1,3}(?:[.,]\d+)?\s*%/g, ' ')).map((x) => x.v);
// importe de la línea o, si no lo trae, de la siguiente (a veces la etiqueta y la cifra van en líneas distintas)
const importeDe = (nl, lineas, i) => { const a = importes(lineas[i]); if (a.length) return a[a.length - 1]; const b = importes(lineas[i + 1] || ''); return b.length ? b[b.length - 1] : null; };

export function esNomina(texto) {
  const n = normalizar(texto);
  return /\bnominas?\b|recibo (individual )?de salarios/.test(n) && /liquido (total )?a percibir|total liquido|liquido a percibir|neto a percibir/.test(n);
}

export function analizarNomina(texto, { propios = [] } = {}) {
  const lineas = texto.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const nl = lineas.map(normalizar);
  const res = { trabajador: null, nif: null, fecha: null, liquido: null, irpf: 0, ssTrabajador: null, ssEmpresa: null, ss: null, confianza: {}, notas: [] };

  // líquido a percibir
  let i = nl.findIndex((l) => /liquido (total )?a percibir|neto a percibir|total a percibir/.test(l));
  if (i < 0) i = nl.findIndex((l) => /\bliquido\b/.test(l) && importes(lineas[l ? nl.indexOf(l) : 0]).length);
  if (i >= 0) { res.liquido = importeDe(nl, lineas, i); res.confianza.liquido = res.liquido != null ? 'alta' : 'baja'; }

  // IRPF: línea de la retención (no la «base IRPF», salvo que traiga base y cuota)
  const reIrpf = /\birpf\b|i\.?\s?r\.?\s?p\.?\s?f|retencion|impuesto sobre la renta|ret\.? irpf/;
  for (let k = 0; k < nl.length; k++) {
    if (!reIrpf.test(nl[k])) continue;
    const v = importes(lineas[k]);
    const esBase = /\bbase\b|sujet|acumulad/.test(nl[k]);
    if (!v.length || (esBase && v.length < 2)) continue;
    res.irpf = v[v.length - 1]; res.confianza.irpf = 'alta'; break;
  }
  if (!res.confianza.irpf) res.confianza.irpf = nl.some((l) => reIrpf.test(l)) ? 'media' : 'alta';

  // Seguridad Social: parte del trabajador
  i = nl.findIndex((l) => /total aportaciones|total cuota (obrera|trabajador)|cuota obrera|total (deducciones|cotizaciones) (s\.?s|seguridad social)|aportacion del trabajador.*total|total aportacion del trabajador/.test(l) && importes(lineas[nl.indexOf(l)]).length);
  if (i >= 0) { res.ssTrabajador = importeDe(nl, lineas, i); res.confianza.ssTrabajador = 'alta'; }
  else {
    // suma de los conceptos de cotización descontados (contingencias comunes, desempleo, formación, MEI…), entre DEDUCCIONES y el IRPF
    const ini = nl.findIndex((l) => /\bdeduccion/.test(l));
    const fin = nl.findIndex((l, k) => k > ini && ini >= 0 && (reIrpf.test(l) || /total a deducir|total deducciones/.test(l)));
    if (ini >= 0) {
      let suma = 0, n = 0;
      for (let k = ini + 1; k < (fin > 0 ? fin : nl.length); k++) {
        if (!/contingencias comunes|desempleo|formacion profesional|\bmei\b|equidad|horas extra/.test(nl[k])) continue;
        const v = importes(lineas[k]); if (v.length) { suma += v[v.length - 1]; n++; }
      }
      if (n) { res.ssTrabajador = r2(suma); res.confianza.ssTrabajador = 'media'; }
    }
  }

  // Seguridad Social: parte de la empresa
  const reEmp = /total (aportacion|cotizacion|cuota)(es)? (de la |a cargo de la |por la )?empresa|aportacion (de la )?empresa|cotizacion (de la )?empresa|cuota patronal|total empresa|coste (de )?(s\.?s\.?|seguridad social)( a cargo)?( de la)? empresa|seg\.? ?social empresa|total aportacion empresarial|aportacion empresarial/;
  const candidatos = nl.map((l, k) => [l, k]).filter(([l, k]) => reEmp.test(l) && importeDe(nl, lineas, k) != null);
  if (candidatos.length) {
    const conTotal = candidatos.filter(([l]) => /\btotal\b/.test(l));
    const [, k] = (conTotal.length ? conTotal : candidatos).slice(-1)[0];
    res.ssEmpresa = importeDe(nl, lineas, k); res.confianza.ssEmpresa = conTotal.length ? 'alta' : 'media';
  }
  if (res.ssTrabajador != null && res.ssEmpresa != null) { res.ss = r2(res.ssTrabajador + res.ssEmpresa); res.confianza.ss = res.confianza.ssTrabajador === 'alta' && res.confianza.ssEmpresa === 'alta' ? 'alta' : 'media'; }
  else if (res.ssTrabajador != null || res.ssEmpresa != null) { res.ss = null; res.notas.push('Solo se ha encontrado una de las dos cuotas de la Seguridad Social (trabajador o empresa): completa el total a mano.'); res.confianza.ss = 'baja'; }

  // trabajador
  const iTr = nl.findIndex((l) => /^(trabajador|apellidos y nombre|nombre y apellidos|empleado|apellidos, nombre|apellidos y nombre del trabajador)\b/.test(l));
  if (iTr >= 0) {
    let c = lineas[iTr].replace(/^[^:]*:\s*/, '');
    if (c === lineas[iTr]) c = lineas[iTr].replace(/^\S+(\s+\S+){0,4}?\s+(?=[A-ZÁÉÍÓÚÑ]{2,},?\s)/i, '');
    c = c.replace(/\b(d\.?n\.?i\.?|n\.?i\.?f\.?|n\.?i\.?e\.?)\b.*$/i, '').replace(/\s*[\d]{6,}.*$/, '').trim();
    if (c) res.trabajador = c;
    if (!res.trabajador && lineas[iTr + 1]) res.trabajador = lineas[iTr + 1].replace(/\b(d\.?n\.?i\.?|n\.?i\.?f\.?)\b.*$/i, '').trim();
  }
  const propiosNif = propios.map((p) => p.toUpperCase().replace(/[^0-9A-Z]/g, ''));
  const nif = nifsEn(texto).map((x) => x.nif).find((n) => /^\d{8}[A-Z]$|^[XYZ]\d{7}[A-Z]$/.test(n) && !propiosNif.includes(n));
  if (nif) res.nif = nif;

  // periodo → fecha = último día del mes de la nómina
  const lp = lineas.filter((l, k) => /periodo|liquidaci|mensualidad|nomina de|nomina del mes|mes de/.test(nl[k]));
  let fecha = null;
  // 1) mes nombrado en la línea del periodo («Noviembre 2026», «NOV 2026», «11/2026»): último día de ese mes
  const reMes = new RegExp(`\\b(${MESES.join('|')}|${MESES.map((m) => m.slice(0, 3)).join('|')})\\.?\\s*(?:de\\s*|del\\s*|/|-)?\\s*(20\\d{2})\\b`);
  for (const l of lp) {
    const m = normalizar(l).match(reMes);
    if (m) { fecha = finDeMes(+m[2], MESES.findIndex((x) => x === m[1] || x.slice(0, 3) === m[1]) + 1); break; }
    const n = normalizar(l).match(/(?<![\d\/-])\b(0?[1-9]|1[0-2])\s*[\/-]\s*(20\d{2})\b(?!\s*[\/-])/);
    if (n) { fecha = finDeMes(+n[2], +n[1]); break; }
  }
  // 2) fechas del periodo («01/11/2026 a 30/11/2026»): mes de la última
  if (!fecha) for (const l of lp) { const f = fechasEn(l); if (f.length) { fecha = f[f.length - 1].f; break; } }
  if (fecha) fecha = finDeMes(+fecha.slice(0, 4), +fecha.slice(5, 7));
  if (!fecha) {
    const m = normalizar(texto).match(new RegExp(`\\b(${MESES.join('|')})\\s*(?:de\\s*|del\\s*|/|-)?\\s*(20\\d{2})\\b`));
    if (m) fecha = finDeMes(+m[2], MESES.indexOf(m[1]) + 1);
  }
  if (fecha) { res.fecha = fecha; res.confianza.fecha = 'alta'; }
  return res;
}
