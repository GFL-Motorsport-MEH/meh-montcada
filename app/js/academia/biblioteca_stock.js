// Biblioteca y Mascotas: stock (catálogo con fotos de portada), colores por tipo y enlazado automático de alumnos.
import { h, clear, toast, confirmar, normalizar } from '../ui.js';
import { supabase } from '../db.js';
import * as api from './api.js';
import { campo, txt, area, sel, drawer, guardarBoton } from './kit.js';

// ---- colores: un color para los libros y otro para las mascotas viajeras ----
export const COLOR_TIPO = { libro: '#2563eb', mascota: '#ea580c' };
export const NOMBRE_TIPO = { libro: 'Libro', mascota: 'Mascota' };
export const pillTipo = (tipo) => h('span', { class: 'ac-motivo', style: `--c:${COLOR_TIPO[tipo] || '#6b7280'}` }, NOMBRE_TIPO[tipo] || tipo);

// ---- enlazado automático de nombres escritos a mano con alumnos ----
const tokens = (s) => normalizar(String(s ?? '')).replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter((x) => x.length > 0);
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// 1 = igual, 0.85 = una letra de diferencia (palabras de 4+ letras), 0.5 = inicial («M.» con «Marta»)
const parecido = (a, b) => (a === b ? 1 : Math.min(a.length, b.length) >= 4 && lev(a, b) <= 1 ? 0.85 : (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b)) ? 0.5 : 0);

export function puntuar(texto, alumno) {
  const T = tokens(texto); const A = tokens(`${alumno.nombre} ${alumno.apellidos}`);
  if (!T.length || !A.length) return { score: 0, n: 0 };
  const usados = new Set(); let suma = 0; let n = 0;
  for (const t of T) {
    let mejor = 0; let k = -1;
    A.forEach((a, i) => { if (usados.has(i)) return; const p = parecido(t, a); if (p > mejor) { mejor = p; k = i; } });
    if (k >= 0) { usados.add(k); suma += mejor; if (mejor >= 0.85) n++; }
  }
  const cobertura = suma / T.length; const dice = (2 * suma) / (T.length + A.length);
  return { score: 0.7 * cobertura + 0.3 * dice, n, cobertura };
}
// Devuelve { alumno, score } si hay una coincidencia clara; si no, null (poco parecido o empate entre varios alumnos).
export function mejorAlumno(texto, alumnos) {
  if (tokens(texto).length < 2) return null;
  let a1 = null; let a2 = null;
  for (const al of alumnos) {
    const r = puntuar(texto, al);
    if (r.n < 2 || r.cobertura < 0.75) continue;
    if (!a1 || r.score > a1.score) { a2 = a1; a1 = { alumno: al, score: r.score }; } else if (!a2 || r.score > a2.score) a2 = { alumno: al, score: r.score };
  }
  if (!a1 || a1.score < 0.6) return null;
  if (a2 && a1.score - a2.score < 0.05) return null;
  return a1;
}

export async function enlazarAutomatico({ prestamos, alumnos, recargar }) {
  const pend = prestamos.filter((p) => !p.alumno_id && (p.alumno_texto || '').trim());
  if (!pend.length) { toast('No hay préstamos sin enlazar.'); return; }
  const cache = new Map(); const porAlumno = new Map(); let ok = 0;
  for (const p of pend) {
    const k = normalizar(p.alumno_texto).trim();
    if (!cache.has(k)) cache.set(k, mejorAlumno(p.alumno_texto, alumnos));
    const r = cache.get(k); if (!r) continue;
    ok++; if (!porAlumno.has(r.alumno.id)) porAlumno.set(r.alumno.id, []); porAlumno.get(r.alumno.id).push(p.id);
  }
  if (!ok) { toast(`Ninguno de los ${pend.length} nombres tiene una coincidencia clara con un alumno.`, 'error'); return; }
  const nombres = [...new Set(pend.map((p) => normalizar(p.alumno_texto).trim()))];
  const ejemplos = nombres.filter((n) => cache.get(n)).slice(0, 5).map((n) => `${pend.find((p) => normalizar(p.alumno_texto).trim() === n).alumno_texto} → ${cache.get(n).alumno.apellidos}, ${cache.get(n).alumno.nombre}`).join(' · ');
  if (!(await confirmar({ titulo: 'Enlazar alumnos', texto: `Se enlazarán ${ok} de ${pend.length} préstamos con la ficha del alumno de mayor coincidencia. Los otros ${pend.length - ok} se quedan como están (sin coincidencia clara). Ej.: ${ejemplos}`, ok: `Enlazar ${ok}` }))) return;
  try {
    for (const [alumnoId, ids] of porAlumno) await api.updMany('ac_prestamos', ids, { alumno_id: alumnoId, alumno_texto: null });
    toast(`${ok} préstamos enlazados.`); recargar();
  } catch (ex) { toast('No se ha podido enlazar: ' + ex.message, 'error'); }
}

