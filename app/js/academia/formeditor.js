// Editor visual de formularios: ajustes, cabecera con logo/foto, bloques (preguntas, textos, imágenes, páginas),
// condiciones, corrección automática y vista previa en vivo (con el mismo motor que ve la familia).
import { h, clear, toast, confirmar, normalizar } from '../ui.js';
import { supabase } from '../db.js';
import * as api from './api.js';
import { campo as campoLabel, area, sel, guardarBoton } from './kit.js';
import { crearFormulario } from './formrender.js';

// ---------- catálogo de bloques ----------
export const BLOQUES = [
  { g: 'Preguntas', t: 'texto', n: 'Texto corto', ic: 'Aa' }, { g: 'Preguntas', t: 'textarea', n: 'Texto largo', ic: '¶' },
  { g: 'Preguntas', t: 'email', n: 'Correo electrónico', ic: '@' }, { g: 'Preguntas', t: 'telefono', n: 'Teléfono', ic: '☎' },
  { g: 'Preguntas', t: 'numero', n: 'Número', ic: '#' }, { g: 'Preguntas', t: 'fecha', n: 'Fecha', ic: '📅' },
  { g: 'Preguntas', t: 'radio', n: 'Una opción (botones)', ic: '◉' }, { g: 'Preguntas', t: 'select', n: 'Una opción (desplegable)', ic: '▾' },
  { g: 'Preguntas', t: 'casillas', n: 'Varias opciones', ic: '☑' }, { g: 'Preguntas', t: 'escala', n: 'Escala (1–5…)', ic: '★' },
  { g: 'Preguntas', t: 'rejilla', n: 'Rejilla (horarios)', ic: '▦' }, { g: 'Preguntas', t: 'acepto', n: 'Casilla de aceptación', ic: '✔' },
  { g: 'Contenido', t: 'info', n: 'Texto informativo', ic: 'ℹ' }, { g: 'Contenido', t: 'imagen', n: 'Imagen', ic: '🖼' },
  { g: 'Contenido', t: 'seccion', n: 'Nueva página', ic: '⤓' },
];
const NOMBRE = Object.fromEntries(BLOQUES.map((b) => [b.t, b.n]));
const ICONO = Object.fromEntries(BLOQUES.map((b) => [b.t, b.ic]));
const CON_OPCIONES = ['radio', 'select', 'casillas'];
const DATOS_BASE = BLOQUES.filter((b) => b.g === 'Preguntas').map((b) => b.t);
const ES_DATO = (t) => DATOS_BASE.includes(t);
// los controles compuestos (barra de formato, miniatura + botones…) van en un div, no en un label: un label con botones dentro los rebautizaría
const campo = (label, nodo, o = {}) => (nodo.tagName === 'DIV' ? h('div', { class: 'field' + (o.full ? ' full' : '') }, h('span', {}, label, o.req ? h('span', { class: 'req' }, ' *') : null), nodo) : campoLabel(label, nodo, o));
const OPS = [['es', 'es'], ['no_es', 'no es'], ['relleno', 'está rellenada'], ['vacio', 'está vacía']];

export const slugDe = (s) => normalizar(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28);
const lineas = (t) => String(t || '').split('\n').map((x) => x.replace(/\|/g, '/').trim()).filter(Boolean);
const clonar = (x) => JSON.parse(JSON.stringify(x));

