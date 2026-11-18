// Lee una foto o PDF de una ficha de inscripción y devuelve los datos del alumno para revisarlos en pantalla.
// No guarda nada: la app abre la ficha de «Nuevo alumno» rellena y la persona la revisa antes de crearla.
// Necesita el secreto ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets). Solo usuarios con permiso de editar Alumnos.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const ORIGENES = ['https://meh-montcada.netlify.app', 'https://prueba--meh-montcada.netlify.app', 'http://127.0.0.1:8765', 'http://localhost:8765'];
const MODELO = 'claude-sonnet-5-5';
const MAX_BASE64 = 7_000_000; // ~5 MB de imagen

function cors(req: Request) {
  const o = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGENES.includes(o) ? o : ORIGENES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

const PROMPT = `Eres un asistente administrativo de una academia de inglés en España. Te paso la foto o el PDF de una ficha de inscripción de un alumno.
Extrae SOLO lo que se lea con claridad y devuelve únicamente un objeto JSON (sin texto antes ni después, sin markdown) con esta forma exacta; usa null cuando un dato no aparezca o no se lea:
{
 "alumno": {"apellidos": str|null, "nombre": str|null, "fecha_nacimiento": "AAAA-MM-DD"|null, "colegio": str|null, "alergias": str|null, "autoriza_rrss": true|false|null, "modalidad": str|null, "nivel": str|null, "metodo_pago": str|null, "como_nos_conocio": str|null, "codigo_postal": str|null, "comentarios": str|null},
 "responsable": {"apellidos": str|null, "nombre": str|null, "email": str|null, "telefono": str|null, "dni": str|null, "iban": str|null},
 "dudas": [str]
}
Reglas: las fechas en formato ISO (en España se escribe día/mes/año). Teléfono solo con dígitos y espacios. IBAN sin espacios. "alergias" incluye alergias e intolerancias alimentarias. "autoriza_rrss" es true solo si hay una autorización marcada de uso de imágenes en redes sociales. Si hay varios hijos en la ficha, devuelve solo el primero y avisa en "dudas". En "dudas" anota cualquier dato ilegible o dudoso (por ejemplo "teléfono ilegible", "fecha de nacimiento dudosa"). No inventes nada.`;

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json' } });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const auth = req.headers.get('Authorization') || '';
    const usuario = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: puede, error: eP } = await usuario.rpc('perm_edita_todo', { p: 'ac_alumnos' });
    if (eP || puede !== true) return json({ error: 'No tienes permiso para crear alumnos' }, 403);

    const clave = Deno.env.get('ANTHROPIC_API_KEY');
    if (!clave) return json({ error: 'sin_clave', detalle: 'Falta configurar la clave ANTHROPIC_API_KEY en la función escanear-ficha.' }, 503);

    const { imagen, tipo } = await req.json();
    const permitidos = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (typeof imagen !== 'string' || !permitidos.includes(tipo)) return json({ error: 'Formato no válido (usa foto JPG/PNG o PDF)' }, 400);
    if (imagen.length > MAX_BASE64) return json({ error: 'El archivo es demasiado grande (máximo ~5 MB)' }, 413);

    const bloque = tipo === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: tipo, data: imagen } }
      : { type: 'image', source: { type: 'base64', media_type: tipo, data: imagen } };
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': clave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODELO, max_tokens: 1500, messages: [{ role: 'user', content: [bloque, { type: 'text', text: PROMPT }] }] }),
    });
    if (!r.ok) return json({ error: 'No se ha podido leer la ficha', detalle: `Servicio de lectura: ${r.status}` }, 502);
    const resp = await r.json();
    const texto = (resp.content || []).map((c: { text?: string }) => c.text || '').join('');
    const m = texto.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: 'No se ha podido interpretar la respuesta' }, 502);
    let datos;
    try { datos = JSON.parse(m[0]); } catch { return json({ error: 'No se ha podido interpretar la respuesta' }, 502); }
    return json({ datos });
  } catch (e) {
    return json({ error: 'Error inesperado: ' + (e instanceof Error ? e.message : String(e)) }, 500);
  }
});
