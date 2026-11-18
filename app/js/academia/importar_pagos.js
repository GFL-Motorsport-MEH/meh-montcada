// Importar pagos desde el export del CRM («pagos_alumnos_….xlsx»: un recibo por línea).
// Cada línea se convierte en el cobro de un alumno (welcome pack o mensualidad) y, si se pide, las domiciliaciones
// se agrupan en remesas históricas (una por mes y fecha de cargo). Se enlaza con el alumno por su nº (numero_referencia) o por nombre.
import { h, clear, cargando, toast, normalizar, fmtEUR2 } from '../ui.js';
import * as api from './api.js';
import { cabecera, tabla, pill, guardarBoton, nombreAlumno } from './kit.js';
import { parseFecha } from './importar.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const t = (v) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const claveNombre = (s) => normalizar(String(s ?? '')).split(/\s+/).filter(Boolean).sort().join(' ');
// curso (año de inicio) al que pertenece un cobro: de septiembre a diciembre empieza ese año; de enero a mayo, el año anterior; el welcome pack de junio-agosto es del curso que empieza
export function inicioCurso({ mes, fechaPago, concepto }) {
  const f = new Date(`${fechaPago}T12:00:00`); const y = f.getFullYear(); const m = f.getMonth();
  if (concepto === 'mensualidad' && mes) return MESES.indexOf(mes) >= 8 ? (m <= 3 ? y - 1 : y) : (m >= 8 ? y : y - 1);
  return m >= 5 ? y : y - 1;
}
export function mesDe(desc, fechaPago) {
  const d = normalizar(desc); const hit = MESES.find((m) => new RegExp(`\\b${m}\\b`).test(d));
  return hit || (fechaPago ? MESES[new Date(`${fechaPago}T12:00:00`).getMonth()] : '');
}
const metodo = (m) => { const s = normalizar(m); return /domicil/.test(s) ? 'Domiciliacion' : /tarjeta|tpv/.test(s) ? 'TPV / Tarjeta' : /efectivo/.test(s) ? 'Efectivo' : /transfer/.test(s) ? 'Transferencia' : t(m) || null; };

// convierte las líneas del CRM en cobros por alumno, concepto y mes
export function agruparRecibos(filas) {
  const lineas = filas.map((r) => ({ num: t(r.numero_referencia), nombre: t(r.nombre_alumno), fecha: parseFecha(r.fecha_pago), tipo: t(r.tipoOperacion), recibo: t(r.numero_recibo), metodo: t(r.metodo_pago), modalidad: t(r.modalidad_pago), desc: t(r.descripcion_detalle_factura), importe: num(r.importe) }))
    .filter((l) => l.desc && l.fecha);
  const rect = lineas.filter((l) => l.tipo === 'RECTIFICACION');
  const base = lineas.filter((l) => l.tipo !== 'RECTIFICACION');
  const cobros = new Map(); const sueltos = [];
  // cada recibo: sus líneas de descuento se suman a la línea principal del mismo recibo
  const porRecibo = new Map(); for (const l of base) (porRecibo.get(`${l.recibo}|${l.num}`) || porRecibo.set(`${l.recibo}|${l.num}`, []).get(`${l.recibo}|${l.num}`)).push(l);
  for (const ls of porRecibo.values()) {
    const desc = ls.filter((l) => /^descuento/i.test(l.desc)); const principales = ls.filter((l) => !/^descuento/i.test(l.desc));
    if (!principales.length) { sueltos.push(...desc); continue; }
    const dto = desc.reduce((s, l) => s + l.importe, 0);
    principales.forEach((l, i) => {
      const concepto = /^welcome/i.test(l.desc) ? 'welcome_pack' : /^mensualidad/i.test(l.desc) ? 'mensualidad' : 'otro';
      const mes = concepto === 'mensualidad' ? mesDe(l.desc, l.fecha) : '';
      const ini = inicioCurso({ mes, fechaPago: l.fecha, concepto });
      const k = `${l.num || claveNombre(l.nombre)}|${ini}|${concepto}|${mes}`;
      const prev = cobros.get(k);
      const imp = l.importe + (i === 0 ? dto : 0);
      if (prev) { prev.importe += imp; prev.recibos.push(l.recibo); } else cobros.set(k, { num: l.num, nombre: l.nombre, inicio: ini, concepto, mes, importe: imp, fecha: l.fecha, metodo: metodo(l.metodo), modalidad: l.modalidad, recibos: [l.recibo], desc: l.desc, rectificado: false });
    });
  }
  for (const r of rect) for (const c of cobros.values()) if ((r.num && c.num === r.num || claveNombre(r.nombre) === claveNombre(c.nombre)) && /^welcome/i.test(r.desc) === (c.concepto === 'welcome_pack')) c.rectificado = true;
  return { cobros: [...cobros.values()], rectificaciones: rect.length, sueltos: sueltos.length };
}

