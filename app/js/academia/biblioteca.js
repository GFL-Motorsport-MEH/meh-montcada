// Biblioteca: préstamos de libros y «mascotas viajeras», enlazados al alumno. Importa el Excel BIBLIOTECA-MASCOTAS.
import { vista as vistaEstado, leerV, guardarV, vincular, avisoFiltros, busqueda } from '../vista.js';
import { h, clear, cargando, toast, confirmar, fmtFecha, hoyISO, normalizar } from '../ui.js';
import * as api from './api.js';
import { parseFecha } from './importar.js';
import { campo, txt, area, fecha, sel, drawer, cabecera, tabla, pill, nombreAlumno, guardarBoton, buscadorAlumno, refrescar } from './kit.js';
import { COLOR_TIPO, pillTipo, enlazarAutomatico, renderStock, itemDePrestamo, urlPortada } from './biblioteca_stock.js';

const TIPOS = [['libro', 'Libro'], ['mascota', 'Mascota viajera']];
const claveNombre = (s) => normalizar(String(s ?? '')).split(/\s+/).filter(Boolean).sort().join(' ');
const t = (v) => (v === null || v === undefined ? '' : String(v).trim());
const DIAS_PLAZO = 14;
let vista = 'prestamos'; // pestaña abierta: préstamos o stock (se recuerda al refrescar; se lee al pintar)
const quien = (p) => (p.alumno ? nombreAlumno(p.alumno) : p.alumno_texto || (p.alumno_id ? 'Alumno de otro grupo' : '—'));

