// Comparación de la domiciliación de Pagos con las remesas enviadas de un mes (se usa en Pagos y en Remesas).
// Solo cuentan los alumnos que iban en la remesa guardada: quien se apuntó (o pasó a domiciliación) después del envío queda fuera.
// Bimensuales/trimestrales: en Pagos salen mes a mes, pero la remesa los cobra de golpe en su mes de inicio; se comparan por periodo.
import { MESES, fmtEUR2 } from '../ui.js';
import { nombreAlumno } from './kit.js';

const esDomiCuota = (c) => /^domicil/i.test((c.metodo_pago || '').trim());

export function compararRemesaPagos(mes, { envios, lineasEnv, cuotas, alumnos, listaRem, doms }) {
  const alPorId = new Map(alumnos.map((a) => [a.id, a]));
  const perDeAlumno = new Map();
  for (const d of doms) { if (d.archivado || !d.remesa_id) continue; const r = listaRem.find((x) => x.id === d.remesa_id); if (r && (r.periodicidad || 1) > 1) perDeAlumno.set(d.alumno_id, r.periodicidad); }
  const r2p = (n) => Math.round(n * 100) / 100;
  const metIdx = (c) => (esDomiCuota(c) ? 0 : 1);
  return (function compararRemesa(mes) {
    const env = envios.find((e) => e.mes === mes); if (!env) return null;
    const cobros = cuotas.filter((c) => metIdx(c) === 0 && c.mes === mes && (c.concepto === 'mensualidad' || c.concepto === 'otro') && c.estado !== 'exento');
    const enviado = r2p((env.resumen || []).reduce((t, r) => t + Number(r.total), 0));
    const lin = lineasEnv.get(env.id) || [];
    const sumaPagos = (l) => r2p(l.reduce((t, c) => t + Number(c.importe), 0));
    const nom = (id, num) => { const a = alPorId.get(id); return a ? nombreAlumno(a) : `ID ${num ?? '?'}`; };
    if (!lin.length) { const pagos = sumaPagos(cobros); return { enviado, pagos, fuera: 0, dif: r2p(pagos - enviado), detalle: 'Este envío solo guardó totales por remesa: no se sabe quién iba en él, así que no se puede separar a los apuntados después ni a los trimestrales.' }; }
    const enRem = new Map(); for (const l of lin) enRem.set(l.alumno_id, (enRem.get(l.alumno_id) || 0) + Number(l.importe));
    const esPer = (id) => perDeAlumno.has(id) || (lin.some((l) => l.alumno_id === id && (listaRem.find((r) => r.nombre === l.remesa_nombre)?.periodicidad || 1) > 1));
    const perDe = (id) => perDeAlumno.get(id) || listaRem.find((r) => r.nombre === lin.find((l) => l.alumno_id === id)?.remesa_nombre)?.periodicidad || 3;
    const mesesPeriodo = (id) => { const i0 = MESES.indexOf(mes); return Array.from({ length: perDe(id) }, (_, n) => MESES[(i0 + n) % 12]); };
    const porAl = new Map(); // cuota mensual de Pagos por alumno (solo mensuales)
    for (const c of cobros) if (!esPer(c.alumno_id)) porAl.set(c.alumno_id, (porAl.get(c.alumno_id) || 0) + Number(c.importe));
    const fuera = cobros.filter((c) => !esPer(c.alumno_id) && !enRem.has(c.alumno_id));
    const dentro = cobros.filter((c) => !esPer(c.alumno_id) && enRem.has(c.alumno_id));
    // trimestrales que van en esta remesa: se comparan con la suma de sus cuotas del periodo (mes de inicio y siguientes)
    const trimEnRem = [...enRem].filter(([id]) => esPer(id));
    const pagosPeriodo = (id) => r2p(cuotas.filter((c) => c.alumno_id === id && metIdx(c) === 0 && (c.concepto === 'mensualidad' || c.concepto === 'otro') && c.estado !== 'exento' && mesesPeriodo(id).includes(c.mes)).reduce((t, c) => t + Number(c.importe), 0));
    const trimDif = trimEnRem.filter(([id, v]) => Math.abs(pagosPeriodo(id) - v) >= 0.005);
    // trimestrales que salen en Pagos este mes pero no van en esta remesa (cubiertos por la de su mes de inicio, o apuntados después)
    const trimFuera = cobros.filter((c) => esPer(c.alumno_id) && !enRem.has(c.alumno_id));
    const sinPago = lin.filter((l) => !esPer(l.alumno_id) && !porAl.has(l.alumno_id));
    const distinto = [...porAl].filter(([id, v]) => enRem.has(id) && Math.abs(v - enRem.get(id)) >= 0.005);
    const pagos = r2p(sumaPagos(dentro) + trimEnRem.reduce((t, [id]) => t + pagosPeriodo(id), 0));
    const lista = (arr, f) => arr.length ? arr.slice(0, 12).map(f).join(' · ') + (arr.length > 12 ? ` · … (+${arr.length - 12})` : '') : '';
    const partes = [];
    if (fuera.length) partes.push(`Fuera de la remesa (se apuntaron o pasaron a domiciliación después del envío; no cuentan): ${lista(fuera, (c) => `${nom(c.alumno_id)} ${fmtEUR2(Number(c.importe))}`)}`);
    if (trimFuera.length) partes.push(`Trimestrales/bimensuales que no se cobran este mes (van en la remesa de su mes de inicio o se apuntaron después; no cuentan): ${lista(trimFuera, (c) => `${nom(c.alumno_id)} ${fmtEUR2(Number(c.importe))}`)}`);
    if (trimEnRem.length) partes.push(`Trimestrales cobrados este mes: la remesa lleva el periodo entero y se compara con la suma de sus cuotas de Pagos del periodo (${trimEnRem.length} alumnos)`);
    if (trimDif.length) partes.push(`Trimestral con importe distinto entre la remesa y Pagos del periodo: ${lista(trimDif, ([id, v]) => `${nom(id)} remesa ${fmtEUR2(v)} / Pagos periodo ${fmtEUR2(pagosPeriodo(id))}`)}`);
    if (sinPago.length) partes.push(`En la remesa pero sin cuota de domiciliación este mes en Pagos: ${lista(sinPago, (l) => `${l.alumno_nombre || nom(l.alumno_id, l.alumno_num)} ${fmtEUR2(Number(l.importe))}`)}`);
    if (distinto.length) partes.push(`Importe distinto entre Pagos y la remesa: ${lista(distinto, ([id, v]) => `${nom(id)} Pagos ${fmtEUR2(v)} / remesa ${fmtEUR2(enRem.get(id))}`)}`);
    return { enviado, pagos, fuera: r2p(sumaPagos(fuera) + sumaPagos(trimFuera)), dif: r2p(pagos - enviado), detalle: partes.join('\n') || 'Pagos y remesa coinciden.' };
  })(mes);
}
