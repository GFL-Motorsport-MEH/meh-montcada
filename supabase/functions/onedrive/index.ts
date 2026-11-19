// Puente con OneDrive (cuenta Microsoft personal, Microsoft 365 Familia). La web nunca habla con Microsoft: lo hace esta función,
// que guarda el token de renovación (tabla onedrive_conexion, solo accesible con la clave de servicio) y comprueba permisos.
// Acciones (POST con sesión de la app):
//   estado   -> { conectado, cuenta }
//   iniciar  (solo admin) -> { url } para iniciar sesión en Microsoft una vez y autorizar la conexión
//   subir    (multipart: area, carpeta, file) -> { id, nombre }          area: portal | gastos | academia
//   enlace   (tabla, id) -> { url }  enlace temporal de descarga; la fila se lee con la sesión del usuario (así rige su RLS)
//   quitar   (area, item) -> { ok }
// GET ?code&state: vuelta de Microsoft tras autorizar (sin sesión; el «state» va firmado y caduca a los 10 min).
// Secretos: MS_CLIENT_ID, MS_CLIENT_SECRET. Opcional: ONEDRIVE_CARPETA (por defecto «MEH Web»).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const ORIGENES = ['https://meh-montcada.netlify.app', 'https://prueba--meh-montcada.netlify.app', 'http://127.0.0.1:8765', 'http://localhost:8765'];
const SCOPE = 'Files.ReadWrite offline_access User.Read';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const MAX_BYTES = 25 * 1024 * 1024;
// quién puede subir/quitar en cada área (función de permisos de la base de datos + permiso)
const AREAS: Record<string, [string, string]> = { portal: ['perm_edita_todo', 'ac_portal'], gastos: ['perm_edita', 'fact'], academia: ['perm_edita', 'ac_alumnos'] };
// de qué tabla/columna se lee el identificador del archivo («od:<id>») al pedir un enlace
const TABLAS: Record<string, string> = { ac_portal_docs: 'ruta', gastos: 'link_factura' };

const cors = (req: Request) => {
  const o = req.headers.get('origin') || '';
  return { 'Access-Control-Allow-Origin': ORIGENES.includes(o) ? o : ORIGENES[0], 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' };
};

const URL_ = Deno.env.get('SUPABASE_URL')!;
const REDIRECT = `${URL_}/functions/v1/onedrive`;
const CID = Deno.env.get('MS_CLIENT_ID') || '';
const SECRET = Deno.env.get('MS_CLIENT_SECRET') || '';
const RAIZ = Deno.env.get('ONEDRIVE_CARPETA') || 'MEH Web';
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function firmar(txt: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(txt)));
}
const limpio = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\- ]+/g, '_').replace(/\.{2,}/g, '.').trim().slice(0, 120) || 'archivo';
const ruta = (...p: string[]) => p.map((x) => encodeURIComponent(x)).join('/');

