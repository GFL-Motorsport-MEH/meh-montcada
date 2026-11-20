// Recorre OneDrive (solo metadatos: nombre, tamaño, fecha, carpeta) y lo guarda en onedrive_mapa para diseñar la estructura de carpetas.
// Solo administradores. Se llama una y otra vez desde la web hasta que devuelve { listo: true } (cada llamada trabaja ~90 s).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const ORIGENES = ['https://meh-montcada.netlify.app', 'https://prueba--meh-montcada.netlify.app', 'http://127.0.0.1:8765', 'http://localhost:8765'];
const URL_ = Deno.env.get('SUPABASE_URL')!;
const CID = Deno.env.get('MS_CLIENT_ID') || '';
const SECRET = Deno.env.get('MS_CLIENT_SECRET') || '';
const SCOPE = 'Files.ReadWrite offline_access User.Read';
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = (req: Request) => {
  const o = req.headers.get('origin') || '';
  return { 'Access-Control-Allow-Origin': ORIGENES.includes(o) ? o : ORIGENES[0], 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
};

async function token(): Promise<string> {
  const { data } = await admin.from('onedrive_conexion').select('refresh_token').eq('id', 1).maybeSingle();
  if (!data?.refresh_token) throw new Error('OneDrive no está conectado.');
  const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', { method: 'POST', body: new URLSearchParams({ client_id: CID, client_secret: SECRET, grant_type: 'refresh_token', refresh_token: data.refresh_token, scope: SCOPE }) });
  const j = await r.json();
  if (!r.ok) throw new Error('Microsoft ha rechazado la conexión: ' + (j.error_description || j.error));
  if (j.refresh_token) await admin.from('onedrive_conexion').update({ refresh_token: j.refresh_token, updated_at: new Date().toISOString() }).eq('id', 1);
  return j.access_token;
}

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...h, 'Content-Type': 'application/json' } });
  try {
    const usuario = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false } });
    const { data: quien } = await usuario.auth.getUser();
    if (!quien?.user) return json({ error: 'Sin sesión.' }, 401);
    const { data: perfil } = await admin.from('profiles').select('activo, rol').eq('id', quien.user.id).maybeSingle();
    if (!perfil?.activo || perfil.rol !== 'admin') return json({ error: 'Solo administradores.' }, 403);
    const body = await req.json().catch(() => ({}));

    if (body.reiniciar) {
      await admin.from('onedrive_mapa').delete().neq('id', '');
      await admin.from('onedrive_ajustes').upsert({ id: 1, mapa_next: null, mapa_listo: false, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    }
    const { data: aj } = await admin.from('onedrive_ajustes').select('mapa_next, mapa_listo').eq('id', 1).maybeSingle();
    if (aj?.mapa_listo) { const { count } = await admin.from('onedrive_mapa').select('id', { count: 'exact', head: true }); return json({ listo: true, total: count }); }

    const tk = await token();
    const t0 = Date.now();
    let url = aj?.mapa_next || 'https://graph.microsoft.com/v1.0/me/drive/root/delta?$select=id,name,size,folder,file,parentReference,lastModifiedDateTime,deleted,root&$top=1000';
    let listo = false;
    while (Date.now() - t0 < 90000) {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk } });
      if (!r.ok) throw new Error('OneDrive respondió ' + r.status + ': ' + (await r.text()).slice(0, 200));
      const j = await r.json();
      const filas = (j.value || []).filter((x: any) => !x.deleted).map((x: any) => ({
        id: x.id, parent_id: x.root ? null : x.parentReference?.id || null, nombre: x.name || '(raíz)', carpeta: !!x.folder, tamano: x.size ?? null,
        modificado: x.lastModifiedDateTime || null, mime: x.file?.mimeType || null, hash: x.file?.hashes?.sha1Hash || x.file?.hashes?.quickXorHash || null,
      }));
      for (let i = 0; i < filas.length; i += 500) {
        const { error } = await admin.from('onedrive_mapa').upsert(filas.slice(i, i + 500), { onConflict: 'id' });
        if (error) throw new Error(error.message);
      }
      if (j['@odata.nextLink']) { url = j['@odata.nextLink']; await admin.from('onedrive_ajustes').upsert({ id: 1, mapa_next: url, updated_at: new Date().toISOString() }, { onConflict: 'id' }); }
      else { listo = true; break; }
    }
    if (listo) await admin.from('onedrive_ajustes').upsert({ id: 1, mapa_next: null, mapa_listo: true, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    const { count } = await admin.from('onedrive_mapa').select('id', { count: 'exact', head: true });
    return json({ listo, total: count });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