export async function renderBiblioteca(view, ctx) {
  clear(view, cargando());
  vista = leerV('biblioteca.vista', 'prestamos');
  const [prestamos, alumnos, items] = await Promise.all([api.prestamos(), api.alumnos(), api.bibItems()]);
  const editor = ctx.edita('ac_biblioteca');
  const recargar = () => { api.invalidar(); refrescar(); };
  const hoy = hoyISO();
  const f = vistaEstado('biblioteca.f', { q: '', tipo: '', estado: 'fuera' });
  const ESTADOS_B = [['fuera', 'Sin devolver'], ['tarde', `Con retraso (>${DIAS_PLAZO} d)`], ['devuelto', 'Devueltos'], ['', 'Todos']];
  const dias = (p) => Math.floor((new Date(hoy) - new Date(p.fecha_salida)) / 864e5);
  const tarde = (p) => !p.fecha_devolucion && p.fecha_salida && dias(p) > DIAS_PLAZO;
  const cont = h('div'); const resumen = h('div', { class: 'small muted' });
  function pintar() {
    const q = normalizar(f.q);
    const filas = prestamos.filter((p) => (!f.tipo || p.tipo === f.tipo) && (f.estado === '' || (f.estado === 'fuera' ? !p.fecha_devolucion : f.estado === 'tarde' ? tarde(p) : !!p.fecha_devolucion))
      && (!q || normalizar(`${quien(p)} ${p.adulto || ''} ${p.libro || ''}`).includes(q))).sort((a, b) => (b.fecha_salida || '').localeCompare(a.fecha_salida || ''));
    const fuera = prestamos.filter((p) => !p.fecha_devolucion);
    resumen.textContent = `${prestamos.length} préstamos · ${fuera.length} sin devolver · ${prestamos.filter(tarde).length} con más de ${DIAS_PLAZO} días fuera`;
    clear(cont, tabla([
      { t: 'Tipo', v: (p) => pillTipo(p.tipo) },
      { t: 'Alumno', v: (p) => h('strong', {}, h('span', { class: 'ac-punto', style: `background:${COLOR_TIPO[p.tipo]}` }), quien(p), p.alumno || !p.alumno_texto ? null : h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'sin enlazar')) },
      { t: 'Adulto', v: (p) => p.adulto || '' }, { t: 'Libro / nivel', v: (p) => { const it = itemDePrestamo(p, items); const u = urlPortada(it?.portada); return h('span', { class: 'bib-celda' }, u ? h('img', { class: 'bib-mini', src: u, alt: '', loading: 'lazy' }) : null, p.tipo === 'mascota' ? (p.nivel ? `Nivel ${p.nivel}` : '') : p.libro || ''); } },
      { t: 'Salida', v: (p) => fmtFecha(p.fecha_salida) },
      { t: 'Devolución', v: (p) => (p.fecha_devolucion ? fmtFecha(p.fecha_devolucion) : pill(tarde(p) ? `fuera ${dias(p)} d` : 'fuera', tarde(p) ? 'bad' : 'warn')) },
      { t: 'Estado', v: (p) => p.condiciones || '' },
    ], filas.slice(0, 3000), { onClick: (p) => abrir(p, { alumnos, items, ctx, recargar }), vacio: 'No hay préstamos con este filtro.' }));
  }
  const sinEnlazar = prestamos.filter((p) => !p.alumno_id && (p.alumno_texto || '').trim()).length;
  const cambiar = (v) => { vista = v; guardarV('biblioteca.vista', v); refrescar(); };
  const pestanas = h('div', { class: 'bib-tabs' },
    h('button', { type: 'button', class: 'btn small' + (vista === 'prestamos' ? ' primary' : ''), onclick: () => cambiar('prestamos') }, 'Préstamos'),
    h('button', { type: 'button', class: 'btn small' + (vista === 'stock' ? ' primary' : ''), onclick: () => cambiar('stock') }, `Stock (${items.length})`));
  const leyenda = h('div', { class: 'bib-leyenda small' }, pillTipo('libro'), pillTipo('mascota'));
  if (vista === 'stock') {
    const zona = h('div');
    clear(view, cabecera('Biblioteca y Mascotas', 'Stock de libros y mascotas viajeras, con su foto de portada', h('a', { class: 'btn small', href: '#/ac_biblioteca_importar' }, 'Importar del Excel')), pestanas, leyenda, zona);
    renderStock(zona, { items, prestamos, editor, recargar });
    return;
  }
  clear(view, cabecera('Biblioteca y Mascotas', 'Libros y mascotas viajeras que se llevan los alumnos',
    h('a', { class: 'btn small', href: '#/ac_biblioteca_importar' }, 'Importar del Excel'),
    editor && sinEnlazar ? h('button', { class: 'btn small', type: 'button', title: 'Enlaza los nombres escritos a mano con la ficha del alumno que más se parece', onclick: () => enlazarAutomatico({ prestamos, alumnos, recargar }) }, `Enlazar alumnos (${sinEnlazar})`) : null,
    editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrir(null, { alumnos, items, ctx, recargar }) }, '+ Nuevo préstamo') : null),
    pestanas, leyenda,
    h('div', { class: 'filters filters-3' }, vincular(f, 'q', h('input', { type: 'search', placeholder: 'Buscar alumno, adulto o libro…', oninput: (e) => { f.q = e.target.value; pintar(); } })),
      vincular(f, 'tipo', sel([['', 'Libros y mascotas'], ...TIPOS], f.tipo, { onchange: (e) => { f.tipo = e.target.value; pintar(); } })),
      vincular(f, 'estado', sel(ESTADOS_B, f.estado, { onchange: (e) => { f.estado = e.target.value; pintar(); } }))),
    avisoFiltros(f, { etiquetas: { q: 'Búsqueda', tipo: 'Tipo', estado: 'Estado' }, formato: { q: busqueda, tipo: (v) => TIPOS.find(([k]) => k === v)?.[1] || v, estado: (v) => ESTADOS_B.find(([k]) => k === v)?.[1] || v }, alLimpiar: () => pintar() }),
    resumen, cont);
  pintar();
}

