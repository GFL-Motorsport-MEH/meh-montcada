// Configuración > Cuotas y descuentos: las cuotas mensuales y el welcome pack de cada modalidad, y los descuentos (en % o en €).
// Al dar de alta la inscripción de un alumno, la ficha propone la cuota de su modalidad y ofrece estos descuentos.
import { h, clear, cargando, toast, confirmar, fmtEUR2, importeEscrito } from '../ui.js';
import * as api from '../academia/api.js';
import { registrarSeccionConfig } from './config.js';

const num = (v) => { const n = importeEscrito(v); return Number.isFinite(n) ? n : 0; };

async function renderCuotas(cont, ctx) {
  clear(cont, cargando());
  const [cuotas, descuentos, ls] = await Promise.all([api.cuotasTarifa(), api.descuentos(), api.listas()]);
  const editor = ctx.edita('fact') || ctx.edita('ac_pagos');
  const modalidades = ls.modalidad || [];
  const recargar = () => { renderCuotas(cont, ctx); };
  const guardar = async (tabla, id, parche) => { try { await api.upd(tabla, id, parche); toast('Guardado'); } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); } };
  const quitar = async (tabla, f, que) => {
    if (!await confirmar({ titulo: `Quitar ${que}`, texto: `Se quitará «${f.nombre}» de la configuración. Las inscripciones ya guardadas no cambian.`, ok: 'Quitar', peligro: true })) return;
    try { await api.del(tabla, f.id); recargar(); } catch (ex) { toast(ex.message, 'error'); }
  };
  const input = (valor, extra) => h('input', { class: 'cell cell-text', value: valor ?? '', disabled: !editor, ...extra });

  const filaCuota = (c) => h('tr', { 'data-id': c.id },
    h('td', {}, input(c.nombre, { 'aria-label': 'Nombre de la cuota', onchange: (e) => guardar('ac_cuotas_tarifa', c.id, { nombre: e.target.value.trim() || c.nombre }) })),
    h('td', {}, h('select', { disabled: !editor, 'aria-label': 'Modalidad', onchange: (e) => guardar('ac_cuotas_tarifa', c.id, { modalidad: e.target.value || null }) },
      h('option', { value: '' }, '—'), [...new Set([...modalidades, c.modalidad].filter(Boolean))].map((m) => h('option', { value: m, selected: m === c.modalidad }, m)))),
    h('td', { class: 'num' }, input(c.cuota_mensual, { type: 'number', step: '0.01', 'aria-label': 'Cuota mensual', onchange: (e) => guardar('ac_cuotas_tarifa', c.id, { cuota_mensual: num(e.target.value) }) })),
    h('td', { class: 'num' }, input(c.welcome_pack, { type: 'number', step: '0.01', 'aria-label': 'Welcome pack', onchange: (e) => guardar('ac_cuotas_tarifa', c.id, { welcome_pack: num(e.target.value) }) })),
    h('td', {}, h('input', { type: 'checkbox', checked: c.activa, disabled: !editor, 'aria-label': 'Activa', onchange: (e) => guardar('ac_cuotas_tarifa', c.id, { activa: e.target.checked }) })),
    h('td', {}, editor ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => quitar('ac_cuotas_tarifa', c, 'cuota') }, 'Quitar') : null));
  const filaDesc = (d) => h('tr', { 'data-id': d.id },
    h('td', {}, input(d.nombre, { 'aria-label': 'Nombre del descuento', onchange: (e) => guardar('ac_descuentos', d.id, { nombre: e.target.value.trim() || d.nombre }) })),
    h('td', {}, h('select', { disabled: !editor, 'aria-label': 'Tipo', onchange: (e) => guardar('ac_descuentos', d.id, { tipo: e.target.value }) },
      h('option', { value: 'porcentaje', selected: d.tipo === 'porcentaje' }, '% de la cuota'), h('option', { value: 'importe', selected: d.tipo === 'importe' }, '€ al mes'))),
    h('td', { class: 'num' }, input(d.valor, { type: 'number', step: '0.01', 'aria-label': 'Valor', onchange: (e) => guardar('ac_descuentos', d.id, { valor: num(e.target.value) }) })),
    h('td', {}, h('input', { type: 'checkbox', checked: d.activo, disabled: !editor, 'aria-label': 'Activo', onchange: (e) => guardar('ac_descuentos', d.id, { activo: e.target.checked }) })),
    h('td', {}, editor ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => quitar('ac_descuentos', d, 'descuento') }, 'Quitar') : null));

  const nuevaCuota = async () => { try { await api.ins('ac_cuotas_tarifa', { nombre: 'Nueva cuota', orden: cuotas.length }); recargar(); } catch (ex) { toast(ex.message, 'error'); } };
  const nuevoDesc = async () => { try { await api.ins('ac_descuentos', { nombre: `Nuevo descuento ${descuentos.length + 1}`, orden: descuentos.length }); recargar(); } catch (ex) { toast(ex.message, 'error'); } };
  const ejemplo = cuotas.find((c) => c.activa && c.cuota_mensual > 0); const dEj = descuentos.find((d) => d.activo && d.valor > 0);
  const calc = ejemplo && dEj ? ejemplo.cuota_mensual - (dEj.tipo === 'porcentaje' ? ejemplo.cuota_mensual * dEj.valor / 100 : dEj.valor) : null;

  clear(cont,
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'Cuotas y descuentos'), h('div', { class: 'count' }, `${cuotas.length} cuotas · ${descuentos.length} descuentos`))),
    h('p', { class: 'muted small' }, 'Aquí se fijan las cuotas mensuales por modalidad y los descuentos. Al abrir la ficha de un alumno, la cuota se propone según su modalidad y los descuentos salen en el desplegable. Cambiar estos importes no modifica las inscripciones ya guardadas.'),
    h('div', { class: 'card' }, h('div', { class: 'section-head' }, h('h3', { class: 'sub-titulo' }, 'Cuotas mensuales'), editor ? h('button', { class: 'btn small', type: 'button', onclick: nuevaCuota }, '+ Nueva cuota') : null),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Nombre', 'Modalidad', 'Cuota €/mes', 'Welcome pack €', 'Activa', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, cuotas.length ? cuotas.map(filaCuota) : h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'Aún no hay cuotas. Añade la primera con «+ Nueva cuota».')))))),
    h('div', { class: 'card' }, h('div', { class: 'section-head' }, h('h3', { class: 'sub-titulo' }, 'Descuentos'), editor ? h('button', { class: 'btn small', type: 'button', onclick: nuevoDesc }, '+ Nuevo descuento') : null),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Nombre', 'Tipo', 'Valor', 'Activo', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, descuentos.length ? descuentos.map(filaDesc) : h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'Aún no hay descuentos.'))))),
      calc !== null ? h('div', { class: 'small muted' }, `Ejemplo: ${ejemplo.nombre} (${fmtEUR2(ejemplo.cuota_mensual)}) con «${dEj.nombre}» queda en ${fmtEUR2(calc)} al mes.`) : null));
}
registrarSeccionConfig('cuotas', renderCuotas);
