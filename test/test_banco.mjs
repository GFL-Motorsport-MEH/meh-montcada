// Pruebas de la lógica de conciliación (sin navegador): node test/test_banco.mjs
import assert from 'node:assert/strict';
import { aprenderAlias, claveConcepto, mismoCentro, motivoGasto, sugerirRemesas, esperadoRemesas, ingresadoRemesas, bancoDeCuenta, conciliar, conciliarDevoluciones, gastosParaMov, movsParaGasto, resumenConciliacion, restanteGasto, restanteMov } from '../app/js/banco.js';

const g = (id, empresa, cantidad, f, extra = {}) => ({ id, empresa, cantidad, fecha_factura: f, check_banca: false, ...extra });
const m = (id, concepto, importe, fecha, estado = 'pendiente') => ({ id, concepto, importe, fecha, estado });
let n = 0; const ok = (c, msg) => { assert.ok(c, msg); n++; };

// 1 factura pagada en 2 pagos
let r = conciliar([g('f', 'Previntegral', 300, '2026-10-01')], [m('a', 'RECIBO PREVINTEGRAL', -100, '2026-10-10'), m('b', 'RECIBO PREVINTEGRAL', -200, '2026-10-12')]);
ok(r.length === 0, 'pagos múltiples: 1 factura en 2 pagos NO es automático (se enlaza a mano)');
// 1 pago de 2 facturas de la misma empresa (nombre en el concepto)
r = conciliar([g('x', 'Acme SL', 100, '2026-10-02'), g('y', 'Acme SL', 200, '2026-10-03'), g('z', 'Otra', 300, '2026-10-02')], [m('p', 'TRANSF ACME SL', -300, '2026-10-11')]);
ok(r.length === 0, 'pagos múltiples: 1 pago de 2 facturas NO es automático (se enlaza a mano)');
// lo ya enlazado no se vuelve a proponer y cuenta el restante
const enl = [{ movimiento_id: 'a', gasto_id: 'f', importe: 100 }];
ok(restanteGasto(g('f', 'P', 300, '2026-10-01'), enl) === 200 && restanteMov(m('a', '', -100, '2026-10-10'), enl) === 0, 'restantes');
r = conciliar([g('f', 'Previntegral', 300, '2026-10-01')], [m('a', 'RECIBO PREVINTEGRAL', -100, '2026-10-10'), m('b', 'RECIBO PREVINTEGRAL', -200, '2026-10-12')], { enlaces: enl });
ok(r.length === 0, 'una factura parcialmente enlazada no se completa sola');
// devoluciones: solo con DEVOLUCIÓN en el concepto, contra el abono del mismo importe
const abono = g('ab', 'Amazon', -9.24, '2026-10-05');
r = conciliarDevoluciones([abono, g('ot', 'Otro', -9.24, '2026-10-05')], [m('d', 'Devolución AMAZON EU', 9.24, '2026-10-20'), m('i', 'Ingreso varios', 9.24, '2026-10-21')]);
ok(r.length === 1 && r[0].gasto.id === 'ab' && r[0].movs[0].id === 'd', 'devolución -> abono de la misma empresa');
ok(conciliarDevoluciones([abono], [m('i', 'Ingreso varios', 9.24, '2026-10-21')]).length === 0, 'sin la palabra DEVOLUCIÓN no es automático');
// búsqueda manual entre los ingresos del banco
ok(movsParaGasto(abono, [m('i', 'Ingreso varios', 9.24, '2026-10-21'), m('s', 'Pago', -5, '2026-10-21')], [], '').map((x) => x.id).join() === 'i', 'abono: solo ingresos');
ok(gastosParaMov(m('d', 'Devolución', 9.24, '2026-10-20'), [abono, g('f', 'X', 50, '2026-10-01')], [], '').map((x) => x.id).join() === 'ab', 'ingreso: solo abonos');
// resumen para la gestoría
const res = resumenConciliacion({ gastos: [g('f', 'P', 300, '2026-10-01'), abono], movimientos: [m('a', '', -100, '2026-10-10'), m('b', '', -200, '2026-10-12'), m('d', 'DEVOLUCION', 9.24, '2026-10-20')],
  enlaces: [{ movimiento_id: 'a', gasto_id: 'f', importe: 100 }, { movimiento_id: 'b', gasto_id: 'f', importe: 200 }, { movimiento_id: 'd', gasto_id: 'ab', importe: 9.24 }] });
