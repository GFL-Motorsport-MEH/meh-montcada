// TRABAJADORES · Contrato y horario: contratos de cada persona (tipo, puesto, jornada, horas semanales, fechas) y su horario semanal de contrato.
// Cada trabajador ve lo suyo; quien gestiona (permiso «todo» + editar) elige a la persona y lo cambia.
import { h, clear, cargando, toast, confirmar, fmtFecha, hoyISO } from '../ui.js';
import * as api from './api.js';
import { campo, sel, txt, fecha, numero, tabla, cabecera, refrescar, drawer, DIAS } from '../academia/kit.js';
import { abrir } from './documentos.js';
import { TIPOS_CONTRATO, NOM_CONTRATO, JORNADAS, hhmm, fmtHoras, sumaHoras, vigente, diasHasta, personasVisibles, nombreUsuario, semana, nombreDia } from './util.js';

let verPersona = '';

function formContrato(c, personaId, personas) {
  const d = drawer({ titulo: c ? 'Editar contrato' : 'Nuevo contrato', ancho: 460 });
  const F = { quien: sel(personas.map((u) => [u.id, nombreUsuario(u)]), c?.profile_id || personaId), tipo: sel(TIPOS_CONTRATO, c?.tipo || 'indefinido'), categoria: txt(c?.categoria, { placeholder: 'Profesora, coordinación, administración…' }),
    jornada: sel(JORNADAS, c?.jornada || 'parcial'), horas: numero(c?.horas_semana, { step: '0.5', placeholder: '20' }), inicio: fecha(c?.fecha_inicio || hoyISO()), fin: fecha(c?.fecha_fin), notas: txt(c?.notas) };
  d.cuerpo.append(h('div', { class: 'form-section' }, campo('Trabajador', F.quien, { full: true }), campo('Tipo de contrato', F.tipo), campo('Puesto', F.categoria), campo('Jornada', F.jornada), campo('Horas por semana', F.horas),
    campo('Fecha de inicio', F.inicio, { req: true }), campo('Fecha de fin (vacía = sin fin)', F.fin), campo('Notas', F.notas, { full: true })));
  const guardar = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    if (!F.inicio.value) { toast('Pon la fecha de inicio.', 'error'); return; }
    if (F.fin.value && F.fin.value < F.inicio.value) { toast('La fecha de fin es anterior a la de inicio.', 'error'); return; }
    const fila = { profile_id: F.quien.value, tipo: F.tipo.value, categoria: F.categoria.value.trim() || null, jornada: F.jornada.value, horas_semana: F.horas.value === '' ? null : Number(String(F.horas.value).replace(',', '.')),
      fecha_inicio: F.inicio.value, fecha_fin: F.fin.value || null, notas: F.notas.value.trim() || null };
    guardar.disabled = true;
    try { if (c) await api.upd('tr_contratos', c.id, fila); else await api.ins('tr_contratos', fila); toast('Contrato guardado'); d.cerrar(); refrescar(); } catch (ex) { toast(ex.message, 'error'); guardar.disabled = false; }
  } }, 'Guardar');
  d.pie.append(guardar, h('button', { class: 'btn ghost', type: 'button', onclick: d.cerrar }, 'Cancelar'));
}

