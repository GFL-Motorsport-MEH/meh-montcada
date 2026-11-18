// Remesas mensuales: agrupa las cuotas pendientes de domiciliación de un mes y permite marcar cobros/devoluciones.
import { h, clear, cargando, toast, confirmar, fmtEUR2, fmtFecha, hoyISO, MESES, capitalizar, descargarCSV } from '../ui.js';
import * as api from './api.js';
import { cabecera, tabla, pill, sel, fecha, campo, txt, drawer, nombreAlumno, refrescar, guardarBoton } from './kit.js';

const esDomi = (m) => /domicil|sepa|recibo/i.test(m || '');
const enmascarar = (iban) => (iban ? `${iban.slice(0, 4)} •••• ${iban.slice(-4)}` : 'sin IBAN');

export async function renderRemesas(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const [remesas, cuotas, alumnos] = await Promise.all([api.remesas(curso.id), api.cuotas(curso.id), api.alumnos()]);
  const alPor = new Map(alumnos.map((a) => [a.id, a]));
  const por = (r) => cuotas.filter((c) => c.remesa_id === r.id);
  const total = (l) => l.reduce((s, c) => s + Number(c.importe), 0);
  const editor = ctx.edita('ac_remesas');

  const mesSel = sel(MESES.map((m) => [m, capitalizar(m)]), ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][new Date().getMonth()]);
  const fechaCargo = fecha(hoyISO());
  const nueva = guardarBoton('Crear remesa del mes', async () => {
    const pendientes = cuotas.filter((c) => c.mes === mesSel.value && c.concepto === 'mensualidad' && c.estado === 'pendiente' && !c.remesa_id && esDomi(alPor.get(c.alumno_id)?.metodo_pago));
    if (!pendientes.length) { toast(`No hay cuotas de ${mesSel.value} pendientes de domiciliar. ¿Has generado las mensualidades en Pagos?`, 'error'); return; }
    if (!await confirmar({ titulo: `Remesa de ${mesSel.value}`, texto: `Se agruparán ${pendientes.length} cuotas (${fmtEUR2(total(pendientes))}) cuyo método de pago es domiciliación.`, ok: 'Crear remesa' })) return;
    try {
      const r = await api.ins('ac_remesas', { curso_id: curso.id, mes: mesSel.value, fecha_cargo: fechaCargo.value || null, nombre: `Remesa ${capitalizar(mesSel.value)}` });
      await api.updMany('ac_cuotas', pendientes.map((c) => c.id), { remesa_id: r.id });
      toast('Remesa creada'); refrescar();
    } catch (ex) { toast(ex.message, 'error'); }
  });
  nueva.disabled = !editor;

  clear(view,
    cabecera(`Remesas · ${curso.nombre}`, 'Cobros por domiciliación, un cargo por responsable', mesSel, h('label', { class: 'small muted' }, 'Fecha de cargo ', fechaCargo), nueva),
    tabla([
      { t: 'Remesa', v: (r) => h('strong', {}, r.nombre || capitalizar(r.mes)) },
      { t: 'Mes', v: (r) => capitalizar(r.mes) },
      { t: 'Cargo', v: (r) => fmtFecha(r.fecha_cargo) },
      { t: 'Cuotas', num: true, v: (r) => por(r).length },
      { t: 'Total', num: true, v: (r) => fmtEUR2(total(por(r))) },
      { t: 'Cobrado', num: true, v: (r) => fmtEUR2(total(por(r).filter((c) => c.estado === 'pagado'))) },
      { t: 'Devuelto', num: true, v: (r) => fmtEUR2(total(por(r).filter((c) => c.estado === 'devuelto'))) },
      { t: 'Estado', v: (r) => pill(r.estado, r.estado === 'cerrada' ? 'ok' : r.estado === 'enviada' ? 'warn' : 'off') },
    ], remesas, { onClick: (r) => abrirRemesa(r, por(r), alPor, ctx), vacio: 'Aún no hay remesas este curso.' }));
}

