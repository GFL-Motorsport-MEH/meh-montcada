// TRABAJADORES · Bolsa de horas: movimientos (horas de más a favor, horas devueltas, ajustes); el saldo es la suma.
// Cada trabajador ve el saldo y los movimientos suyos; quien gestiona (permiso «todo» + editar) ve el equipo y los apunta.
import { h, clear, cargando, toast, confirmar, fmtFecha, hoyISO } from '../ui.js';
import * as api from './api.js';
import { campo, sel, txt, numero, fecha, tabla, cabecera, refrescar } from '../academia/kit.js';
import { TIPOS_HORAS, NOM_HORAS, fmtHoras, claseSaldo, saldos, personasVisibles, nombreUsuario } from './util.js';

let verPersona = '';

export async function renderHoras(view, ctx) {
  clear(view, cargando());
  const yo = ctx.state.perfil;
  const gestiona = ctx.ve('tr_horas') && ctx.edita('tr_horas');
  const veTodos = ctx.ve('tr_horas');
  const [personas, movs] = await Promise.all([personasVisibles(ctx, api, ['tr_horas']), api.horas()]);
  const nombreDe = new Map(personas.map((u) => [u.id, nombreUsuario(u)]));
  const sal = saldos(movs);
  const mios = movs.filter((m) => m.profile_id === yo.id);

  const cols = (conPersona, conQuitar) => [
    ...(conPersona ? [{ t: 'Trabajador', v: (m) => nombreDe.get(m.profile_id) || '—' }] : []),
    { t: 'Fecha', s: (m) => m.fecha, v: (m) => fmtFecha(m.fecha) },
    { t: 'Tipo', v: (m) => NOM_HORAS[m.tipo] || m.tipo },
    { t: 'Concepto', v: (m) => m.concepto || '' },
    { t: 'Horas', num: true, s: (m) => Number(m.horas), v: (m) => h('strong', { class: claseSaldo(Number(m.horas)) }, fmtHoras(m.horas, true)) },
    ...(conQuitar ? [{ t: '', sin: true, v: (m) => h('button', { class: 'btn small ghost', type: 'button', onclick: async () => {
      if (!await confirmar({ titulo: 'Quitar movimiento', texto: `Se quitará «${fmtHoras(m.horas, true)}» del ${fmtFecha(m.fecha)} de ${nombreDe.get(m.profile_id) || 'este trabajador'}.`, ok: 'Quitar', peligro: true })) return;
      try { await api.del('tr_horas', m.id); toast('Movimiento quitado'); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
    } }, 'Quitar') }] : []),
  ];

  const miSaldo = sal.get(yo.id) || 0;
  const partes = [cabecera('Bolsa de horas', veTodos ? 'Horas de más y horas devueltas de cada trabajador.' : `Hola, ${yo.nombre || yo.email}. Estas son tus horas acumuladas y devueltas.`),
    h('div', { class: 'card tr-card' }, h('h3', {}, 'Mi saldo'), h('div', { class: `tr-saldo ${claseSaldo(miSaldo)}` }, fmtHoras(miSaldo, true)),
      h('div', { class: 'muted', style: 'margin-top:4px' }, miSaldo > 0 ? 'Horas a tu favor.' : miSaldo < 0 ? 'Horas que debes a la academia.' : 'Sin horas pendientes.')),
    h('div', { class: 'card' }, h('h3', { class: 'sub-titulo' }, 'Mis movimientos'), tabla(cols(false, false), mios, { vacio: 'Todavía no hay movimientos en tu bolsa de horas.' }))];

  if (veTodos) {
    const filtro = sel([['', 'Todos los trabajadores'], ...personas.map((u) => [u.id, nombreUsuario(u)])], verPersona, { onchange: (e) => { verPersona = e.target.value; pintar(); }, 'aria-label': 'Trabajador' });
    const cont = h('div');
    const pintar = () => clear(cont, tabla(cols(true, gestiona), movs.filter((m) => !verPersona || m.profile_id === verPersona), { vacio: 'No hay movimientos.' }));
    const resumen = tabla([
      { t: 'Trabajador', v: (u) => h('button', { class: 'link-btn', type: 'button', onclick: () => { verPersona = u.id; filtro.value = u.id; pintar(); } }, nombreUsuario(u)) , s: nombreUsuario },
      { t: 'Saldo', num: true, s: (u) => sal.get(u.id) || 0, v: (u) => h('strong', { class: claseSaldo(sal.get(u.id) || 0) }, fmtHoras(sal.get(u.id) || 0, true)) },
      { t: 'Movimientos', num: true, s: (u) => movs.filter((m) => m.profile_id === u.id).length, v: (u) => String(movs.filter((m) => m.profile_id === u.id).length) },
    ], personas, { vacio: 'Sin trabajadores.' });
    partes.push(h('div', { class: 'card' }, h('h3', { class: 'sub-titulo' }, 'Saldo del equipo'), resumen));

    const alta = gestiona ? (() => {
      const F = { quien: sel(personas.map((u) => [u.id, nombreUsuario(u)]), verPersona || '', { vacio: 'Elige trabajador…' }), fecha: fecha(hoyISO()), tipo: sel(TIPOS_HORAS, 'extra'),
        horas: numero('', { placeholder: '1,5', step: '0.25' }), concepto: txt('', { placeholder: 'Reunión de padres, salida de campo…' }) };
      const anadir = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        let n = Number(String(F.horas.value).replace(',', '.'));
        if (!F.quien.value || !n || !F.fecha.value) { toast('Elige trabajador, fecha y un número de horas distinto de cero.', 'error'); return; }
        if (F.tipo.value === 'extra') n = Math.abs(n); else if (F.tipo.value === 'compensacion') n = -Math.abs(n); // en ajuste y saldo inicial vale el signo escrito
        anadir.disabled = true;
        try { await api.ins('tr_horas', { profile_id: F.quien.value, fecha: F.fecha.value, tipo: F.tipo.value, horas: n, concepto: F.concepto.value.trim() || null }); toast('Movimiento guardado'); refrescar(); } catch (ex) { toast(ex.message, 'error'); anadir.disabled = false; }
      } }, 'Añadir movimiento');
      return h('div', { class: 'form-section' }, h('h3', {}, 'Apuntar horas'), campo('Trabajador', F.quien), campo('Fecha', F.fecha), campo('Tipo', F.tipo), campo('Horas (en «ajuste» o «saldo inicial», con − si restan)', F.horas), campo('Concepto', F.concepto, { full: true }), h('div', { class: 'full' }, anadir));
    })() : null;
    partes.push(h('div', { class: 'card' }, h('h3', { class: 'sub-titulo' }, 'Movimientos del equipo'), h('div', { class: 'filters' }, filtro), cont, alta));
    pintar();
  }
  clear(view, ...partes);
}