export async function renderContrato(view, ctx) {
  clear(view, cargando());
  const yo = ctx.state.perfil;
  const veTodos = ctx.ve('tr_contrato');
  const gestiona = veTodos && ctx.edita('tr_contrato');
  const [personas, contratos, franjas, docs] = await Promise.all([personasVisibles(ctx, api, ['tr_contrato']), api.contratos(), api.horario(), ctx.veAlgo('ac_portal') ? api.portalDocs().catch(() => []) : Promise.resolve([])]);
  if (!personas.some((u) => u.id === verPersona)) verPersona = yo.id;
  const hoy = hoyISO();
  const nombreDe = new Map(personas.map((u) => [u.id, nombreUsuario(u)]));

  const pintar = () => {
    const pid = verPersona;
    const cs = contratos.filter((c) => c.profile_id === pid);
    const fr = franjas.filter((f) => f.profile_id === pid);
    const vig = vigente(cs, hoy);
    const estado = (c) => (c.fecha_inicio > hoy ? 'Futuro' : c.fecha_fin && c.fecha_fin < hoy ? 'Finalizado' : 'En vigor');
    const filtro = veTodos ? h('div', { class: 'filters' }, sel(personas.map((u) => [u.id, nombreUsuario(u)]), pid, { onchange: (e) => { verPersona = e.target.value; pintar(); }, 'aria-label': 'Trabajador' })) : null;

    const tablaContratos = tabla([
      { t: 'Estado', s: estado, v: (c) => h('span', { class: 'pill ' + (estado(c) === 'En vigor' ? 'ok' : 'off') }, estado(c)) },
      { t: 'Contrato', v: (c) => NOM_CONTRATO[c.tipo] || c.tipo }, { t: 'Puesto', v: (c) => c.categoria || '' },
      { t: 'Jornada', v: (c) => (c.jornada === 'completa' ? 'Completa' : 'Parcial') },
      { t: 'Horas/semana', num: true, s: (c) => Number(c.horas_semana || 0), v: (c) => (c.horas_semana == null ? '' : fmtHoras(c.horas_semana)) },
      { t: 'Inicio', s: (c) => c.fecha_inicio, v: (c) => fmtFecha(c.fecha_inicio) }, { t: 'Fin', s: (c) => c.fecha_fin || '', v: (c) => (c.fecha_fin ? fmtFecha(c.fecha_fin) : 'Sin fin') },
      { t: 'Notas', v: (c) => c.notas || '' },
      ...(gestiona ? [{ t: '', sin: true, v: (c) => h('span', {}, h('button', { class: 'btn small', type: 'button', onclick: () => formContrato(c, pid, personas) }, 'Editar'), ' ',
        h('button', { class: 'btn small ghost', type: 'button', onclick: async () => {
          if (!await confirmar({ titulo: 'Quitar contrato', texto: `Se quitará el contrato de ${nombreDe.get(c.profile_id) || 'este trabajador'} que empieza el ${fmtFecha(c.fecha_inicio)}.`, ok: 'Quitar', peligro: true })) return;
          try { await api.del('tr_contratos', c.id); toast('Contrato quitado'); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
        } }, 'Quitar')) }] : []),
    ], cs, { vacio: 'No hay contratos registrados.', ordenable: false });

    const horasHorario = sumaHoras(fr);
    const aviso = vig?.horas_semana != null && fr.length && Math.abs(horasHorario - Number(vig.horas_semana)) > 0.01
      ? h('div', { class: 'banner warn', role: 'status' }, `El horario suma ${fmtHoras(horasHorario)} a la semana y el contrato en vigor dice ${fmtHoras(vig.horas_semana)}.`) : null;
    const venceEn = vig?.fecha_fin ? diasHasta(vig.fecha_fin, hoy) : null;
    const avisoFin = venceEn !== null && venceEn <= 60 ? h('div', { class: 'banner warn', role: 'status' }, `El contrato en vigor termina el ${fmtFecha(vig.fecha_fin)} (${venceEn === 0 ? 'hoy' : `en ${venceEn} días`}).`) : null;

    const docsContrato = docs.filter((d) => d.profile_id === pid && d.tipo === 'contrato');
    const secDocs = docsContrato.length ? h('div', { class: 'card' }, h('h3', { class: 'sub-titulo' }, 'Contratos firmados'),
      h('ul', { class: 'tr-lista' }, docsContrato.map((d) => h('li', {}, h('span', {}, h('strong', {}, d.titulo), d.periodo ? h('span', { class: 'muted' }, ' · ' + d.periodo) : null), h('button', { class: 'btn small', type: 'button', onclick: () => abrir(d.ruta) }, 'Abrir'))))) : null;

    const altaFranja = gestiona ? (() => {
      const F = { dia: sel([1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), DIAS[d]]), '1'), desde: h('input', { type: 'time', value: '16:00', 'aria-label': 'Desde' }), hasta: h('input', { type: 'time', value: '20:00', 'aria-label': 'Hasta' }), concepto: txt('', { placeholder: 'Clases, coordinación, reunión…' }) };
      const b = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        if (!F.desde.value || !F.hasta.value || F.hasta.value <= F.desde.value) { toast('La hora de fin debe ser posterior a la de inicio.', 'error'); return; }
        b.disabled = true;
        try { await api.ins('tr_horario', { profile_id: pid, contrato_id: vig?.id || null, dia: Number(F.dia.value), hora_inicio: F.desde.value, hora_fin: F.hasta.value, concepto: F.concepto.value.trim() || null }); toast('Franja añadida'); refrescar(); } catch (ex) { toast(ex.message, 'error'); b.disabled = false; }
      } }, 'Añadir franja');
      return h('div', { class: 'form-section' }, h('h3', {}, 'Añadir franja al horario'), campo('Día', F.dia), campo('Desde', F.desde), campo('Hasta', F.hasta), campo('Concepto', F.concepto), h('div', { class: 'full' }, b));
    })() : null;
    const listaFranjas = gestiona && fr.length ? tabla([
      { t: 'Día', s: (f) => f.dia, v: (f) => nombreDia(f.dia) }, { t: 'Horario', s: (f) => hhmm(f.hora_inicio), v: (f) => `${hhmm(f.hora_inicio)}–${hhmm(f.hora_fin)}` }, { t: 'Horas', num: true, s: (f) => sumaHoras([f]), v: (f) => fmtHoras(sumaHoras([f])) }, { t: 'Concepto', v: (f) => f.concepto || '' },
      { t: '', sin: true, v: (f) => h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { try { await api.del('tr_horario', f.id); toast('Franja quitada'); refrescar(); } catch (ex) { toast(ex.message, 'error'); } } }, 'Quitar') },
    ], fr, { ordenable: false }) : null;

    clear(cont, filtro, avisoFin, h('div', { class: 'card' }, h('div', { class: 'tr-barra' }, h('h3', { class: 'sub-titulo', style: 'flex:1' }, 'Contratos'),
      gestiona ? h('button', { class: 'btn primary', type: 'button', onclick: () => formContrato(null, pid, personas) }, '+ Nuevo contrato') : null), tablaContratos),
    h('div', { class: 'card' }, h('h3', { class: 'sub-titulo' }, `Horario de contrato${fr.length ? ` · ${fmtHoras(horasHorario)} a la semana` : ''}`),
      fr.length ? semana(fr) : h('div', { class: 'muted' }, 'No hay horario de contrato registrado.'), aviso, listaFranjas, altaFranja), secDocs);
  };
  const cont = h('div', { style: 'display:flex; flex-direction:column; gap:12px' });
  pintar();
  clear(view, cabecera('Contrato y horario', veTodos ? 'Contratos y horario semanal de cada trabajador.' : `Hola, ${yo.nombre || yo.email}. Aquí ves tu contrato y tu horario.`), cont);
}