function abrir(p, { alumnos, items = [], ctx, recargar }) {
  const d = drawer({ titulo: p ? `Préstamo · ${quien(p)}` : 'Nuevo préstamo', ancho: 560 });
  const F = { tipo: sel(TIPOS, p?.tipo || 'libro'), al: buscadorAlumno(alumnos, { valorId: p?.alumno?.id }), texto: txt(p?.alumno_texto), adulto: txt(p?.adulto), libro: txt(p?.libro, { list: 'bib-titulos', placeholder: 'Elige del stock o escribe' }), nivel: txt(p?.nivel),
    salida: fecha(p?.fecha_salida || hoyISO()), dev: fecha(p?.fecha_devolucion), cond: txt(p?.condiciones, { placeholder: 'Perfecto, desgastado, perdido…' }), notas: area(p?.notas) };
  d.cuerpo.append(h('div', { class: 'form-section' }, campo('Tipo', F.tipo), campo('Alumno', F.al, { full: true }), campo('Nombre si no está en la lista', F.texto, { full: true }), campo('Adulto', F.adulto, { full: true }),
    campo('Libro', F.libro, { full: true }), h('datalist', { id: 'bib-titulos' }, items.filter((i) => i.tipo === 'libro').map((i) => h('option', { value: i.titulo }))), campo('Nivel (mascotas)', F.nivel), campo('Salida', F.salida), campo('Devolución', F.dev), campo('Estado al devolver', F.cond, { full: true }), campo('Notas', F.notas, { full: true })));
  const guardar = guardarBoton('Guardar', async () => {
    const al = F.al.getAlumno() || (p?.alumno ? alumnos.find((x) => x.id === p.alumno.id) : null);
    if (!al && !F.texto.value.trim()) { toast('Elige un alumno o escribe su nombre.', 'error'); return; }
    const fila = { tipo: F.tipo.value, alumno_id: al?.id || null, alumno_texto: al ? null : F.texto.value.trim(), adulto: F.adulto.value.trim() || null, libro: F.libro.value.trim() || null, nivel: F.nivel.value.trim() || null,
      item_id: null, fecha_salida: F.salida.value || null, fecha_devolucion: F.dev.value || null, condiciones: F.cond.value.trim() || null, notas: F.notas.value.trim() || null };
    fila.item_id = itemDePrestamo(fila, items)?.id || null;
    try { p ? await api.upd('ac_prestamos', p.id, fila) : await api.ins('ac_prestamos', fila); toast('Préstamo guardado'); d.cerrar(); recargar(); } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
  });
  guardar.disabled = !ctx.edita('ac_biblioteca');
  const devolver = p && !p.fecha_devolucion && ctx.edita('ac_biblioteca') ? h('button', { class: 'btn', type: 'button', onclick: async () => { try { await api.upd('ac_prestamos', p.id, { fecha_devolucion: hoyISO() }); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } }, 'Marcar devuelto hoy') : null;
  const borrar = p && ctx.edita('ac_biblioteca') ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Borrar préstamo', texto: quien(p), ok: 'Borrar', peligro: true })) { try { await api.del('ac_prestamos', p.id); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } } }, 'Borrar') : h('span');
  d.pie.append(borrar, devolver, guardar);
}

// ---- importación ----
function leerHojas(wb, XLSX) {
  const get = (nombre) => { const n = wb.SheetNames.find((x) => normalizar(x.trim()) === normalizar(nombre)); return n ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) : null; };
  const out = [];
  const lib = get('BIBLIOTECA');
  for (const r of (lib || []).slice(1)) if (t(r[0]) || t(r[2])) out.push({ tipo: 'libro', alumno_texto: t(r[0]), adulto: t(r[1]) || null, libro: t(r[2]) || null, nivel: null, fecha_salida: parseFecha(r[3]), fecha_devolucion: parseFecha(r[4]), condiciones: t(r[5]) || null });
  const mas = get('MASCOTASVIAJERAS');
  for (const r of (mas || []).slice(1)) if (t(r[1])) out.push({ tipo: 'mascota', nivel: t(r[0]) || null, alumno_texto: t(r[1]), adulto: t(r[2]) || null, libro: null, fecha_salida: parseFecha(r[3]), fecha_devolucion: parseFecha(r[4]), condiciones: t(r[5]) || null });
  return { filas: out, hojas: wb.SheetNames, falta: !lib && !mas };
}
const clavePrestamo = (p) => `${p.tipo}|${normalizar(p.alumno_texto || '')}|${normalizar(p.libro || p.nivel || '')}|${p.fecha_salida || ''}`;