async function abrirRemesa(r, cuotasR, alPor, ctx) {
  const d = drawer({ titulo: `${r.nombre || capitalizar(r.mes)} · ${fmtFecha(r.fecha_cargo)}`, ancho: 820 });
  const editor = ctx.edita('ac_remesas');
  const respIds = [...new Set(cuotasR.map((c) => alPor.get(c.alumno_id)?.responsable_id).filter(Boolean))];
  const priv = new Map((await api.privados(respIds)).map((p) => [p.responsable_id, p]));
  // una línea por responsable (un solo cargo aunque tenga varios hijos)
  const grupos = new Map();
  for (const c of cuotasR) {
    const a = alPor.get(c.alumno_id); const k = a?.responsable_id || `sin-${c.alumno_id}`;
    if (!grupos.has(k)) grupos.set(k, { resp: a?.responsable, id: a?.responsable_id, cuotas: [], alumnos: [] });
    const g = grupos.get(k); g.cuotas.push(c); g.alumnos.push(nombreAlumno(a));
  }
  const lineas = [...grupos.values()].sort((x, y) => (x.resp?.apellidos || '').localeCompare(y.resp?.apellidos || ''));
  const estadoGrupo = (g) => (g.cuotas.every((c) => c.estado === 'pagado') ? 'pagado' : g.cuotas.some((c) => c.estado === 'devuelto') ? 'devuelto' : 'pendiente');

  const pintar = () => {
    clear(d.cuerpo,
      h('div', { class: 'kpi-row' }, ...[['Total', cuotasR], ['Cobrado', cuotasR.filter((c) => c.estado === 'pagado')], ['Devuelto', cuotasR.filter((c) => c.estado === 'devuelto')]].map(([l, c]) => h('div', { class: 'card kpi' }, h('div', { class: 'label' }, l), h('div', { class: 'value' }, fmtEUR2(c.reduce((s, x) => s + Number(x.importe), 0)))))),
      tabla([
        { t: 'Responsable', v: (g) => (g.resp ? `${g.resp.apellidos}, ${g.resp.nombre}` : 'Sin responsable') },
        { t: 'Alumnos', v: (g) => g.alumnos.join(' · ') },
        { t: 'IBAN', v: (g) => { const i = priv.get(g.id)?.iban; return i ? enmascarar(i) : pill('sin IBAN', 'warn'); } },
        { t: 'Importe', num: true, v: (g) => fmtEUR2(g.cuotas.reduce((s, c) => s + Number(c.importe), 0)) },
        { t: 'Estado', v: (g) => { const e = estadoGrupo(g); const b = h('button', { class: `pill pill-btn ${e === 'pagado' ? 'ok' : e === 'devuelto' ? 'warn' : 'off'}`, type: 'button', disabled: !editor, title: 'Clic: cobrado/pendiente · Alt+clic: devuelto' }, e);
          b.addEventListener('click', async (ev) => { const nuevo = ev.altKey ? 'devuelto' : e === 'pagado' ? 'pendiente' : 'pagado';
            try { await api.updMany('ac_cuotas', g.cuotas.map((c) => c.id), { estado: nuevo, fecha_pago: nuevo === 'pagado' ? (r.fecha_cargo || hoyISO()) : null }); g.cuotas.forEach((c) => { c.estado = nuevo; }); pintar(); } catch (ex) { toast(ex.message, 'error'); } });
          return b; } },
      ], lineas));
  };
  pintar();
  const estadoSel = sel([['borrador', 'Borrador'], ['enviada', 'Enviada al banco'], ['cerrada', 'Cerrada']], r.estado, { disabled: !editor });
  estadoSel.addEventListener('change', async () => { try { await api.upd('ac_remesas', r.id, { estado: estadoSel.value }); toast('Estado actualizado'); } catch (ex) { toast(ex.message, 'error'); } });
  const csv = h('button', { class: 'btn', type: 'button', disabled: !editor, onclick: () => descargarCSV(`remesa-${r.mes}.csv`, [['Responsable', 'IBAN', 'Importe', 'Alumnos', 'Concepto'], ...lineas.map((g) => [g.resp ? `${g.resp.nombre} ${g.resp.apellidos}` : '', priv.get(g.id)?.iban || '', g.cuotas.reduce((s, c) => s + Number(c.importe), 0).toFixed(2).replace('.', ','), g.alumnos.join(' / '), `MEH ${r.mes}`])]) }, 'Descargar CSV');
  const todo = h('button', { class: 'btn', type: 'button', disabled: !editor, onclick: async () => {
    try { await api.updMany('ac_cuotas', cuotasR.map((c) => c.id), { estado: 'pagado', fecha_pago: r.fecha_cargo || hoyISO() }); cuotasR.forEach((c) => { c.estado = 'pagado'; }); pintar(); toast('Todo marcado como cobrado'); } catch (ex) { toast(ex.message, 'error'); } } }, 'Marcar todo cobrado');
  const borrar = ctx.esAdmin() ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
    if (!await confirmar({ titulo: 'Eliminar remesa', texto: 'Las cuotas vuelven a quedar sin remesa (no se borran).', ok: 'Eliminar', peligro: true })) return;
    try { await api.del('ac_remesas', r.id); d.cerrar(); refrescar(); } catch (ex) { toast(ex.message, 'error'); } } }, 'Eliminar') : h('span');
  d.pie.append(borrar, h('div', { class: 'ac-fila' }, estadoSel, csv, todo));
}
