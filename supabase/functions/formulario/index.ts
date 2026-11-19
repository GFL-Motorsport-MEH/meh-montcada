// Función PÚBLICA de formularios (verify_jwt = false): la web de formularios (sitio aparte) la usa para
//  GET  ?slug=xxx  -> definición del formulario activo (título, texto y campos)
//  POST {slug, datos, web} -> valida las respuestas contra la definición y las guarda.
// Protecciones: validación estricta por tipo de campo, tamaños máximos, campo trampa y límites de ritmo.
// Escribe con la service role; las tablas no admiten escrituras anónimas.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const limpia = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');
type Campo = { id: string; tipo: string; etiqueta: string; requerido?: boolean; opciones?: string[]; filas?: string[]; columnas?: string[]; max?: number };

function validar(campos: Campo[], datos: Record<string, unknown>): { datos?: Record<string, unknown>; error?: string } {
  const out: Record<string, unknown> = {};
  for (const c of campos) {
    const v = datos?.[c.id];
    const falta = `Falta: ${c.etiqueta}`;
    switch (c.tipo) {
      case 'texto': case 'email': case 'telefono': case 'textarea': {
        const s = limpia(v, c.max || (c.tipo === 'textarea' ? 3000 : 300));
        if (!s) { if (c.requerido) return { error: falta }; break; }
        if (c.tipo === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { error: 'Escribe un correo electrónico válido.' };
        if (c.tipo === 'telefono' && !/^[0-9 +()-]{6,20}$/.test(s)) return { error: 'Escribe un teléfono válido.' };
        out[c.id] = c.tipo === 'email' ? s.toLowerCase() : s; break;
      }
      case 'numero': {
        if (v === '' || v == null) { if (c.requerido) return { error: falta }; break; }
        const n = Number(v); if (!isFinite(n)) return { error: `${c.etiqueta}: número no válido` }; out[c.id] = n; break;
      }
      case 'fecha': {
        const s = limpia(v, 10);
        if (!s) { if (c.requerido) return { error: falta }; break; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) return { error: `${c.etiqueta}: fecha no válida` };
        out[c.id] = s; break;
      }
      case 'radio': case 'select': {
        const s = limpia(v, 300);
        if (!s) { if (c.requerido) return { error: falta }; break; }
        if (!(c.opciones || []).includes(s)) return { error: `${c.etiqueta}: opción no válida` };
        out[c.id] = s; break;
      }
      case 'casillas': {
        const a = Array.isArray(v) ? v.map((x) => limpia(x, 300)) : [];
        const ok = [...new Set(a)].filter((x) => (c.opciones || []).includes(x));
        if (ok.length !== new Set(a).size) return { error: `${c.etiqueta}: opción no válida` };
        if (!ok.length) { if (c.requerido) return { error: falta }; break; }
        out[c.id] = ok; break;
      }
      case 'rejilla': {
        const a = Array.isArray(v) ? v.slice(0, 200) : [];
        const ok: { c: string; f: string }[] = [];
        for (const x of a) {
          if ((c.columnas || []).includes(x?.c) && (c.filas || []).includes(x?.f) && !ok.some((y) => y.c === x.c && y.f === x.f)) ok.push({ c: x.c, f: x.f });
        }
        if (!ok.length) { if (c.requerido) return { error: falta }; break; }
        out[c.id] = ok; break;
      }
      case 'acepto': {
        if (v !== true) { if (c.requerido) return { error: `Debes aceptar: ${c.etiqueta}` }; break; }
        out[c.id] = true; break;
      }
      default: break;
    }
  }
  return { datos: out };
}

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    if (req.method === 'GET') {
      const slug = limpia(new URL(req.url).searchParams.get('slug'), 40);
      const { data } = await sb.from('ac_formularios').select('slug,titulo,descripcion,campos').eq('slug', slug).eq('activo', true).maybeSingle();
      return data ? json(data) : json({ error: 'Este formulario no existe o ya no está disponible.' }, 404);
    }
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
    const raw = await req.text();
    if (raw.length > 30000) return json({ error: 'Solicitud demasiado grande' }, 413);
    const b = JSON.parse(raw);
    if (b.web) return json({ ok: true }); // campo trampa: un robot lo ha rellenado; se ignora sin avisar
    const { data: f } = await sb.from('ac_formularios').select('id,campos,mensaje_final').eq('slug', limpia(b.slug, 40)).eq('activo', true).maybeSingle();
    if (!f) return json({ error: 'Este formulario no existe o ya no está disponible.' }, 404);
    const v = validar(f.campos as Campo[], (b.datos || {}) as Record<string, unknown>);
    if (v.error) return json({ error: v.error }, 400);
    const hace = (min: number) => new Date(Date.now() - min * 60000).toISOString();
    const correo = v.datos!['email'];
    const [porCorreo, global] = await Promise.all([
      correo ? sb.from('ac_formulario_respuestas').select('id', { count: 'exact', head: true }).eq('formulario_id', f.id).eq('datos->>email', correo as string).gte('created_at', hace(10)) : Promise.resolve({ count: 0 }),
      sb.from('ac_formulario_respuestas').select('id', { count: 'exact', head: true }).eq('formulario_id', f.id).gte('created_at', hace(60)),
    ]);
    if ((porCorreo.count ?? 0) >= 3 || (global.count ?? 0) >= 150) return json({ error: 'Hemos recibido muchas solicitudes seguidas. Inténtalo de nuevo en unos minutos.' }, 429);
    const { error } = await sb.from('ac_formulario_respuestas').insert({ formulario_id: f.id, datos: v.datos, origen: 'web' });
    if (error) return json({ error: 'No se ha podido guardar. Inténtalo de nuevo o escríbenos.' }, 500);
    return json({ ok: true, mensaje: f.mensaje_final });
  } catch (_e) {
    return json({ error: 'Solicitud no válida.' }, 400);
  }
});
