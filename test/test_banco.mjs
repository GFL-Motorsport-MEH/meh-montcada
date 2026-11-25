// Pruebas de la lógica de conciliación (sin navegador): node test/test_banco.mjs
import assert from 'node:assert/strict';
import { sugerirRemesas, esperadoRemesas, ingresadoRemesas, bancoDeCuenta, conciliar, conciliarDevoluciones, gastosParaMov, movsParaGasto, resumenConciliacion, restanteGasto, restanteMov } from '../app/js/banco.js';

const g = (id, empresa, cantidad, f, extra = {}) => ({ id, empresa, cantidad, fecha_factura: f, check_banca: false, ...extra });
const m = (id, concepto, importe, fecha, estado = 'pendiente') => ({ id, concepto, importe, fecha, estado });
let n = 0; const ok = (c, msg) => { assert.ok(c, msg); n++; };

// 1 factura pagada en 2 pagos
let r = conciliar([g('f', 'Previntegral', 300, '2026-10-01')], [m('a', 'RECIBO PREVINTEGRAL', -100, '2026-10-10'), m('b', 'RECIBO PREVINTEGRAL', -200, '2026-10-12')]);
ok(r.length === 1 && r[0].movs.length === 2, '1 factura en 2 pagos');
// 1 pago de 2 facturas de la misma empresa (nombre en el concepto)
r = conciliar([g('x', 'Acme SL', 100, '2026-10-02'), g('y', 'Acme SL', 200, '2026-10-03'), g('z', 'Otra', 300, '2026-10-02')], [m('p', 'TRANSF ACME SL', -300, '2026-10-11')]);
ok(r.length === 1 && r[0].gastos.map((x) => x.id).join() === 'x,y' && r[0].asignaciones.length === 2, '1 pago de 2 facturas');
// lo ya enlazado no se vuelve a proponer y cuenta el restante
const enl = [{ movimiento_id: 'a', gasto_id: 'f', importe: 100 }];
ok(restanteGasto(g('f', 'P', 300, '2026-10-01'), enl) === 200 && restanteMov(m('a', '', -100, '2026-10-10'), enl) === 0, 'restantes');
r = conciliar([g('f', 'Previntegral', 300, '2026-10-01')], [m('a', 'RECIBO PREVINTEGRAL', -100, '2026-10-10'), m('b', 'RECIBO PREVINTEGRAL', -200, '2026-10-12')], { enlaces: enl });
ok(r.length === 1 && r[0].asignaciones.length === 1 && r[0].asignaciones[0].mov.id === 'b' && r[0].asignaciones[0].importe === 200, 'solo propone lo que falta');
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
