// Motor de formularios: pinta la definición (bloques, páginas, condicionales, cabecera) y recoge las respuestas.
// Sin dependencias: lo usan la web pública de formularios y la vista previa del editor de la app.
// ¡ÚNICA FUENTE! La copia app/js/academia/formrender.js la genera scripts/sync_forms.py (no editarla a mano).
//
// Modelo (def.campos = lista de bloques, en orden):
//   datos:   texto, email, telefono, textarea, numero, fecha, radio, select, casillas, rejilla, escala, acepto
//   de texto: info (etiqueta = título opcional, ayuda = texto con formato), imagen (url, etiqueta = descripción)
//   páginas: seccion (empieza una página nueva; etiqueta = título, ayuda = texto)
//   cualquier bloque o sección puede llevar  si: { campo, op: es|no_es|relleno|vacio, valor: 'a|b' }  (se muestra solo si se cumple)
export function el(tag, attrs = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const h of hijos.flat(Infinity)) if (h !== null && h !== undefined && h !== false) e.append(h instanceof Node ? h : document.createTextNode(String(h)));
  return e;
}

export const TIPOS_DATO = ['texto', 'email', 'telefono', 'textarea', 'numero', 'fecha', 'radio', 'select', 'casillas', 'rejilla', 'escala', 'acepto'];
export const TIPOS_TEXTO = ['info', 'imagen', 'seccion'];
export const esDato = (c) => TIPOS_DATO.includes(c.tipo);
const vacio = (v) => (Array.isArray(v) ? !v.length : v === '' || v === false || v == null);

// ---------- condiciones ----------
export function cumple(si, vals) {
  if (!si || !si.campo) return true;
  const v = vals[si.campo];
  const lista = Array.isArray(v) ? v.map(String) : (vacio(v) ? [] : [String(v)]);
  const ref = String(si.valor ?? '').split('|').map((s) => s.trim()).filter(Boolean);
  switch (si.op) {
    case 'no_es': return !ref.some((r) => lista.includes(r));
    case 'relleno': return lista.length > 0;
    case 'vacio': return lista.length === 0;
    default: return ref.some((r) => lista.includes(r));
  }
}

// ---------- texto con formato mínimo: **negrita**, *cursiva*, [texto](https://enlace), # título, - lista, --- línea, ![alt](https://imagen) ----------
const seguro = (u) => /^(https?:\/\/|mailto:|tel:)/i.test(u);
const enlace = (t, u) => (seguro(u) ? el('a', { href: u, target: '_blank', rel: 'noopener noreferrer', text: t }) : t);
function inline(txt) {
  const out = []; const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s)]+)/g;
  let i = 0; let m;
  while ((m = re.exec(txt))) {
    if (m.index > i) out.push(txt.slice(i, m.index));
    let t = m[0];
    if (t.startsWith('**')) out.push(el('strong', { text: t.slice(2, -2) }));
    else if (t[0] === '*') out.push(el('em', { text: t.slice(1, -1) }));
    else if (t[0] === '[') { const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t); out.push(enlace(mm[1], mm[2])); } else {
      const cola = /[.,;:!?]+$/.exec(t)?.[0] || ''; if (cola) t = t.slice(0, -cola.length);
      out.push(enlace(t, t)); if (cola) out.push(cola);
    }
    i = m.index + (m[0].length);
    re.lastIndex = i;
  }
  if (i < txt.length) out.push(txt.slice(i));
  return out;
}
export function md(texto) {
  const frag = document.createDocumentFragment();
  const lineas = String(texto || '').replace(/\r/g, '').split('\n');
  let parrafo = []; let lista = null;
  const cierraP = () => { if (parrafo.length) { const p = el('p'); parrafo.forEach((l, i) => { if (i) p.append(el('br')); p.append(...inline(l)); }); frag.append(p); parrafo = []; } };
  const cierraL = () => { if (lista) { frag.append(lista); lista = null; } };
  for (const crudo of lineas) {
    const l = crudo.trimEnd();
    if (!l.trim()) { cierraP(); cierraL(); continue; }
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { cierraP(); cierraL(); frag.append(el(m[1].length === 1 ? 'h3' : 'h4', {}, inline(m[2]))); continue; }
    if (/^-{3,}$/.test(l.trim())) { cierraP(); cierraL(); frag.append(el('hr')); continue; }
    if ((m = /^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)$/.exec(l.trim()))) { cierraP(); cierraL(); frag.append(el('img', { src: m[2], alt: m[1], class: 'md-img', loading: 'lazy' })); continue; }
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) { cierraP(); if (!lista) lista = el('ul'); lista.append(el('li', {}, inline(m[1]))); continue; }
    cierraL(); parrafo.push(l);
  }
  cierraP(); cierraL();
  return frag;
}