export async function renderImportarPagos(view, ctx) {
  const editor = ctx.edita('ac_pagos'); const salida = h('div');
  const input = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', disabled: !editor, 'aria-label': 'Archivo Excel de pagos' });
  const chkRemesas = h('input', { type: 'checkbox', checked: true });
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    clear(salida, cargando());
    try {
      const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const hoja = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: null });
      if (!hoja.length || !('descripcion_detalle_factura' in hoja[0])) { clear(salida, h('div', { class: 'banner warn' }, 'No parece el export de pagos del CRM (faltan columnas como descripcion_detalle_factura). Si es la hoja PAGOS de Control Alumnos, se importa aparte.')); return; }
      await previa(hoja);
    } catch (ex) { clear(salida, h('div', { class: 'banner error' }, 'No se ha podido leer el archivo: ' + ex.message)); }
  });

  async function previa(hoja) {
    const { cobros, rectificaciones, sueltos } = agruparRecibos(hoja);
    const [alumnos, { supabase }] = [await api.alumnos(), await import('../db.js')];
    const { data: cursos } = await supabase.from('cursos').select('id,nombre,fecha_inicio');
    const cursoDe = (ini) => (cursos || []).find((c) => c.nombre.startsWith(String(ini)) || (c.fecha_inicio || '').startsWith(String(ini)));
    const porNum = new Map(alumnos.filter((a) => a.num).map((a) => [String(a.num), a])); const porNombre = new Map(); const dup = new Set();
    for (const a of alumnos) { const k = claveNombre(`${a.nombre} ${a.apellidos}`); if (porNombre.has(k)) dup.add(k); porNombre.set(k, a); }
    const ok = []; const sinAlumno = new Set(); const sinCurso = new Set();
    for (const c of cobros) {
      const a = (c.num && porNum.get(c.num)) || (!dup.has(claveNombre(c.nombre)) && porNombre.get(claveNombre(c.nombre))) || null;
      if (!a) { sinAlumno.add(c.nombre || c.num); continue; }
      const cu = cursoDe(c.inicio); if (!cu) { sinCurso.add(`${c.inicio}/${c.inicio + 1}`); continue; }
      ok.push({ ...c, a, curso: cu });
    }
    const porCurso = new Map(); ok.forEach((c) => porCurso.set(c.curso.nombre, (porCurso.get(c.curso.nombre) || 0) + 1));
    const total = ok.reduce((s, c) => s + c.importe, 0);
    clear(salida, h('div', { class: 'card' },
      h('p', {}, h('strong', {}, `${ok.length} cobros`), ` listos (${fmtEUR2(total)} en total) a partir de ${hoja.length} líneas de recibo. `, [...porCurso].map(([n, k]) => pill(`${k} en ${n}`, 'off'))),
      h('p', { class: 'small muted' }, `${sinAlumno.size} alumnos no encontrados (importa antes los alumnos o revisa nombres) · ${sinCurso.size ? `faltan los cursos ${[...sinCurso].join(', ')}` : 'cursos encontrados'} · ${rectificaciones} rectificaciones del CRM (los cobros afectados se marcan «revisar») · ${sueltos} descuentos sin cobro asociado.`),
      tabla([{ t: 'Alumno', v: (c) => nombreAlumno(c.a) }, { t: 'Curso', v: (c) => c.curso.nombre }, { t: 'Concepto', v: (c) => (c.concepto === 'welcome_pack' ? 'Welcome pack' : c.concepto === 'mensualidad' ? `Mensualidad ${c.mes}` : 'Otro') }, { t: 'Importe', num: true, v: (c) => fmtEUR2(c.importe) }, { t: 'Método', v: (c) => c.metodo || '' }, { t: 'Fecha', v: (c) => c.fecha }], ok.slice(0, 8)),
      sinAlumno.size ? h('details', {}, h('summary', {}, 'Ver los alumnos no encontrados'), h('ul', {}, [...sinAlumno].slice(0, 60).map((s) => h('li', {}, s)))) : null,
      h('label', { class: 'check' }, chkRemesas, ' Crear también las remesas históricas con las domiciliaciones (una por mes y fecha de cargo)'),
      ok.length ? guardarBoton(`Importar ${ok.length} cobros`, async () => {
        try {
          let remesas = new Map();
          if (chkRemesas.checked) {
            const crear = new Map(); for (const c of ok.filter((x) => x.metodo === 'Domiciliacion' && x.concepto === 'mensualidad')) crear.set(`${c.curso.id}|${c.mes}|${c.fecha}`, { curso_id: c.curso.id, mes: c.mes, nombre: `Remesa ${c.mes} (CRM ${c.fecha})`, fecha_cargo: c.fecha, estado: 'cerrada', comentario: 'Importada del CRM' });
            const previas = await api.remesas(ctx.cursoActual().id);
            const hechas = await Promise.all([...new Set([...crear.values()].map((r) => r.curso_id))].map((id) => supabase.from('ac_remesas').select('*').eq('curso_id', id)));
            const existentes = hechas.flatMap((r) => r.data || []); void previas;
            for (const [k, r] of crear) { const e = existentes.find((x) => x.curso_id === r.curso_id && x.mes === r.mes && x.fecha_cargo === r.fecha_cargo); remesas.set(k, e || (await api.ins('ac_remesas', r))); }
          }
          const filas = ok.map((c) => ({ alumno_id: c.a.id, curso_id: c.curso.id, concepto: c.concepto, mes: c.mes, importe: Math.max(0, Math.round(c.importe * 100) / 100), estado: 'pagado', fecha_pago: c.fecha, metodo_pago: c.metodo,
            remesa_id: remesas.get(`${c.curso.id}|${c.mes}|${c.fecha}`)?.id || null, comentario: c.rectificado ? 'CRM: hay una rectificación de este recibo, revisar' : null }));
          const r = await api.insMany('ac_cuotas', filas, { onConflict: 'alumno_id,curso_id,concepto,mes', ignorar: false });
          toast(`${r.length} cobros importados${remesas.size ? ` y ${remesas.size} remesas` : ''}.`); location.hash = '#/ac_pagos';
        } catch (ex) { toast('Error al importar: ' + ex.message, 'error'); }
      }) : null));
  }

  clear(view, cabecera('Importar pagos', 'Carga el export de pagos del CRM («pagos_alumnos_….xlsx»)', h('a', { class: 'btn small', href: '#/ac_pagos' }, '← Volver a Pagos')),
    h('div', { class: 'banner' }, h('strong', {}, 'Importa antes los alumnos. '), 'Cada recibo del CRM pasa a ser un cobro «pagado» del alumno (se enlaza por su nº de alumno o por nombre). Si el cobro ya existe se actualiza con los datos del CRM. Los descuentos se restan del importe del recibo.'),
    editor ? null : h('div', { class: 'banner warn' }, 'Tu rol no permite importar.'),
    h('div', { class: 'card' }, h('p', { class: 'small' }, 'Elige el Excel que descargas del CRM de la franquicia (pagos de alumnos). Se lee en tu navegador.'), input), salida);
}
