// Web pública de formularios (sitio aparte, sin nada de la app de gestión).
// La dirección es /<slug>: pide la definición a la función «formulario» y pinta los campos según su tipo.
const SUPABASE_URL = 'https://dpnacxuavulpyyaobuev.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwbmFjeHVhdnVscHl5YW9idWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4MTkwMzQsImV4cCI6MjEwOTM5NTAzNH0.Hg2iwEi2l5iVX7dbGobDMk8WAy_jkNpFKC-a5JksLtA';
const FN = `${SUPABASE_URL}/functions/v1/formulario`;
const cab = { apikey: SUPABASE_ANON_KEY };

function el(tag, attrs = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === null || v === undefined || v === false) continue; if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v); }
  for (const h of hijos.flat(Infinity)) if (h !== null && h !== undefined) e.append(h);
  return e;
}
const tarjeta = document.getElementById('tarjeta');
const slug = (new URLSearchParams(location.search).get('f') || location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();

function pintarCampo(c) {
  const id = 'c-' + c.id; const req = c.requerido ? ' *' : '';
  const ayuda = c.ayuda ? el('p', { class: 'nota', text: c.ayuda }) : null;
  switch (c.tipo) {
    case 'textarea': return { nodo: [el('label', { class: 'c', for: id, text: c.etiqueta + req }), ayuda, el('textarea', { id, maxlength: c.max || 3000 })], valor: () => document.getElementById(id).value };
    case 'select': return { nodo: [el('label', { class: 'c', for: id, text: c.etiqueta + req }), ayuda, el('select', { id }, el('option', { value: '', text: '—' }), (c.opciones || []).map((o) => el('option', { value: o, text: o })))], valor: () => document.getElementById(id).value };
    case 'radio': return { nodo: el('fieldset', {}, el('legend', { text: c.etiqueta + req }), ayuda, (c.opciones || []).map((o) => el('label', { class: 'op' }, el('input', { type: 'radio', name: id, value: o }), o))), valor: () => document.querySelector(`input[name="${id}"]:checked`)?.value || '' };
    case 'casillas': return { nodo: el('fieldset', {}, el('legend', { text: c.etiqueta + req }), ayuda, (c.opciones || []).map((o) => el('label', { class: 'op' }, el('input', { type: 'checkbox', name: id, value: o }), o))), valor: () => [...document.querySelectorAll(`input[name="${id}"]:checked`)].map((i) => i.value) };
    case 'acepto': return { nodo: [ayuda, el('label', { class: 'op' }, el('input', { type: 'checkbox', id }), c.etiqueta + req)], valor: () => document.getElementById(id).checked };
    case 'rejilla': return {
      nodo: el('fieldset', {}, el('legend', { text: c.etiqueta + req }), ayuda, el('div', { class: 'rejilla' }, el('table', { id },
        el('thead', {}, el('tr', {}, el('th'), (c.columnas || []).map((x) => el('th', { text: x })))),
        el('tbody', {}, (c.filas || []).map((f) => el('tr', {}, el('td', { text: f }), (c.columnas || []).map((x) => el('td', {}, el('input', { type: 'checkbox', 'data-c': x, 'data-f': f, 'aria-label': `${x} ${f}` }))))))))),
      valor: () => [...document.querySelectorAll(`#${id} input:checked`)].map((i) => ({ c: i.dataset.c, f: i.dataset.f })),
    };
    default: {
      const tipo = { email: 'email', telefono: 'tel', numero: 'number', fecha: 'date' }[c.tipo] || 'text';
      return { nodo: [el('label', { class: 'c', for: id, text: c.etiqueta + req }), ayuda, el('input', { id, type: tipo, maxlength: c.max || 300, autocomplete: c.tipo === 'email' ? 'email' : 'off' })], valor: () => document.getElementById(id).value };
    }
  }
}

async function iniciar() {
  if (!slug) { tarjeta.replaceChildren(el('h1', { text: 'My English House' }), el('p', { class: 'sub', text: 'Para rellenar un formulario, usa el enlace que te ha enviado la academia.' })); return; }
  let def;
  try {
    const r = await fetch(`${FN}?slug=${encodeURIComponent(slug)}`, { headers: cab });
    def = await r.json(); if (!r.ok) throw new Error(def.error || 'No disponible');
  } catch (ex) { tarjeta.replaceChildren(el('h1', { text: 'Formulario no disponible' }), el('p', { class: 'sub', text: ex.message })); return; }
  document.title = `${def.titulo} · My English House`;
  const campos = def.campos.map((c) => ({ c, ...pintarCampo(c) }));
  const error = el('div', { class: 'error', hidden: true });
  const boton = el('button', { type: 'submit', text: 'Enviar' });
  const trampa = el('input', { type: 'text', tabindex: '-1', autocomplete: 'off' });
  const form = el('form', { novalidate: true }, campos.map((x) => x.nodo), el('div', { class: 'trampa', 'aria-hidden': 'true' }, el('label', {}, 'No rellenar', trampa)), error, boton);
  tarjeta.replaceChildren(el('h1', { text: def.titulo }), def.descripcion ? el('p', { class: 'sub', text: def.descripcion }) : null, form);
  const falla = (m) => { error.textContent = m; error.hidden = !m; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); falla('');
    const datos = {};
    for (const x of campos) {
      const v = x.valor(); datos[x.c.id] = v;
      const vacio = Array.isArray(v) ? !v.length : v === '' || v === false || v == null;
      if (x.c.requerido && vacio) return falla(`Completa: ${x.c.etiqueta}`);
    }
    boton.disabled = true;
    try {
      const r = await fetch(FN, { method: 'POST', headers: { ...cab, 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, datos, web: trampa.value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se ha podido enviar. Inténtalo de nuevo.');
      tarjeta.replaceChildren(el('div', { class: 'ok' }, el('strong', { text: '¡Enviado!' }), el('br'), j.mensaje || 'Hemos recibido tu respuesta. ¡Gracias!')); window.scrollTo(0, 0);
    } catch (ex) { falla(ex.message); } finally { boton.disabled = false; }
  });
}
iniciar();
