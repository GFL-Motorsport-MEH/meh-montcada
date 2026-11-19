// Web pública de formularios (sitio aparte, sin nada de la app de gestión).
// La dirección es /<slug>: pide la definición a la función «formulario» y la pinta con el motor de render.js.
import { el, crearFormulario } from '/render.js';
const SUPABASE_URL = 'https://dpnacxuavulpyyaobuev.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwbmFjeHVhdnVscHl5YW9idWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4MTkwMzQsImV4cCI6MjEwOTM5NTAzNH0.Hg2iwEi2l5iVX7dbGobDMk8WAy_jkNpFKC-a5JksLtA';
const FN = `${SUPABASE_URL}/functions/v1/formulario`;
const cab = { apikey: SUPABASE_ANON_KEY };
const tarjeta = document.getElementById('tarjeta');
const slug = (new URLSearchParams(location.search).get('f') || location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();

async function iniciar() {
  if (!slug) { tarjeta.replaceChildren(el('h1', { text: 'My English House' }), el('p', { class: 'sub', text: 'Para rellenar un formulario, usa el enlace que te ha enviado la academia.' })); return; }
  let def;
  try {
    const r = await fetch(`${FN}?slug=${encodeURIComponent(slug)}`, { headers: cab });
    def = await r.json(); if (!r.ok) throw new Error(def.error || 'No disponible');
  } catch (ex) { tarjeta.replaceChildren(el('h1', { text: 'Formulario no disponible' }), el('p', { class: 'sub', text: ex.message })); return; }
  document.title = `${def.titulo} · My English House`;
  const enviar = async ({ datos, web }) => {
    const r = await fetch(FN, { method: 'POST', headers: { ...cab, 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, datos, web }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'No se ha podido enviar. Inténtalo de nuevo.');
    return j;
  };
  tarjeta.replaceChildren(crearFormulario(def, { enviar }));
}
iniciar();