// ---------- un campo ----------
function pintar(c, uid) {
  const id = `${uid}-${c.id}`; const req = c.requerido ? ' *' : '';
  const ayuda = c.ayuda ? el('div', { class: 'nota md' }, md(c.ayuda)) : null;
  switch (c.tipo) {
    case 'info': return { nodo: el('div', { class: 'info md' }, c.etiqueta ? el('h3', { text: c.etiqueta }) : null, md(c.ayuda)) };
    case 'imagen': return seguro(c.url || '') ? { nodo: el('img', { class: 'imagen-bloque', src: c.url, alt: c.etiqueta || '', loading: 'lazy' }) } : { nodo: null };
    case 'textarea': { const t = el('textarea', { id, maxlength: c.max || 3000 }); return { nodo: [el('label', { class: 'c', for: id, text: c.etiqueta + req }), ayuda, t], valor: () => t.value }; }
    case 'select': { const s = el('select', { id }, el('option', { value: '', text: '—' }), (c.opciones || []).map((o) => el('option', { value: o, text: o }))); return { nodo: [el('label', { class: 'c', for: id, text: c.etiqueta + req }), ayuda, s], valor: () => s.value }; }
    case 'radio': { const f = el('fieldset', { id }, el('legend', { text: c.etiqueta + req }), ayuda, (c.opciones || []).map((o) => el('label', { class: 'op' }, el('input', { type: 'radio', name: id, value: o }), o))); return { nodo: f, valor: () => f.querySelector('input:checked')?.value || '' }; }
    case 'casillas': { const f = el('fieldset', { id }, el('legend', { text: c.etiqueta + req }), ayuda, (c.opciones || []).map((o) => el('label', { class: 'op' }, el('input', { type: 'checkbox', name: id, value: o }), o))); return { nodo: f, valor: () => [...f.querySelectorAll('input:checked')].map((i) => i.value) }; }
    case 'escala': {
      const min = Number.isFinite(+c.min) ? +c.min : 1; const max = Number.isFinite(+c.max) && +c.max > min ? Math.min(+c.max, min + 10) : min + 4;
      const nums = []; for (let n = min; n <= max; n++) nums.push(n);
      const f = el('fieldset', { id }, el('legend', { text: c.etiqueta + req }), ayuda,
        el('div', { class: 'escala' }, nums.map((n) => el('label', { class: 'esc' }, el('input', { type: 'radio', name: id, value: String(n) }), el('span', { text: String(n) })))),
        (c.etiq_min || c.etiq_max) ? el('div', { class: 'escala-etq' }, el('span', { text: c.etiq_min || '' }), el('span', { text: c.etiq_max || '' })) : null);
      return { nodo: f, valor: () => { const v = f.querySelector('input:checked')?.value; return v === undefined ? '' : Number(v); } };
    }
    case 'acepto': { const i = el('input', { type: 'checkbox', id }); return { nodo: [ayuda, el('label', { class: 'op' }, i, c.etiqueta + req)], valor: () => i.checked }; }
    case 'rejilla': { const f = el('fieldset', { id }, el('legend', { text: c.etiqueta + req }), ayuda, el('div', { class: 'rejilla' }, el('table', {},
        el('thead', {}, el('tr', {}, el('th'), (c.columnas || []).map((x) => el('th', { text: x })))),
        el('tbody', {}, (c.filas || []).map((fila) => el('tr', {}, el('td', { text: fila }), (c.columnas || []).map((x) => el('td', {}, el('input', { type: 'checkbox', 'data-c': x, 'data-f': fila, 'aria-label': `${x} ${fila}` })))))))));
      return { nodo: f, valor: () => [...f.querySelectorAll('input:checked')].map((i) => ({ c: i.dataset.c, f: i.dataset.f })) }; }
    default: {
      const tipo = { email: 'email', telefono: 'tel', numero: 'number', fecha: 'date' }[c.tipo] || 'text';
      const i = el('input', { id, type: tipo, maxlength: c.max || 300, autocomplete: c.tipo === 'email' ? 'email' : 'off' });
      return { nodo: [el('label', { class: 'c', for: id, text: c.etiqueta + req }), ayuda, i], valor: () => i.value };
    }
  }
}