ok(res.variosPagos.length === 2 && res.abonos[0].pendiente === 0 && res.filas.some((x) => x.situacion === 'Abono ↔ devolución'), 'resumen gestoría');
// ingresos de remesas: solo totales
const env = { curso_id: 'c1', mes: 'noviembre', enviado_el: '2026-10-20T10:00:00Z', resumen: [
  { remesa_nombre: '1', banco: 'SABADELL', orden: 1, total: 600 }, { remesa_nombre: '2', banco: 'SABADELL', orden: 2, total: 400 },
  { remesa_nombre: 'BBVA 1 - FED', banco: 'BBVA', orden: 101, total: 250 }, { remesa_nombre: 'BBVA 2 - ELV', banco: 'BBVA', orden: 102, total: 150 }] };
const ctas = [{ id: 's', banco: 'Sabadell', iban: '' }, { id: 'b', banco: null, iban: 'ES12 0182 1234 0000 0000 0000' }];
const mc = (id, concepto, importe, fecha, cuenta) => ({ id, concepto, importe, fecha, estado: 'pendiente', cuenta_id: cuenta });
ok(esperadoRemesas(env, 'SABADELL') === 1000 && esperadoRemesas(env, 'BBVA') === 400 && esperadoRemesas(env, 'BBVA', 'BBVA 2 - ELV') === 150, 'esperado por banco y por remesa');
ok(bancoDeCuenta(ctas[0]) === 'SABADELL' && bancoDeCuenta(ctas[1]) === 'BBVA', 'banco de la cuenta por texto e IBAN');
let sg = sugerirRemesas([env], [mc('x', 'ABONO REMESA', 1000, '2026-11-05', 's'), mc('y', 'Otro', 77, '2026-11-05', 's')], { cuentas: ctas });
ok(sg.length === 1 && sg[0].banco === 'SABADELL' && sg[0].movs[0].id === 'x', 'un ingreso con el total de Sabadell');
sg = sugerirRemesas([env], [mc('a', 'REMESA 1', 600, '2026-11-04', 's'), mc('b', 'REMESA 2', 400, '2026-11-04', 's')], { cuentas: ctas });
ok(sg.length === 1 && sg[0].movs.length === 2 && sg[0].total === 1000, 'varios ingresos «remesa» que suman el total');
sg = sugerirRemesas([env], [mc('a', 'Ingreso', 250, '2026-11-04', 'b'), mc('b', 'Ingreso', 150, '2026-11-04', 'b')], { cuentas: ctas });
ok(sg.length === 1 && sg[0].banco === 'BBVA' && sg[0].asignaciones.map((x) => x.remesa_nombre).join() === 'BBVA 1 - FED,BBVA 2 - ELV', 'BBVA ingresa cada remesa por separado');
ok(sugerirRemesas([env], [mc('x', 'ABONO', 1000, '2027-03-05', 's')], { cuentas: ctas }).length === 0, 'fuera de fecha no se propone');
const yaEnlazado = [{ movimiento_id: 'x', curso_id: 'c1', mes: 'noviembre', banco: 'SABADELL', importe: 1000 }];
ok(sugerirRemesas([env], [mc('x', 'ABONO', 1000, '2026-11-05', 's')], { cuentas: ctas, movRemesas: yaEnlazado }).length === 0 && ingresadoRemesas(yaEnlazado, env, 'SABADELL') === 1000, 'lo ya enlazado no se vuelve a proponer');
console.log(`test_banco: ${n} comprobaciones OK`);

