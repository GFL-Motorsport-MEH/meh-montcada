// Seguimiento: contactos que aún no son alumnos (captación) y feed de anotaciones de todos los alumnos.
import { h, clear, cargando, toast, confirmar, fmtFecha, normalizar } from '../ui.js';
import * as api from './api.js';
import { campo, txt, area, fecha, sel, drawer, cabecera, tabla, pill, nombreAlumno, guardarBoton, buscadorAlumno, refrescar } from './kit.js';

let vista = 'contactos';

export async function renderSeguimiento(view, ctx) {
  clear(view, cargando());
  const [contactos, anotaciones, alumnos, ls] = await Promise.all([api.contactos(), api.anotaciones(), api.alumnos(), api.listas()]);
  const editor = ctx.edita('ac_seguimiento');
  const verContactos = ctx.ve('ac_seguimiento'); // con «lo suyo» no hay contactos de captación, solo anotaciones de sus alumnos
  if (!verContactos) vista = 'notas';
  const recargar = () => { api.invalidar(); refrescar(); };
  const cont = h('div');
  const f = { q: '', sit: '', tipo: '' };
  const seg = h('div', { class: 'segmented', role: 'tablist' }, [...(verContactos ? [['contactos', 'Contactos (captación)']] : []), ['notas', 'Anotaciones de alumnos']].map(([k, l]) =>
    h('button', { class: 'seg-btn', role: 'tab', type: 'button', 'aria-selected': String(vista === k), onclick: () => { vista = k; seg.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-selected', String(b.textContent === l))); f.q = ''; pintar(); } }, l)));
  const buscar = h('input', { type: 'search', placeholder: 'Buscar…', oninput: (e) => { f.q = e.target.value; pintarLista(); } });
  const filtroSel = h('span');
  const lista = h('div');

  function pintarLista() {
    const q = normalizar(f.q);
    if (vista === 'contactos') {
      const filas = contactos.filter((c) => (!f.sit || c.situacion === f.sit) && (!q || normalizar(`${c.nombre} ${c.telefono || ''} ${c.comentarios || ''}`).includes(q))).sort((a, b) => (b.fecha_contacto || '').localeCompare(a.fecha_contacto || ''));
      clear(lista, tabla([
        { t: 'Fecha', v: (c) => fmtFecha(c.fecha_contacto) }, { t: 'Nombre', v: (c) => h('strong', {}, c.nombre) }, { t: 'Teléfono', v: (c) => c.telefono || '' },
        { t: 'Edad', v: (c) => c.edad || '' }, { t: 'Nivel', v: (c) => c.nivel || '' }, { t: 'Comentarios', v: (c) => c.comentarios || '' },
        { t: 'Cómo nos conoció', v: (c) => c.como_nos_conocio || '' }, { t: 'Situación', v: (c) => pill(c.situacion, c.situacion === 'inscrito' ? 'ok' : c.situacion === 'descartado' ? 'off' : 'warn') },
      ], filas, { onClick: (c) => abrirContacto(c, { ls, alumnos, ctx, recargar }), vacio: 'No hay contactos.' }));
    } else {
      const filas = anotaciones.filter((n) => (!f.tipo || n.tipo === f.tipo) && (!q || normalizar(`${nombreAlumno(n.alumno)} ${n.texto}`).includes(q))).sort((a, b) => (b.fecha + b.created_at).localeCompare(a.fecha + a.created_at)).slice(0, 300);
      clear(lista, tabla([
        { t: 'Fecha', v: (n) => fmtFecha(n.fecha) }, { t: 'Alumno', v: (n) => h('strong', {}, nombreAlumno(n.alumno)) }, { t: 'Tipo', v: (n) => pill(n.tipo) },
        { t: 'Anotación', v: (n) => n.texto }, { t: 'Profesora', v: (n) => n.profesora?.nombre || '' },
      ], filas, { vacio: 'No hay anotaciones. Se escriben desde la ficha del alumno o con «+ Nueva anotación».' }));
    }
  }
  function pintar() {
    clear(filtroSel, vista === 'contactos' ? sel([['', 'Todas las situaciones'], ...(ls.situacion_contacto || []).map((s) => [s, s])], f.sit, { onchange: (e) => { f.sit = e.target.value; pintarLista(); } })
      : sel([['', 'Todos los tipos'], ...['nota', 'llamada', 'familia', 'incidencia', 'pago', 'progreso', 'tutoría'].map((s) => [s, s])], f.tipo, { onchange: (e) => { f.tipo = e.target.value; pintarLista(); } }));
    pintarLista();
  }
  const nuevo = editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => (vista === 'contactos' ? abrirContacto(null, { ls, alumnos, ctx, recargar }) : abrirNota({ alumnos, ctx, recargar })) }, '+ Nuevo') : null;
  clear(view, cabecera('Seguimiento', verContactos ? 'Captación de nuevos alumnos y notas del día a día' : 'Notas del día a día de tus alumnos', verContactos ? seg : null, nuevo), h('div', { class: 'filters filters-2' }, buscar, filtroSel), lista);
  pintar();
}

function abrirNota({ alumnos, ctx, recargar }) {
  const d = drawer({ titulo: 'Nueva anotación', ancho: 520 });
  const b = buscadorAlumno(alumnos); const tipo = sel(['nota', 'llamada', 'familia', 'incidencia', 'pago', 'progreso', 'tutoría'], 'nota'); const texto = area('', { rows: 5 });
  d.cuerpo.append(h('div', { class: 'form-section' }, campo('Alumno', b, { full: true }), campo('Tipo', tipo), campo('Anotación', texto, { full: true })));
  d.pie.append(h('span'), guardarBoton('Guardar', async () => {
    const a = b.getAlumno(); if (!a) { toast('Elige un alumno de la lista.', 'error'); return; } if (!texto.value.trim()) { toast('Escribe la anotación.', 'error'); return; }
    try { await api.ins('ac_anotaciones', { alumno_id: a.id, tipo: tipo.value, texto: texto.value.trim() }); toast('Anotación guardada'); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); }
  }));
}

function abrirContacto(c, { ls, alumnos, ctx, recargar }) {
  const d = drawer({ titulo: c ? c.nombre : 'Nuevo contacto', ancho: 560 });
  const F = { nombre: txt(c?.nombre), tel: txt(c?.telefono), edad: txt(c?.edad), nivel: txt(c?.nivel), conocio: txt(c?.como_nos_conocio, { list: 'dl-con2' }), sit: sel(ls.situacion_contacto || ['posible alumno'], c?.situacion || 'posible alumno'), fecha: fecha(c?.fecha_contacto || new Date().toISOString().slice(0, 10)), com: area(c?.comentarios, { rows: 4 }) };
  d.cuerpo.append(h('div', { class: 'form-section' }, campo('Nombre', F.nombre, { req: true }), campo('Teléfono', F.tel), campo('Edad', F.edad), campo('Nivel', F.nivel), campo('Cómo nos conoció', F.conocio), campo('Situación', F.sit), campo('Fecha de contacto', F.fecha), campo('Comentarios', F.com, { full: true }),
    h('datalist', { id: 'dl-con2' }, (ls.como_conocio || []).map((x) => h('option', { value: x })))));
  const guardar = guardarBoton('Guardar', async () => {
    if (!F.nombre.value.trim()) { toast('Falta el nombre.', 'error'); return; }
    const fila = { nombre: F.nombre.value.trim(), telefono: F.tel.value.trim() || null, edad: F.edad.value.trim() || null, nivel: F.nivel.value.trim() || null, como_nos_conocio: F.conocio.value.trim() || null, situacion: F.sit.value, fecha_contacto: F.fecha.value || null, comentarios: F.com.value.trim() || null };
    try { if (c) await api.upd('ac_contactos', c.id, fila); else await api.ins('ac_contactos', fila); toast('Guardado'); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); }
  });
  guardar.disabled = !ctx.edita('ac_seguimiento');
  const borrar = c && ctx.esAdmin() ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Borrar contacto', texto: c.nombre, ok: 'Borrar', peligro: true })) { try { await api.del('ac_contactos', c.id); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } } }, 'Borrar') : h('span');
  d.pie.append(borrar, guardar);
}