// ---- fotos de portada (bucket público «portadas») ----
export const urlPortada = (ruta) => (ruta ? supabase.storage.from('portadas').getPublicUrl(ruta).data.publicUrl : null);

// Reduce la foto a 900 px de lado máximo (JPEG) antes de subirla.
async function reducir(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se ha podido leer la imagen'))), 'image/jpeg', 0.85));
}
async function subirPortada(itemId, file) {
  const blob = await reducir(file);
  const ruta = `${itemId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('portadas').upload(ruta, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(error.message);
  return ruta;
}
const quitarArchivo = (ruta) => (ruta ? supabase.storage.from('portadas').remove([ruta]).catch(() => null) : null);

export const claveTitulo = (s) => normalizar(String(s ?? '')).replace(/[^a-z0-9ñ]+/g, ' ').trim();
// Artículo del stock al que corresponde un préstamo (por título para libros, por nivel para mascotas)
export function itemDePrestamo(p, items) {
  if (p.item_id) return items.find((i) => i.id === p.item_id) || null;
  if (p.tipo === 'libro') return items.find((i) => i.tipo === 'libro' && claveTitulo(i.titulo) === claveTitulo(p.libro)) || null;
  return items.find((i) => i.tipo === 'mascota' && p.nivel && i.nivel === p.nivel) || null;
}

// ---- pestaña Stock ----
export function renderStock(cont, { items, prestamos, editor, recargar }) {
  const f = { q: '', tipo: '' };
  const fuera = (it) => prestamos.filter((p) => !p.fecha_devolucion && itemDePrestamo(p, items)?.id === it.id).length;
  const lista = h('div', { class: 'bib-grid' }); const resumen = h('div', { class: 'small muted' });
  function pintar() {
    const q = normalizar(f.q);
    const filas = items.filter((i) => (!f.tipo || i.tipo === f.tipo) && (!q || normalizar(`${i.titulo} ${i.nivel || ''}`).includes(q))).sort((a, b) => a.tipo.localeCompare(b.tipo) || a.titulo.localeCompare(b.titulo, 'es'));
    const ej = (t) => items.filter((i) => i.tipo === t).reduce((s, i) => s + i.ejemplares, 0);
    resumen.textContent = `${items.filter((i) => i.tipo === 'libro').length} libros (${ej('libro')} ejemplares) · ${items.filter((i) => i.tipo === 'mascota').length} tipos de mascota (${ej('mascota')} ejemplares) · ${prestamos.filter((p) => !p.fecha_devolucion).length} préstamos sin devolver`;
    clear(lista, filas.length ? filas.map((it) => {
      const disp = it.ejemplares - fuera(it); const url = urlPortada(it.portada);
      return h('button', { type: 'button', class: 'bib-card', style: `--c:${COLOR_TIPO[it.tipo]}`, onclick: () => abrirItem(it, { items, editor, recargar }) },
        h('span', { class: 'bib-foto' }, url ? h('img', { src: url, alt: `Portada de ${it.titulo}`, loading: 'lazy' }) : h('span', { class: 'bib-sin' }, it.tipo === 'mascota' ? '🧸' : '📘')),
        h('span', { class: 'bib-info' }, pillTipo(it.tipo), h('strong', {}, it.titulo),
          h('span', { class: 'small ' + (disp <= 0 ? 'bib-agotado' : 'muted') }, `${Math.max(disp, 0)} de ${it.ejemplares} disponibles`)));
    }) : h('div', { class: 'card empty' }, 'No hay artículos con este filtro.'));
  }
  clear(cont,
    h('div', { class: 'filters filters-3' }, h('input', { type: 'search', placeholder: 'Buscar libro o mascota…', oninput: (e) => { f.q = e.target.value; pintar(); } }),
      sel([['', 'Libros y mascotas'], ['libro', 'Libros'], ['mascota', 'Mascotas viajeras']], f.tipo, { onchange: (e) => { f.tipo = e.target.value; pintar(); } }),
      editor ? h('button', { class: 'btn primary', type: 'button', onclick: () => abrirItem(null, { items, editor, recargar }) }, '+ Añadir al stock') : h('span')),
    resumen, lista);
  pintar();
}

function abrirItem(it, { editor, recargar }) {
  const d = drawer({ titulo: it ? `Stock · ${it.titulo}` : 'Añadir al stock', ancho: 520 });
  const id = it?.id || crypto.randomUUID();
  const est = { portada: it?.portada || null, nueva: null, quitar: false };
  const F = { tipo: sel([['libro', 'Libro'], ['mascota', 'Mascota viajera']], it?.tipo || 'libro'), titulo: txt(it?.titulo), nivel: txt(it?.nivel, { placeholder: '1, 2…' }),
    ej: h('input', { type: 'number', min: '0', step: '1', value: it?.ejemplares ?? 1 }), notas: area(it?.notas) };
  const vista = h('div', { class: 'bib-preview' });
  const pintaFoto = () => {
    const url = est.nueva ? URL.createObjectURL(est.nueva) : est.quitar ? null : urlPortada(est.portada);
    clear(vista, url ? h('img', { src: url, alt: 'Portada' }) : h('span', { class: 'muted small' }, 'Sin foto de portada'));
  };
  const archivo = h('input', { type: 'file', accept: 'image/*', disabled: !editor, 'aria-label': 'Foto de portada' });
  archivo.addEventListener('change', () => { if (archivo.files[0]) { est.nueva = archivo.files[0]; est.quitar = false; pintaFoto(); } });
  const quitarBtn = h('button', { class: 'btn small', type: 'button', disabled: !editor, onclick: () => { est.nueva = null; est.quitar = true; archivo.value = ''; pintaFoto(); } }, 'Quitar foto');
  pintaFoto();
  d.cuerpo.append(h('div', { class: 'form-section' }, campo('Tipo', F.tipo), campo('Ejemplares que tenemos', F.ej), campo('Título / nombre', F.titulo, { full: true, req: true }), campo('Nivel (mascotas)', F.nivel),
    campo('Notas', F.notas, { full: true }), h('div', { class: 'field full' }, h('span', {}, 'Foto de la portada'), vista, h('div', { class: 'bib-foto-botones' }, archivo, quitarBtn))));
  const guardar = guardarBoton('Guardar', async () => {
    const titulo = F.titulo.value.trim(); if (!titulo) { toast('Escribe el título o el nombre.', 'error'); return; }
    try {
      let portada = est.quitar ? null : est.portada;
      if (est.nueva) portada = await subirPortada(id, est.nueva);
      const fila = { tipo: F.tipo.value, titulo, nivel: F.nivel.value.trim() || null, ejemplares: Math.max(0, parseInt(F.ej.value, 10) || 0), notas: F.notas.value.trim() || null, portada };
      it ? await api.upd('ac_biblioteca_items', it.id, fila) : await api.ins('ac_biblioteca_items', { id, ...fila });
      if (it?.portada && it.portada !== portada) await quitarArchivo(it.portada);
      toast('Guardado'); d.cerrar(); recargar();
    } catch (ex) { toast('No se ha guardado: ' + (/duplicate|unique/i.test(ex.message) ? 'ya existe un artículo con ese título' : ex.message), 'error'); }
  });
  guardar.disabled = !editor;
  const borrar = it && editor ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
    if (await confirmar({ titulo: 'Quitar del stock', texto: `${it.titulo}. Los préstamos ya registrados se conservan.`, ok: 'Quitar', peligro: true })) {
      try { await api.del('ac_biblioteca_items', it.id); await quitarArchivo(it.portada); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); }
    } } }, 'Quitar del stock') : h('span');
  d.pie.append(borrar, guardar);
}