export async function renderImportarBiblioteca(view, ctx) {
  const editor = ctx.edita('ac_biblioteca'); const salida = h('div');
  const input = h('input', { type: 'file', accept: '.xlsx,.xls', disabled: !editor, 'aria-label': 'Archivo Excel' });
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    clear(salida, cargando());
    try {
      const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const { filas, hojas, falta } = leerHojas(wb, XLSX);
      if (falta) { clear(salida, h('div', { class: 'banner warn' }, `No encuentro las hojas BIBLIOTECA ni MASCOTASVIAJERAS (hay: ${hojas.join(', ')}).`)); return; }
      const [alumnos, previos, items] = await Promise.all([api.alumnos(), api.prestamos(), api.bibItems()]);
      const porNombre = new Map(); const dup = new Set();
      for (const a of alumnos) { const k = claveNombre(`${a.nombre} ${a.apellidos}`); if (porNombre.has(k)) dup.add(k); porNombre.set(k, a); }
      const existentes = new Set(previos.map((p) => clavePrestamo({ ...p, alumno_texto: p.alumno_texto || (p.alumno ? `${p.alumno.nombre} ${p.alumno.apellidos}` : '') })));
      const prep = filas.map((r) => { const k = claveNombre(r.alumno_texto); const a = !dup.has(k) ? porNombre.get(k) : null; return { ...r, alumno_id: a?.id || null }; });
      const nuevos = prep.filter((r) => !existentes.has(clavePrestamo(r)));
      const sinEnlazar = new Set(nuevos.filter((r) => !r.alumno_id).map((r) => r.alumno_texto));
      clear(salida, h('div', { class: 'card' }, h('p', {}, h('strong', {}, `${nuevos.length} préstamos nuevos`), ` de ${prep.length} (${prep.length - nuevos.length} ya estaban). `, `${prep.filter((r) => r.tipo === 'libro').length} libros y ${prep.filter((r) => r.tipo === 'mascota').length} mascotas viajeras.`),
        h('p', { class: 'small muted' }, `${nuevos.filter((r) => r.alumno_id).length} se enlazan con la ficha del alumno; ${sinEnlazar.size} nombres quedan sin enlazar (alumnos que ya no están, o escritos distinto). Se guarda el nombre del Excel y se pueden enlazar después.`),
        nuevos.length ? guardarBoton(`Importar ${nuevos.length} préstamos`, async () => {
          try {
            await api.insMany('ac_prestamos', nuevos.map((r) => ({ tipo: r.tipo, item_id: itemDePrestamo(r, items)?.id || null, alumno_id: r.alumno_id, alumno_texto: r.alumno_id ? null : r.alumno_texto, adulto: r.adulto, libro: r.libro, nivel: r.nivel, fecha_salida: r.fecha_salida, fecha_devolucion: r.fecha_devolucion, condiciones: r.condiciones })));
            toast(`${nuevos.length} préstamos importados.`); location.hash = '#/ac_biblioteca';
          } catch (ex) { toast('Error al importar: ' + ex.message, 'error'); }
        }) : null));
    } catch (ex) { clear(salida, h('div', { class: 'banner error' }, 'No se ha podido leer el archivo: ' + ex.message)); }
  });
  clear(view, cabecera('Importar biblioteca y mascotas', 'Carga el Excel BIBLIOTECA-MASCOTAS', h('a', { class: 'btn small', href: '#/ac_biblioteca' }, '← Volver a Biblioteca y Mascotas')),
    editor ? null : h('div', { class: 'banner warn' }, 'Tu rol no permite importar.'),
    h('div', { class: 'card' }, h('p', { class: 'small' }, 'Elige BIBLIOTECA-MASCOTAS.xlsx (hojas BIBLIOTECA y MASCOTASVIAJERAS). Se lee en tu navegador. Volver a importar no duplica los préstamos.'), input), salida);
}