let contador = 0;
// def: { titulo, descripcion, campos, imagen_cabecera, config:{ color, cabecera:'banner'|'logo', boton } }
// enviar({ datos, web }) debe devolver { mensaje?, nota?:{puntos,max} } o lanzar un Error con el texto para la familia.
export function crearFormulario(def, { enviar, previa = false, paginaInicial = 0 } = {}) {
  const uid = `f${++contador}`;
  const cfg = def.config || {};
  const raiz = el('div', { class: 'fp-raiz' });
  if (/^#[0-9a-f]{6}$/i.test(cfg.color || '')) raiz.style.setProperty('--acento', cfg.color);
  if (def.imagen_cabecera && seguro(def.imagen_cabecera)) raiz.append(el('img', { class: `cabecera ${cfg.cabecera === 'logo' ? 'logo' : 'banner'}`, src: def.imagen_cabecera, alt: '' }));
  raiz.append(el('h1', { text: def.titulo || 'Formulario' }));
  if (def.descripcion) raiz.append(el('div', { class: 'sub md' }, md(def.descripcion)));

  const paginas = []; let pag = null;
  const nueva = (sec) => { pag = { sec, wrap: el('section', { class: 'pagina' }), items: [], visible: true }; paginas.push(pag); };
  for (const c of def.campos || []) {
    if (c.tipo === 'seccion') {
      nueva(c);
      if (c.etiqueta) pag.wrap.append(el('h2', { class: 'sec-titulo', text: c.etiqueta }));
      if (c.ayuda) pag.wrap.append(el('div', { class: 'md' }, md(c.ayuda)));
      continue;
    }
    if (!pag) nueva(null);
    const p = pintar(c, uid); if (!p.nodo) continue;
    const wrap = el('div', { class: `bloque b-${c.tipo}` }, p.nodo); pag.wrap.append(wrap);
    pag.items.push({ c, wrap, valor: p.valor });
  }
  if (!paginas.length) nueva(null);

  const error = el('div', { class: 'error', hidden: true });
  const trampa = el('input', { type: 'text', tabindex: '-1', autocomplete: 'off' });
  const progreso = el('div', { class: 'progreso', hidden: true });
  const atras = el('button', { type: 'button', class: 'sec', text: 'Atrás' });
  const sig = el('button', { type: 'submit', text: 'Siguiente' });
  const form = el('form', { novalidate: true }, progreso, paginas.map((p) => p.wrap), el('div', { class: 'trampa', 'aria-hidden': 'true' }, el('label', {}, 'No rellenar', trampa)), error, el('div', { class: 'nav' }, atras, sig));
  raiz.append(form);

  let actual = paginas[Math.min(Math.max(paginaInicial | 0, 0), paginas.length - 1)];
  const falla = (m) => { error.textContent = m; error.hidden = !m; };
  const valores = () => {
    const vals = {};
    for (const pg of paginas) {
      pg.visible = cumple(pg.sec?.si, vals);
      for (const it of pg.items) { it.visible = pg.visible && cumple(it.c.si, vals); it.wrap.hidden = !it.visible; if (it.valor && it.visible) vals[it.c.id] = it.valor(); }
    }
    return vals;
  };
  const visibles = () => paginas.filter((p) => p.visible);
  function pintarNav() {
    const vs = visibles(); const i = vs.indexOf(actual); const ultima = i === vs.length - 1;
    paginas.forEach((p) => { p.wrap.hidden = p !== actual; }); raiz.dataset.pagina = String(paginas.indexOf(actual));
    atras.hidden = i <= 0; sig.textContent = ultima ? (previa ? 'Enviar (vista previa)' : (cfg.boton || 'Enviar')) : 'Siguiente';
    progreso.hidden = vs.length < 2;
    progreso.replaceChildren(el('span', { text: `Paso ${i + 1} de ${vs.length}` }), el('div', { class: 'barra' }, el('i', { style: null })));
    progreso.querySelector('i').style.width = `${Math.round(((i + 1) / vs.length) * 100)}%`;
  }
  function validarPagina(pg) {
    for (const it of pg.items) {
      it.wrap.classList.remove('mal');
      if (!it.visible || !it.valor) continue;
      const v = it.valor();
      let msg = '';
      if (it.c.requerido && vacio(v)) msg = `Completa: ${it.c.etiqueta}`;
      else if (it.c.tipo === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = 'Escribe un correo electrónico válido.';
      if (msg) { it.wrap.classList.add('mal'); it.wrap.scrollIntoView?.({ block: 'center' }); return msg; }
    }
    return '';
  }
  form.addEventListener('input', () => { valores(); pintarNav(); });
  form.addEventListener('change', () => { valores(); pintarNav(); });
  atras.addEventListener('click', () => { falla(''); const vs = visibles(); const i = vs.indexOf(actual); if (i > 0) { actual = vs[i - 1]; pintarNav(); window.scrollTo?.(0, 0); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); falla(''); valores();
    const m = validarPagina(actual); if (m) return falla(m);
    const vs = visibles(); const i = vs.indexOf(actual);
    if (i < vs.length - 1) { actual = vs[i + 1]; pintarNav(); window.scrollTo?.(0, 0); return; }
    const datos = {};
    for (const pg of vs) for (const it of pg.items) { if (it.visible && it.valor) datos[it.c.id] = it.valor(); }
    sig.disabled = true;
    try {
      const j = await enviar({ datos, web: trampa.value });
      const nota = j?.nota && j.nota.max ? el('p', { class: 'nota-final' }, `Tu nota: ${j.nota.puntos} / ${j.nota.max}`) : null;
      raiz.replaceChildren(el('div', { class: 'ok' }, el('strong', { text: '¡Enviado!' }), el('br'), j?.mensaje || 'Hemos recibido tu respuesta. ¡Gracias!', nota));
      window.scrollTo?.(0, 0);
    } catch (ex) { falla(ex.message || 'No se ha podido enviar. Inténtalo de nuevo.'); } finally { sig.disabled = false; }
  });
  valores(); if (!actual.visible) actual = visibles()[0] || actual; pintarNav();
  return raiz;
}

// ---------- corrección automática (misma regla que la función del servidor; solo la usa el personal para ver aciertos) ----------
const norm = (x) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const tieneCorrecta = (c) => c.correcta !== undefined && c.correcta !== null && c.correcta !== '' && !(Array.isArray(c.correcta) && !c.correcta.length);
export function corrige(c, v) {
  const pts = typeof c.puntos === 'number' && c.puntos >= 0 ? c.puntos : 1;
  if (vacio(v)) return 0;
  if (c.tipo === 'casillas') {
    const ok = (Array.isArray(c.correcta) ? c.correcta : [c.correcta]).filter(Boolean).map(norm).sort(); const a = v.map(norm).sort();
    return ok.length === a.length && ok.every((x, i) => x === a[i]) ? pts : 0;
  }
  return String(Array.isArray(c.correcta) ? c.correcta[0] : c.correcta).split('|').map(norm).includes(norm(v)) ? pts : 0;
}