let cache: { t: string; exp: number } | null = null;
async function tokenMs(): Promise<string> {
  if (cache && cache.exp > Date.now() + 60000) return cache.t;
  const { data } = await admin.from('onedrive_conexion').select('refresh_token').eq('id', 1).maybeSingle();
  if (!data?.refresh_token) throw new Error('OneDrive no está conectado todavía.');
  const r = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams({ client_id: CID, client_secret: SECRET, grant_type: 'refresh_token', refresh_token: data.refresh_token, scope: SCOPE }) });
  const j = await r.json();
  if (!r.ok) throw new Error('Microsoft ha rechazado la conexión: ' + (j.error_description || j.error) + '. Hay que volver a conectar OneDrive.');
  if (j.refresh_token) await admin.from('onedrive_conexion').update({ refresh_token: j.refresh_token, updated_at: new Date().toISOString() }).eq('id', 1);
  cache = { t: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 };
  return cache.t;
}
async function graph(path: string, init: RequestInit = {}) {
  const r = await fetch(GRAPH + path, { ...init, headers: { Authorization: 'Bearer ' + await tokenMs(), ...(init.headers || {}) } });
  if (!r.ok && r.status !== 204) throw new Error('OneDrive respondió ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r;
}

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json' } });
  try {
    if (!CID || !SECRET) return json({ error: 'Faltan MS_CLIENT_ID / MS_CLIENT_SECRET en los secretos de la función.' }, 500);
    const u = new URL(req.url);

    // vuelta de Microsoft tras autorizar
    if (req.method === 'GET') {
      const code = u.searchParams.get('code'); const state = u.searchParams.get('state') || '';
      const [cuerpo, firma] = state.split('.');
      const html = (m: string) => new Response(`<meta charset=utf-8><p style="font:16px sans-serif;padding:2rem">${m}</p>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      if (u.searchParams.get('error')) return html('Microsoft ha cancelado la autorización: ' + (u.searchParams.get('error_description') || u.searchParams.get('error')).replace(/[<>&]/g, ''));
      if (!code || !cuerpo || firma !== await firmar(cuerpo)) return html('Enlace no válido.');
      const { volver, ts } = JSON.parse(atob(cuerpo.replace(/-/g, '+').replace(/_/g, '/')));
      if (Date.now() - ts > 600000 || !ORIGENES.includes(volver)) return html('El enlace ha caducado. Vuelve a pulsar «Conectar OneDrive» en la web.');
      const r = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams({ client_id: CID, client_secret: SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT, scope: SCOPE }) });
      const j = await r.json();
      if (!r.ok || !j.refresh_token) return html('No se ha podido conectar: ' + String(j.error_description || j.error || 'sin token de renovación').replace(/[<>&]/g, ''));
      const yo = await (await fetch(GRAPH + '/me', { headers: { Authorization: 'Bearer ' + j.access_token } })).json();
      await admin.from('onedrive_conexion').upsert({ id: 1, refresh_token: j.refresh_token, cuenta: yo.mail || yo.userPrincipalName || yo.displayName || null, updated_at: new Date().toISOString() });
      cache = null;
      return Response.redirect(`${volver}/#/config?onedrive=ok`, 302);
    }

    // el resto exige sesión de la app
    const auth = req.headers.get('Authorization') || '';
    const usuario = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: quien } = await usuario.auth.getUser();
    if (!quien?.user) return json({ error: 'Sin sesión.' }, 401);
    const { data: perfil } = await admin.from('profiles').select('activo, rol').eq('id', quien.user.id).maybeSingle();
    if (!perfil?.activo) return json({ error: 'Usuario sin acceso.' }, 403);
    const puede = async (area: string) => { const a = AREAS[area]; if (!a) return false; const { data } = await usuario.rpc(a[0], { p: a[1] }); return data === true; };

    const ct = req.headers.get('content-type') || '';
    const form = ct.includes('multipart/form-data') ? await req.formData() : null;
    const body = form ? Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')) : await req.json().catch(() => ({}));
    const accion = body.accion;

    if (accion === 'estado') {
      const { data } = await admin.from('onedrive_conexion').select('cuenta, updated_at').eq('id', 1).maybeSingle();
      return json({ conectado: !!data, cuenta: data?.cuenta || null, carpeta: RAIZ });
    }
    if (accion === 'iniciar') {
      if (perfil.rol !== 'admin') return json({ error: 'Solo un administrador puede conectar OneDrive.' }, 403);
      const volver = String(body.volver || '');
      if (!ORIGENES.includes(volver)) return json({ error: 'Origen no permitido.' }, 400);
      const cuerpo = btoa(JSON.stringify({ volver, ts: Date.now() })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const state = cuerpo + '.' + await firmar(cuerpo);
      const q = new URLSearchParams({ client_id: CID, response_type: 'code', redirect_uri: REDIRECT, response_mode: 'query', scope: SCOPE, state, prompt: 'select_account' });
      return json({ url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' + q });
    }
    if (accion === 'subir') {
      const f = form?.get('file');
      if (!(f instanceof File)) return json({ error: 'Falta el archivo.' }, 400);
      if (!await puede(body.area)) return json({ error: 'No tienes permiso para subir aquí.' }, 403);
      if (f.size > MAX_BYTES) return json({ error: 'El archivo pasa de 25 MB.' }, 400);
      const carpeta = String(body.carpeta || '').split('/').map(limpio).filter(Boolean);
      const nombre = Date.now() + '-' + limpio(f.name);
      const r = await graph(`/me/drive/root:/${ruta(RAIZ, body.area, ...carpeta, nombre)}:/content?@microsoft.graph.conflictBehavior=rename`, { method: 'PUT', body: await f.arrayBuffer(), headers: { 'Content-Type': f.type || 'application/octet-stream' } });
      const it = await r.json();
      return json({ id: it.id, nombre: it.name });
    }
    if (accion === 'enlace') {
      const col = TABLAS[body.tabla];
      if (!col || !body.id) return json({ error: 'Petición no válida.' }, 400);
      const { data: fila } = await usuario.from(body.tabla).select(col).eq('id', body.id).maybeSingle(); // RLS: solo si el usuario ve esa fila
      const v = String(fila?.[col] || '');
      if (!v.startsWith('od:')) return json({ error: 'No hay archivo en OneDrive para este registro.' }, 404);
      const it = await (await graph(`/me/drive/items/${encodeURIComponent(v.slice(3))}?select=id,name,webUrl`)).json();
      const dl = await (await graph(`/me/drive/items/${encodeURIComponent(v.slice(3))}?select=@microsoft.graph.downloadUrl`)).json();
      return json({ url: dl['@microsoft.graph.downloadUrl'] || it.webUrl, nombre: it.name });
    }
    if (accion === 'quitar') {
      if (!await puede(body.area)) return json({ error: 'No tienes permiso para quitar archivos aquí.' }, 403);
      const id = String(body.item || '').replace(/^od:/, '');
      if (!/^[\w!\-]+$/.test(id)) return json({ error: 'Identificador no válido.' }, 400);
      await graph(`/me/drive/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return json({ ok: true });
    }
    return json({ error: 'Acción no reconocida.' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