// devolución de recibos: un enlace negativo resta del ingresado y cuenta en valor absoluto para el movimiento
{
  const { ingresadoRemesas: ing, asignadoRemesasMov: asig } = await import('../app/js/banco.js');
  const env = { curso_id: 'c', mes: 'noviembre' };
  const mr = [{ movimiento_id: 'a', curso_id: 'c', mes: 'noviembre', banco: 'SABADELL', importe: 1000 }, { movimiento_id: 'b', curso_id: 'c', mes: 'noviembre', banco: 'SABADELL', importe: -120 }];
  
// ---- mejoras (nov-2026): gastos ya marcados «en banco» sin enlace, cuotas repetidas, centros y alias aprendidos ----
const AL = 'alc', MO = 'mon';
const gc = (id, empresa, cantidad, f, centro, extra = {}) => ({ id, empresa, cantidad, fecha_factura: f, check_banca: true, centro_id: centro, ...extra });
const mc = (id, concepto, importe, fecha, centro) => ({ id, concepto, importe, fecha, estado: 'pendiente', centro_id: centro });
// un gasto con check_banca=true pero sin enlace sí se concilia
r = conciliar([gc('a', 'Iberdrola', 244.06, '2026-08-18', AL)], [mc('m1', 'ELECTRICIDAD IBERDROLA CLIENTES', -244.06, '2026-08-26', AL)], { principal: MO });
ok(r.length === 1 && r[0].gasto.id === 'a', 'gasto marcado en banco sin enlace se concilia');
// cuotas iguales cada mes: cada mes con su movimiento
const cuotas = ['2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31'].map((f, i) => gc('c' + i, 'Prestamos Sabadell', 910.57, f, AL));
const movc = [['x1', '2026-08-31'], ['x2', '2026-09-30'], ['x3', '2026-10-30']].map(([id, f]) => mc(id, 'PRESTAMOS ADEUDO CUOTA N.80790', -910.57, f, AL));
r = conciliar(cuotas, movc, { principal: MO });
ok(r.length === 3 && r.every((p) => dias2(p.gasto.fecha_factura, p.movs[0].fecha) <= 1), 'cuotas mensuales: cada una con su mes');
function dias2(a, b) { return Math.abs((new Date(a) - new Date(b)) / 86400000); }
// no mezcla centros: un pago de Alcantarilla no concilia un gasto de Montcada con el mismo importe
r = conciliar([gc('mo', 'Jorge Bedoya', 80, '2026-11-20', MO)], [mc('mm', 'COMPRA TARJ. AYUNTAMIENTO', -80, '2026-11-24', AL)], { principal: MO });
ok(r.length === 0, 'no mezcla centros');
ok(mismoCentro({ centro_id: null }, { centro_id: MO }, MO), 'sin centro = principal');
// alias aprendidos de lo ya enlazado
const gH = gc('h1', 'Hidrogea Agua Murcia', 56.47, '2026-06-30', AL), gH2 = gc('h2', 'Hidrogea Agua Murcia', 355.18, '2026-09-25', AL);
const mV1 = mc('v1', 'AGUA VEOLIA, GESTION INTEGRAL DE AGU SERVICIO AGUA VEO - A73468498651', -56.47, '2026-11-16', AL);
const mV2 = mc('v2', 'AGUA VEOLIA, GESTION INTEGRAL DE AGU FACTURA VEOLIA, G - A73468498651', -355.18, '2026-09-25', AL);
const alias = aprenderAlias([{ movimiento_id: 'v1', gasto_id: 'h1', importe: 56.47 }], [mV1, mV2], [gH, gH2]);
ok(claveConcepto(mV1.concepto) === claveConcepto(mV2.concepto), 'misma clave de concepto');
ok(motivoGasto(gH2, mV2, [], alias).includes('empresa en el concepto'), 'alias: reconoce la empresa');
// búsqueda manual: solo candidatos claros, del centro, y «parecidos» solo si se pide
const lista = [gc('u1', 'Alarmas Murcia', 42.35, '2026-10-01', AL), gc('u2', 'Obramat', 40, '2026-10-02', AL), gc('u3', 'Otra', 42.35, '2026-10-01', MO), gc('u4', 'Vieja', 42.35, '2024-01-01', AL), gc('u5', 'Murcia Cosas', 900, '2026-10-01', AL)];
const movb = mc('mb', 'ADEUDO RECIBO Alarmas Murcia SLU', -42.35, '2026-10-02', AL);
ok(gastosParaMov(movb, lista.map((x) => ({ ...x, check_banca: false })), [], '', { principal: MO }).map((x) => x.id).join() === 'u1', 'manual: solo el candidato claro');
ok(gastosParaMov(movb, lista, [], '', { principal: MO, otrosCentros: true }).map((x) => x.id).sort().join() === 'u1,u3', 'manual: otros centros solo si se pide');
ok(gastosParaMov(movb, lista, [], 'obramat', { principal: MO }).map((x) => x.id).join() === 'u2', 'manual: con texto busca en todos los del centro');
ok(gastosParaMov(mc('mp', 'X', -41, '2026-10-02', AL), lista, [], '', { principal: MO }).length === 0, 'manual: importes parecidos NO salen (solo exactos o empresa reconocida)');


// pago de un gasto de otra academia con esta cuenta: solo si coincide importe Y empresa; se marca como otro centro
r = conciliar([gc('oc', 'Obramat', 577.4, '2026-09-29', MO)], [mc('mo1', 'COMPRA TARJ. OBM MURCIA OBRAMAT', -577.4, '2026-09-25', AL)], { principal: MO });
ok(r.length === 0, 'otro centro: el automático no lo hace (se enlaza a mano)');
r = conciliar([gc('oc2', 'Leroy', 577.4, '2026-09-29', MO)], [mc('mo2', 'COMPRA TARJ. OBM MURCIA OBRAMAT', -577.4, '2026-09-25', AL)], { principal: MO });
ok(r.length === 0, 'otro centro: sin empresa reconocida no se propone');


// ---- regresión (26-nov-2026): nada de enlaces por importes aproximados ni sumas de pagos sin relación ----
// IRPF 224,84 = 43,39 (Iberdrola) + 56,47 (Veolia) + 124,98: ni con 1 céntimo de margen
r = conciliar([gc('irpf', 'Maria Lopez Garcia', 224.84, '2026-11-10', AL)], [mc('i1', 'ELECTRICIDAD IBERDROLA CLIENTES', -43.39, '2026-11-09', AL), mc('i2', 'AGUA VEOLIA GESTION', -56.47, '2026-11-16', AL), mc('i3', 'ADEUDO RECIBO SEGUPRO', -124.99, '2026-11-12', AL)], { principal: AL });
ok(r.length === 0, 'no suma pagos sin relación para cuadrar un gasto');
// ni 1 céntimo de diferencia, ni importe igual sin la empresa en el concepto
ok(conciliar([gc('e1', 'Iberdrola', 244.07, '2026-08-18', AL)], [mc('e2', 'ELECTRICIDAD IBERDROLA CLIENTES', -244.06, '2026-08-26', AL)], { principal: AL }).length === 0, 'importe a 1 céntimo no vale');
ok(conciliar([gc('e3', 'Maria Lopez Garcia', 244.06, '2026-08-18', AL)], [mc('e4', 'ELECTRICIDAD IBERDROLA CLIENTES', -244.06, '2026-08-26', AL)], { principal: AL }).length === 0, 'mismo importe sin la empresa: no es automático');
ok(conciliar([gc('e5', 'Iberdrola', 244.06, '2026-08-18', AL)], [mc('e6', 'ELECTRICIDAD IBERDROLA CLIENTES', -244.06, '2026-08-26', AL)], { principal: AL }).length === 1, 'importe exacto y empresa: sí');


// la fecha de pago puede ser la del periodo contable: vale la más cercana entre fecha de pago y de factura (caso Hidrogea 56,47)
const gh = gc('gh', 'Hidrogea Agua Murcia', 56.47, '2026-11-16', AL, { fecha_pago: '2026-06-30' });
const mh = mc('mh', 'AGUA VEOLIA, GESTION INTEGRAL DE AGU SERVICIO AGUA VEO', -56.47, '2026-11-16', AL);
ok(gastosParaMov(mh, [gh], [], '', { principal: MO }).map((x) => x.id).join() === 'gh', 'manual: sale aunque la fecha de pago esté lejos si la de factura es la del pago');

console.log(ing(mr, env, 'SABADELL') === 880 && asig({ id: 'b' }, mr) === 120 ? '  ok: la devolución del banco resta del ingresado' : '  FALLO: devolución');
}