// reduce las fotos grandes del móvil antes de subirlas (máx. 1600 px, JPEG); deja tal cual PNG/GIF/WebP pequeños
async function prepararImagen(file) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('Usa una imagen JPG, PNG, WebP o GIF.');
  if (file.size < 600 * 1024 || file.type === 'image/gif') { if (file.size > 3 * 1024 * 1024) throw new Error('La imagen pesa más de 3 MB.'); return file; }
  try {
    const bmp = await createImageBitmap(file); const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const png = file.type === 'image/png' && file.size < 1.5 * 1024 * 1024;
    const blob = await new Promise((ok) => cv.toBlob(ok, png ? 'image/png' : 'image/jpeg', 0.86));
    if (blob && blob.size < file.size) return new File([blob], file.name, { type: blob.type });
  } catch { /* se sube el original */ }
  if (file.size > 3 * 1024 * 1024) throw new Error('La imagen pesa más de 3 MB.');
  return file;
}
export async function subirImagen(file) {
  const f = await prepararImagen(file);
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[f.type];
  const ruta = `${new Date().getFullYear()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from('formularios').upload(ruta, f, { contentType: f.type, upsert: false, cacheControl: '31536000' });
  if (error) throw new Error('No se ha podido subir la imagen: ' + error.message);
  return supabase.storage.from('formularios').getPublicUrl(ruta).data.publicUrl;
}
function elegirImagen(alSubir) {
  const inp = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', style: 'display:none' });
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { alSubir(await subirImagen(f)); } catch (ex) { toast(ex.message, 'error'); } };
  document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
}

// barra de formato sobre un cuadro de texto (negrita, cursiva, enlace, lista, título, línea, imagen)
function barraFormato(ta) {
  const cambiar = () => { ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus(); };
  const envolver = (a, b, ej) => () => { const { selectionStart: s, selectionEnd: e, value } = ta; ta.setRangeText(a + (value.slice(s, e) || ej) + b, s, e, 'select'); cambiar(); };
  const prefijo = (p) => () => { const s = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1; ta.setRangeText(p, s, s, 'end'); cambiar(); };
  const insertar = (t) => { const s = ta.selectionStart; ta.setRangeText(t, s, ta.selectionEnd, 'end'); cambiar(); };
  const b = (t, fn, title) => h('button', { type: 'button', class: 'btn ghost small', title, onclick: fn }, t);
  return h('div', { class: 'fe-barra' },
    b('N', envolver('**', '**', 'texto'), 'Negrita'), b('K', envolver('*', '*', 'texto'), 'Cursiva'),
    b('Enlace', () => { const u = window.prompt('Dirección del enlace (https://…)', 'https://'); if (u && /^(https?:\/\/|mailto:|tel:)/i.test(u)) { const { selectionStart: s, selectionEnd: e, value } = ta; ta.setRangeText(`[${value.slice(s, e) || 'pulsa aquí'}](${u})`, s, e, 'end'); cambiar(); } }, 'Insertar enlace'),
    b('• Lista', prefijo('- '), 'Lista con viñetas'), b('Título', prefijo('## '), 'Título'), b('— Línea', () => insertar('\n---\n'), 'Línea separadora'),
    b('Imagen', () => elegirImagen((u) => insertar(`\n![](${u})\n`)), 'Subir una imagen dentro del texto'));
}

// ---------- editor ----------
// base: definición inicial (copia de un formulario, de una plantilla o en blanco). existente: la fila de BD si se edita (null si es nuevo).
export function abrirEditor(view, { existente, base, ctx, volver }) {
  if (!document.querySelector('link[href="/css/fp.css"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/fp.css'; document.head.append(l); }
  const def = clonar({ titulo: '', slug: '', tipo: 'generico', activo: true, plantilla: false, descripcion: '', mensaje_final: '', imagen_cabecera: '', config: {}, campos: [], ...(base || {}) });
  def.config = def.config || {}; def.campos = def.campos || []; def.descripcion = def.descripcion || ''; def.mensaje_final = def.mensaje_final || ''; def.imagen_cabecera = def.imagen_cabecera || '';
  if (!def.slug && def.titulo && !existente) def.slug = slugDe(def.titulo).replace(/_/g, '-').slice(0, 40);
  let sucio = false; let abierto = def.campos.length > 6 ? -1 : (def.campos.length ? 0 : -1); let slugTocado = !!existente || !!def.slug;
  const marcar = () => { sucio = true; vista(); };

  // ----- vista previa -----
  const previa = h('div', { class: 'fp card fe-previa' });
  let tmr = null;
  function vista() {
    clearTimeout(tmr);
    tmr = setTimeout(() => {
      const pag = Number(previa.querySelector('.fp-raiz')?.dataset.pagina || 0); const sc = previa.scrollTop;
      const dv = { ...clonar(def), campos: clonar(def.campos).map(({ correcta, puntos, ...r }) => r) };
      const nota = def.campos.some((c) => c.correcta !== undefined && c.correcta !== '' && !(Array.isArray(c.correcta) && !c.correcta.length));
      previa.replaceChildren(h('div', { class: 'fe-aviso' }, 'Vista previa (no se envía nada)'), crearFormulario(dv, { previa: true, paginaInicial: pag, enviar: async () => ({ mensaje: def.mensaje_final, nota: nota && def.config.mostrar_nota ? { puntos: 7, max: 10 } : null }) }));
      previa.scrollTop = sc;
    }, 220);
  }

  // ----- ajustes generales -----
  const F = {
    titulo: h('input', { type: 'text', value: def.titulo }), slug: h('input', { type: 'text', value: def.slug, disabled: !!existente, placeholder: 'ej. autorizacion-salida' }),
    tipo: sel([['generico', 'Genérico (alumno y notas)'], ['tutoria', 'Tutoría (crea la tutoría)']], def.tipo, { disabled: !!existente }),
    activo: h('input', { type: 'checkbox', checked: def.activo }), plantilla: h('input', { type: 'checkbox', checked: def.plantilla }),
    desc: area(def.descripcion, { rows: 4 }), fin: area(def.mensaje_final, { rows: 2 }),
    color: h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(def.config.color || '') ? def.config.color : '#1d4ed8' }),
    cabModo: sel([['banner', 'Imagen ancha arriba (banner)'], ['logo', 'Logo centrado']], def.config.cabecera || 'banner'),
    boton: h('input', { type: 'text', value: def.config.boton || '', placeholder: 'Enviar' }),
    test: h('input', { type: 'checkbox', checked: !!def.config.test }), nota: h('input', { type: 'checkbox', checked: !!def.config.mostrar_nota }),
  };
  const miniatura = h('div', { class: 'fe-mini' });
  const pintarCabecera = () => { clear(miniatura, def.imagen_cabecera ? h('img', { src: def.imagen_cabecera, alt: '' }) : h('span', { class: 'muted small' }, 'Sin imagen'), h('div', { class: 'fe-fila' },
    h('button', { class: 'btn small', type: 'button', onclick: () => elegirImagen((u) => { def.imagen_cabecera = u; pintarCabecera(); marcar(); }) }, def.imagen_cabecera ? 'Cambiar imagen' : 'Subir imagen / logo'),
    def.imagen_cabecera ? h('button', { class: 'btn small', type: 'button', onclick: () => { def.imagen_cabecera = ''; pintarCabecera(); marcar(); } }, 'Quitar') : null)); };
  pintarCabecera();
  F.titulo.oninput = () => { def.titulo = F.titulo.value; if (!slugTocado) { F.slug.value = slugDe(F.titulo.value).replace(/_/g, '-').slice(0, 40); def.slug = F.slug.value; } marcar(); };
  F.slug.oninput = () => { slugTocado = true; def.slug = F.slug.value.trim().toLowerCase(); marcar(); };
  F.tipo.onchange = () => { def.tipo = F.tipo.value; marcar(); };
  F.activo.onchange = () => { def.activo = F.activo.checked; marcar(); };
  F.plantilla.onchange = () => { def.plantilla = F.plantilla.checked; marcar(); };
  F.desc.oninput = () => { def.descripcion = F.desc.value; marcar(); };
  F.fin.oninput = () => { def.mensaje_final = F.fin.value; marcar(); };
  F.color.oninput = () => { def.config.color = F.color.value; marcar(); };
  F.cabModo.onchange = () => { def.config.cabecera = F.cabModo.value; marcar(); };
  F.boton.oninput = () => { def.config.boton = F.boton.value.trim() || undefined; marcar(); };
  F.test.onchange = () => { def.config.test = F.test.checked; pintarLista(); marcar(); };
  F.nota.onchange = () => { def.config.mostrar_nota = F.nota.checked; marcar(); };
  const quitarColor = h('button', { class: 'btn ghost small', type: 'button', onclick: () => { delete def.config.color; F.color.value = '#1d4ed8'; marcar(); } }, 'Color por defecto');
  const ajustes = h('section', { class: 'fe-card' }, h('h3', {}, 'Ajustes del formulario'),
    h('div', { class: 'form-section' },
      campo('Título', F.titulo, { full: true, req: true }), campo('Dirección web (minúsculas, números y guiones)', F.slug, { req: true }), campo('Tipo de procesado', F.tipo),
      campo('Texto de presentación (admite formato)', h('div', {}, barraFormato(F.desc), F.desc), { full: true }),
      campo('Mensaje al enviar', F.fin, { full: true }),
      campo('Logo o foto de cabecera', h('div', {}, miniatura, F.cabModo), { full: true }),
      campo('Color de acento', h('div', { class: 'fe-fila' }, F.color, quitarColor)), campo('Texto del botón final', F.boton),
      h('label', { class: 'fe-chk full' }, F.activo, ' Activo (las familias pueden rellenarlo)'),
      h('label', { class: 'fe-chk full' }, F.plantilla, ' Es una plantilla: no es público y sirve para crear formularios nuevos'),
      h('label', { class: 'fe-chk full' }, F.test, ' Es un test con corrección automática (aparece «respuesta correcta» en cada pregunta)'),
      h('label', { class: 'fe-chk full' }, F.nota, ' Mostrar la nota a la familia al terminar (si no, solo la ve el personal)')));

  // ----- bloques -----
  const lista = h('div', { class: 'fe-lista' });
  const idUnico = (base) => { const usados = new Set(def.campos.map((c) => c.id)); let id = base || 'campo'; if (!/^[a-z]/.test(id)) id = 'c_' + id; let n = 2; const raiz = id; while (usados.has(id)) id = `${raiz}_${n++}`; return id; };
  function nuevoBloque(t) {
    const c = { id: idUnico(t === 'seccion' ? 'pagina' : t), tipo: t, etiqueta: '', _auto: true };
    if (ES_DATO(t)) c.requerido = false;
    if (CON_OPCIONES.includes(t)) c.opciones = ['Opción 1', 'Opción 2'];
    if (t === 'rejilla') { c.filas = ['Fila 1']; c.columnas = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']; }
    if (t === 'escala') { c.min = 1; c.max = 5; }
    return c;
  }
  const insertarEn = (i, c) => { def.campos.splice(i, 0, c); abierto = i; pintarLista(); marcar(); setTimeout(() => lista.children[i]?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30); };
  const mover = (i, d) => { const j = i + d; if (j < 0 || j >= def.campos.length) return; [def.campos[i], def.campos[j]] = [def.campos[j], def.campos[i]]; if (abierto === i) abierto = j; else if (abierto === j) abierto = i; pintarLista(); marcar(); };
  const quitar = async (i) => {
    const c = def.campos[i];
    const refs = def.campos.filter((x) => x.si?.campo === c.id).length;
    if (!(await confirmar({ titulo: 'Quitar bloque', texto: `«${c.etiqueta || NOMBRE[c.tipo]}» se quitará del formulario (las respuestas ya recibidas se conservan).${refs ? ` ${refs} bloque(s) dependían de él y dejarán de mostrarse con condición.` : ''}`, ok: 'Quitar', peligro: true }))) return;
    def.campos.forEach((x) => { if (x.si?.campo === c.id) delete x.si; });
    def.campos.splice(i, 1); abierto = -1; pintarLista(); marcar();
  };
  const duplicar = (i) => { const c = clonar(def.campos[i]); c.id = idUnico(c.id); c._auto = false; insertarEn(i + 1, c); };

  function resumen(c) {
    if (c.tipo === 'imagen') return c.etiqueta || (c.url ? c.url.split('/').pop() : 'Imagen sin elegir');
    if (c.tipo === 'info') return c.etiqueta || (c.ayuda || '').replace(/\s+/g, ' ').slice(0, 70) || 'Texto sin escribir';
    return c.etiqueta || '(sin título)';
  }
  // condición: «mostrar solo si [pregunta anterior] [es…] [valores]»
  function editorCondicion(c, i) {
    const previas = def.campos.slice(0, i).filter((x) => ES_DATO(x.tipo) && x.etiqueta);
    const caja = h('div', { class: 'fe-cond' });
    const pintar = () => {
      clear(caja);
      const on = !!c.si;
      const chk = h('input', { type: 'checkbox', checked: on, disabled: !previas.length });
      chk.onchange = () => { if (chk.checked) c.si = { campo: previas[previas.length - 1].id, op: 'es', valor: '' }; else delete c.si; pintar(); marcar(); };
      caja.append(h('label', { class: 'fe-chk' }, chk, ` Mostrar solo si… ${previas.length ? '' : '(añade antes alguna pregunta)'}`));
      if (!on) return;
      const q = previas.find((x) => x.id === c.si.campo);
      const sc = sel(previas.map((x) => [x.id, x.etiqueta.slice(0, 60)]), c.si.campo, { onchange: () => { c.si.campo = sc.value; c.si.valor = ''; pintar(); marcar(); } });
      const so = sel(OPS, c.si.op || 'es', { onchange: () => { c.si.op = so.value; pintar(); marcar(); } });
      const conValor = ['es', 'no_es'].includes(c.si.op || 'es');
      let valor = null;
      if (conValor) {
        const opts = q ? (q.opciones || (q.tipo === 'escala' ? Array.from({ length: Math.max(1, (+q.max || 5) - (+q.min || 1) + 1) }, (_, k) => String((+q.min || 1) + k)) : q.tipo === 'acepto' ? ['true'] : null)) : null;
        if (opts) {
          const marcadas = new Set(String(c.si.valor || '').split('|').filter(Boolean));
          valor = h('div', { class: 'fe-opts' }, opts.map((o) => { const k = h('input', { type: 'checkbox', checked: marcadas.has(o) }); k.onchange = () => { k.checked ? marcadas.add(o) : marcadas.delete(o); c.si.valor = [...marcadas].join('|'); marcar(); }; return h('label', { class: 'fe-chk' }, k, ' ' + (o === 'true' ? 'marcada' : o)); }));
        } else { const t = h('input', { type: 'text', value: c.si.valor || '', placeholder: 'valor (varios separados por |)' }); t.oninput = () => { c.si.valor = t.value; marcar(); }; valor = t; }
      }
      caja.append(h('div', { class: 'fe-fila' }, h('span', {}, 'la pregunta'), sc, so), valor);
    };
    pintar(); return caja;
  }

  function cuerpoBloque(c, i, cabeza) {
    const v = (k, cb) => { const inp = h('input', { type: 'text', value: c[k] ?? '' }); inp.oninput = () => { cb ? cb(inp.value) : (c[k] = inp.value); marcar(); }; return inp; };
    const ta = (k, rows = 3) => { const t = area(c[k], { rows }); t.oninput = () => { c[k] = t.value; marcar(); }; return t; };
    const cont = h('div', { class: 'fe-cuerpo' });
    const etiquetaInp = v('etiqueta', (x) => { c.etiqueta = x; if (c._auto) { c.id = idUnico(slugDe(x) || c.tipo); } cabeza.titulo(); marcar(); });
    if (ES_DATO(c.tipo)) {
      const req = h('input', { type: 'checkbox', checked: !!c.requerido }); req.onchange = () => { c.requerido = req.checked; marcar(); };
      const ay = ta('ayuda', 2);
      cont.append(campo('Pregunta', etiquetaInp, { full: true, req: true }), campo('Explicación bajo la pregunta (opcional, admite formato)', h('div', {}, barraFormato(ay), ay), { full: true }), h('label', { class: 'fe-chk full' }, req, ' Obligatoria'));
    }
    if (c.tipo === 'info') { const t = ta('ayuda', 8); cont.append(campo('Título (opcional)', etiquetaInp, { full: true }), campo('Texto (admite formato, enlaces e imágenes)', h('div', {}, barraFormato(t), t), { full: true })); }
    if (c.tipo === 'seccion') { const t = ta('ayuda', 4); cont.append(campo('Título de la página', etiquetaInp, { full: true }), campo('Texto de la página (opcional)', h('div', {}, barraFormato(t), t), { full: true }), h('div', { class: 'small muted' }, 'Una página nueva empieza aquí: la familia verá «Siguiente». Con «Mostrar solo si…» puedes hacer páginas distintas según lo que elijan.')); }
    if (c.tipo === 'imagen') {
      const u = v('url'); const mini = h('div', { class: 'fe-mini' });
      const pm = () => { clear(mini, c.url ? h('img', { src: c.url, alt: '' }) : h('span', { class: 'muted small' }, 'Sin imagen')); };
      u.addEventListener('input', pm); pm();
      cont.append(campo('Imagen', h('div', {}, mini, h('div', { class: 'fe-fila' }, h('button', { class: 'btn small', type: 'button', onclick: () => elegirImagen((url) => { c.url = url; u.value = url; pm(); marcar(); }) }, 'Subir imagen'), u)), { full: true }), campo('Descripción de la imagen', etiquetaInp, { full: true }));
    }
    if (CON_OPCIONES.includes(c.tipo)) {
      const t = area((c.opciones || []).join('\n'), { rows: 5 });
      t.oninput = () => { c.opciones = lineas(t.value); pintarCorrecta(); marcar(); };
      cont.append(campo('Opciones (una por línea; puedes pegarlas de Google Forms)', t, { full: true }));
    }
    if (c.tipo === 'rejilla') {
      const f = area((c.filas || []).join('\n'), { rows: 5 }); f.oninput = () => { c.filas = lineas(f.value); marcar(); };
      const k = area((c.columnas || []).join('\n'), { rows: 5 }); k.oninput = () => { c.columnas = lineas(k.value); marcar(); };
      cont.append(campo('Filas (una por línea)', f), campo('Columnas (una por línea)', k));
    }
    if (c.tipo === 'escala') {
      const n = (k, d) => { const i2 = h('input', { type: 'number', value: c[k] ?? d, min: 0, max: 20 }); i2.oninput = () => { c[k] = Number(i2.value); marcar(); }; return i2; };
      cont.append(campo('Desde', n('min', 1)), campo('Hasta (máx. 10 valores)', n('max', 5)), campo('Texto del valor más bajo', v('etiq_min')), campo('Texto del valor más alto', v('etiq_max')));
    }
    // corrección automática
    const corr = h('div', { class: 'fe-corr' });
    function pintarCorrecta() {
      clear(corr);
      if (!def.config.test || !['radio', 'select', 'casillas', 'texto'].includes(c.tipo)) return;
      let ctrl;
      if (c.tipo === 'casillas') {
        const m = new Set(Array.isArray(c.correcta) ? c.correcta : []);
        ctrl = h('div', { class: 'fe-opts' }, (c.opciones || []).map((o) => { const k = h('input', { type: 'checkbox', checked: m.has(o) }); k.onchange = () => { k.checked ? m.add(o) : m.delete(o); c.correcta = [...m]; if (!c.correcta.length) delete c.correcta; marcar(); }; return h('label', { class: 'fe-chk' }, k, ' ' + o); }));
      } else if (c.tipo === 'texto') {
        const t = h('input', { type: 'text', value: c.correcta || '', placeholder: 'respuestas válidas separadas por |' }); t.oninput = () => { if (t.value.trim()) c.correcta = t.value; else delete c.correcta; marcar(); }; ctrl = t;
      } else {
        const s = sel(c.opciones || [], c.correcta || '', { vacio: '— sin corrección —' }); s.onchange = () => { if (s.value) c.correcta = s.value; else delete c.correcta; marcar(); }; ctrl = s;
      }
      const pts = h('input', { type: 'number', min: 0, step: '0.5', value: c.puntos ?? 1 }); pts.oninput = () => { c.puntos = Number(pts.value); marcar(); };
      corr.append(h('div', { class: 'fe-sep' }, 'Corrección automática'), campo('Respuesta correcta', ctrl, { full: true }), campo('Puntos', pts));
    }
    cont.append(corr); pintarCorrecta();
    // condición + opciones avanzadas
    cont.append(editorCondicion(c, i));
    const idInp = h('input', { type: 'text', value: c.id }); idInp.onchange = () => {
      const nuevo = idInp.value.trim();
      if (!/^[a-z][a-z0-9_]*$/.test(nuevo) || def.campos.some((x) => x !== c && x.id === nuevo)) { toast('Identificador no válido o repetido (minúsculas, números y _).', 'error'); idInp.value = c.id; return; }
      def.campos.forEach((x) => { if (x.si?.campo === c.id) x.si.campo = nuevo; }); c.id = nuevo; c._auto = false; marcar();
    };
    const adv = [campo('Identificador interno (no lo ve la familia; las respuestas se guardan con él)', idInp, { full: true })];
    if (ES_DATO(c.tipo)) { const g = area((c.google || []).join('\n'), { rows: 2 }); g.oninput = () => { c.google = lineas(g.value); if (!c.google.length) delete c.google; marcar(); }; adv.push(campo('Para importar de Google: trozos del encabezado de la columna en el Excel (uno por línea)', g, { full: true })); }
    cont.append(h('details', { class: 'fe-adv' }, h('summary', {}, 'Opciones avanzadas'), h('div', { class: 'form-section' }, adv)));
    return cont;
  }

  let arrastrando = -1;
  function pintarLista() {
    clear(lista);
    def.campos.forEach((c, i) => {
      const titulo = h('span', { class: 'fe-t' }, resumen(c));
      const cabeza = { titulo: () => { titulo.textContent = resumen(c); } };
      const bnt = (t, fn, ttl, dis) => h('button', { class: 'btn ghost small', type: 'button', title: ttl, disabled: dis, onclick: (e) => { e.stopPropagation(); fn(); } }, t);
      const head = h('div', { class: 'fe-head', draggable: 'true', onclick: () => { abierto = abierto === i ? -1 : i; pintarLista(); } },
        h('span', { class: 'fe-asa', title: 'Arrastra para ordenar' }, '⠿'), h('span', { class: 'fe-ic' }, ICONO[c.tipo] || '?'),
        h('span', { class: 'fe-tipo' }, NOMBRE[c.tipo] || c.tipo), titulo,
        c.si ? h('span', { class: 'fe-badge' }, 'condicional') : null, c.requerido ? h('span', { class: 'fe-badge req' }, 'obligatoria') : null, (def.config.test && c.correcta !== undefined) ? h('span', { class: 'fe-badge ok' }, 'corrige') : null,
        h('span', { class: 'fe-acc' }, bnt('↑', () => mover(i, -1), 'Subir', i === 0), bnt('↓', () => mover(i, 1), 'Bajar', i === def.campos.length - 1), bnt('⧉', () => duplicar(i), 'Duplicar'), bnt('✕', () => quitar(i), 'Quitar')));
      const tarjeta = h('div', { class: `fe-bloque t-${c.tipo}${abierto === i ? ' abierto' : ''}${c.tipo === 'seccion' ? ' es-seccion' : ''}`, 'data-i': String(i) }, head, abierto === i ? cuerpoBloque(c, i, cabeza) : null);
      head.addEventListener('dragstart', (e) => { arrastrando = i; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* */ } });
      tarjeta.addEventListener('dragover', (e) => { if (arrastrando >= 0) { e.preventDefault(); tarjeta.classList.add('sobre'); } });
      tarjeta.addEventListener('dragleave', () => tarjeta.classList.remove('sobre'));
      tarjeta.addEventListener('drop', (e) => { e.preventDefault(); if (arrastrando < 0 || arrastrando === i) { arrastrando = -1; return; } const [m] = def.campos.splice(arrastrando, 1); def.campos.splice(i, 0, m); abierto = i; arrastrando = -1; pintarLista(); marcar(); });
      tarjeta.addEventListener('dragend', () => { arrastrando = -1; });
      lista.append(tarjeta);
    });
    if (!def.campos.length) lista.append(h('p', { class: 'muted', style: 'padding:8px' }, 'Aún no hay bloques. Añade el primero con los botones de abajo.'));
  }
  const paleta = h('div', { class: 'fe-paleta' }, ['Preguntas', 'Contenido'].map((g) => h('div', {}, h('div', { class: 'fe-sep' }, g === 'Preguntas' ? 'Añadir una pregunta' : 'Añadir contenido o una página nueva'),
    h('div', { class: 'fe-botones' }, BLOQUES.filter((b) => b.g === g).map((b) => h('button', { class: 'btn small', type: 'button', onclick: () => insertarEn(abierto >= 0 ? abierto + 1 : def.campos.length, nuevoBloque(b.t)) }, h('span', { class: 'fe-ic' }, b.ic), ' ' + b.n))))));
  const seccionBloques = h('section', { class: 'fe-card' }, h('h3', {}, 'Contenido del formulario'), h('div', { class: 'small muted' }, 'Pulsa un bloque para editarlo. Arrastra ⠿ o usa las flechas para ordenar. Los bloques nuevos se añaden debajo del que tengas abierto.'), lista, paleta);

  // ----- validar y guardar -----
  function validar() {
    if (!def.titulo.trim()) return 'Pon un título al formulario.';
    if (!/^[a-z0-9-]{2,40}$/.test(def.slug)) return 'La dirección web debe tener 2–40 caracteres: minúsculas, números y guiones.';
    if (!def.campos.some((c) => ES_DATO(c.tipo))) return 'Añade al menos una pregunta.';
    const ids = new Set();
    for (const [i, c] of def.campos.entries()) {
      const n = `Bloque ${i + 1} (${NOMBRE[c.tipo] || c.tipo})`;
      if (!/^[a-z][a-z0-9_]*$/.test(c.id) || ids.has(c.id)) return `${n}: identificador repetido o no válido (en «Opciones avanzadas»).`;
      ids.add(c.id);
      if (ES_DATO(c.tipo) && !c.etiqueta.trim()) return `${n}: falta el texto de la pregunta.`;
      if (c.tipo === 'info' && !c.etiqueta.trim() && !(c.ayuda || '').trim()) return `${n}: escribe el texto.`;
      if (c.tipo === 'imagen' && !/^https:\/\//.test(c.url || '')) return `${n}: sube una imagen o pega su dirección (https://…).`;
      if (CON_OPCIONES.includes(c.tipo) && !(c.opciones || []).length) return `«${c.etiqueta}»: faltan opciones.`;
      if (c.tipo === 'rejilla' && (!(c.filas || []).length || !(c.columnas || []).length)) return `«${c.etiqueta}»: faltan filas o columnas.`;
      if (c.si) {
        const j = def.campos.findIndex((x) => x.id === c.si.campo);
        if (j < 0 || j >= i) return `${n}: la condición debe depender de una pregunta anterior.`;
        if (['es', 'no_es', undefined].includes(c.si.op) && !String(c.si.valor || '').trim()) return `${n}: elige con qué valor se muestra (condición).`;
      }
      if (c.correcta !== undefined && CON_OPCIONES.includes(c.tipo)) { const cs = Array.isArray(c.correcta) ? c.correcta : [c.correcta]; if (cs.some((x) => !(c.opciones || []).includes(x))) return `«${c.etiqueta}»: la respuesta correcta ya no está entre las opciones.`; }
    }
    return '';
  }
  const limpiar = (c) => {
    const o = { etiqueta: '' };
    for (const [k, v] of Object.entries(c)) { if (k.startsWith('_') || v === '' || v === undefined || v === null || (Array.isArray(v) && !v.length)) continue; if (!def.config.test && (k === 'correcta' || k === 'puntos')) continue; o[k] = v; }
    if (!ES_DATO(c.tipo)) delete o.requerido;
    return o;
  };
  const guardar = guardarBoton('Guardar formulario', async () => {
    const err = validar(); if (err) { toast(err, 'error'); return; }
    const config = {}; for (const [k, v] of Object.entries(def.config)) if (v !== undefined && v !== '' && v !== false) config[k] = v;
    const fila = { titulo: def.titulo.trim(), descripcion: def.descripcion.trim() || null, mensaje_final: def.mensaje_final.trim() || null, activo: def.activo, plantilla: def.plantilla, imagen_cabecera: def.imagen_cabecera || null, config, campos: def.campos.map(limpiar) };
    try {
      if (existente) await api.upd('ac_formularios', existente.id, fila);
      else { const nuevo = await api.ins('ac_formularios', { ...fila, slug: def.slug, tipo: def.tipo }); sessionStorage.setItem('ac_form_sel', nuevo.id); }
      sucio = false; toast('Formulario guardado'); volver(true);
    } catch (ex) { toast('No se ha guardado: ' + (/duplicate|unique/i.test(ex.message) ? 'ya existe un formulario con esa dirección web.' : ex.message), 'error'); }
  });
  const salir = async () => { if (sucio && !(await confirmar({ titulo: 'Salir sin guardar', texto: 'Hay cambios sin guardar. Si sales se perderán.', ok: 'Salir sin guardar', peligro: true }))) return; volver(false); };
  const borrar = existente ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Borrar formulario', texto: 'Se borrarán también TODAS sus respuestas. Si solo quieres que deje de funcionar, desmarca «Activo».', ok: 'Borrar todo', peligro: true })) { try { await api.del('ac_formularios', existente.id); sucio = false; volver(true); } catch (ex) { toast(ex.message, 'error'); } } } }, 'Borrar') : null;

  pintarLista();
  clear(view,
    h('div', { class: 'fe-top' }, h('h2', {}, existente ? `Editar · ${existente.titulo}` : 'Nuevo formulario'), h('div', { class: 'fe-fila' }, h('button', { class: 'btn', type: 'button', onclick: salir }, '← Volver'), borrar, guardar)),
    h('div', { class: 'fe' }, h('div', { class: 'fe-izq' }, ajustes, seccionBloques), h('div', { class: 'fe-der' }, previa)));
  vista();
}
