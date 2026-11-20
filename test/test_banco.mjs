// Pruebas de la lógica de conciliación (sin navegador): node test/test_banco.mjs
import assert from 'node:assert/strict';
import { conciliar, conciliarDevoluciones, gastosParaMov, movsParaGasto, resumenConciliacion, restanteGasto, restanteMov } from '../app/js/banco.js';

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
console.log(`test_banco: ${n} comprobaciones OK`);
