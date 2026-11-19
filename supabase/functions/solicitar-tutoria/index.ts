// Recibe la solicitud de tutoría que rellenan las familias en /solicitar-tutoria.html (sin iniciar sesión).
// verify_jwt = false: es pública a propósito. Protecciones: validación estricta, tamaños máximos, campo trampa
// y límites de ritmo (por correo y global). Escribe con la service role; la tabla no admite escrituras anónimas.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const ORIGENES = ['https://meh-montcada.netlify.app', 'https://prueba--meh-montcada.netlify.app', 'http://127.0.0.1:8765', 'http://localhost:8765'];
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const HORAS = ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '19:00', '19:30', '20:00'];

function cors(req: Request) {
  const o = req.headers.get('origin') || '';
  return { 'Access-Control-Allow-Origin': ORIGENES.includes(o) ? o : ORIGENES[0], 'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
}
const limpia = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...h, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 20000) return json({ error: 'Solicitud demasiado grande' }, 413);
    const b = JSON.parse(raw);
    if (b.web) return json({ ok: true }); // campo trampa rellenado por un robot: se ignora sin avisar
    const email = limpia(b.email, 200).toLowerCase();
    const alumno = limpia(b.alumno, 200);
    const adulto = limpia(b.adulto, 200);
    const tema = limpia(b.tema, 1500);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Escribe un correo electrónico válido.' }, 400);
    if (alumno.length < 3 || adulto.length < 3 || tema.length < 3) return json({ error: 'Completa el nombre del alumno, el del adulto y el tema a tratar.' }, 400);
    if (typeof b.asiste !== 'boolean') return json({ error: 'Indica si necesitas que asista la profesora.' }, 400);
    const disp: { dia: string; hora: string }[] = [];
    for (const x of Array.isArray(b.disponibilidad) ? b.disponibilidad.slice(0, 80) : []) {
      if (DIAS.includes(x?.dia) && HORAS.includes(x?.hora) && !disp.some((d) => d.dia === x.dia && d.hora === x.hora)) disp.push({ dia: x.dia, hora: x.hora });
    }
    if (!disp.length) return json({ error: 'Marca al menos un día y hora que te vengan bien.' }, 400);

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const hace = (min: number) => new Date(Date.now() - min * 60000).toISOString();
    const [{ count: porCorreo }, { count: global }] = await Promise.all([
      sb.from('ac_tutorias_solicitudes').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', hace(10)),
      sb.from('ac_tutorias_solicitudes').select('id', { count: 'exact', head: true }).gte('created_at', hace(60)),
    ]);
    if ((porCorreo ?? 0) >= 3 || (global ?? 0) >= 100) return json({ error: 'Hemos recibido muchas solicitudes seguidas. Inténtalo de nuevo en unos minutos.' }, 429);

    const { error } = await sb.from('ac_tutorias_solicitudes').insert({ email, alumno_texto: alumno, adulto_texto: adulto, tema, asiste_profesora: b.asiste, disponibilidad: disp, origen: 'web' });
    if (error) return json({ error: 'No se ha podido guardar. Inténtalo de nuevo o escríbenos.' }, 500);
    return json({ ok: true });
  } catch (_e) {
    return json({ error: 'Solicitud no válida.' }, 400);
  }
});
