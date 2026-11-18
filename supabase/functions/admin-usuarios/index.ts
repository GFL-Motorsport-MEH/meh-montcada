// Gestión de usuarios desde la app (solo administradores activos).
// Acciones: "crear" (email, nombre, rol, password) y "password" (user_id, password).
// La contraseña es provisional: el usuario debe cambiarla al entrar (profiles.debe_cambiar_password).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const ORIGENES = ['https://meh-montcada.netlify.app', 'http://127.0.0.1:8765', 'http://localhost:8765'];

function cors(req: Request) {
  const o = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGENES.includes(o) ? o : ORIGENES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json' } });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: quien, error: eQuien } = await admin.auth.getUser(token);
    if (eQuien || !quien?.user) return json({ error: 'Sesión no válida' }, 401);
    const { data: perfil } = await admin.from('profiles').select('rol, activo').eq('id', quien.user.id).maybeSingle();
    if (!perfil || !perfil.activo || perfil.rol !== 'admin') return json({ error: 'Solo un administrador puede gestionar usuarios' }, 403);

    const body = await req.json();
    const pass = String(body.password || '');
    if (pass && pass.length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);

    if (body.accion === 'crear') {
      const email = String(body.email || '').trim().toLowerCase();
      const nombre = String(body.nombre || '').trim() || email.split('@')[0];
      // los roles válidos son los de la tabla «roles» (se gestionan en la web)
      const { data: roles } = await admin.from('roles').select('rol');
      const rol = String(body.rol || '');
      if (!(roles || []).some((r: { rol: string }) => r.rol === rol)) return json({ error: 'Rol no válido' }, 400);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Email no válido' }, 400);
      if (!pass) return json({ error: 'Falta la contraseña provisional' }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email, password: pass, email_confirm: true, user_metadata: { nombre } });
      if (error) return json({ error: /already|registered|exists/i.test(error.message) ? 'Ya existe un usuario con ese email' : error.message }, 400);
      const { data: p, error: e2 } = await admin.from('profiles')
        .update({ nombre, rol, activo: true, email, debe_cambiar_password: true }).eq('id', data.user.id).select().single();
      if (e2) return json({ error: e2.message }, 500);
      return json({ perfil: p });
    }

    if (body.accion === 'password') {
      const id = String(body.user_id || '');
      if (!id || !pass) return json({ error: 'Faltan datos' }, 400);
      if (id === quien.user.id) return json({ error: 'Cambia tu propia contraseña desde el botón «Contraseña»' }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { password: pass });
      if (error) return json({ error: error.message }, 400);
      await admin.from('profiles').update({ debe_cambiar_password: true }).eq('id', id);
      return json({ ok: true });
    }
    return json({ error: 'Acción desconocida' }, 400);
  } catch (ex) {
    return json({ error: String((ex as Error)?.message || ex) }, 500);
  }
});
