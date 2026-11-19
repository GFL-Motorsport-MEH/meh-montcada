// Gestión de usuarios desde la app (solo administradores activos).
// Acciones:
//   "crear"    (nombre, rol, email?, password?, centro_id?)  Sin email se crea solo la ficha, sin acceso (para tareas, profesoras…).
//   "password" (user_id, password)               Contraseña provisional nueva.
//   "email"    (user_id, email, password?)       Cambia el email; si el usuario aún no tenía acceso, se lo crea
//                                                (con el mismo id) con la contraseña provisional.
//   "bloquear" (user_id, bloquear)               Bloquea o desbloquea el acceso (profiles.activo + baneo de la cuenta).
//   "borrar"   (user_id)                         Elimina el usuario y su cuenta de acceso.
// La contraseña es provisional: el usuario debe cambiarla al entrar (profiles.debe_cambiar_password).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const ORIGENES = ['https://meh-montcada.netlify.app', 'https://prueba--meh-montcada.netlify.app', 'http://127.0.0.1:8765', 'http://localhost:8765'];

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

    const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    const msgEmail = (m: string) => (/already|registered|exists|duplicate|unique/i.test(m) ? 'Ya existe un usuario con ese email' : m);
    // crea la cuenta de acceso con un id concreto (el del perfil que ya existe) y comprueba que se respetó
    const crearAcceso = async (id: string | null, email: string, password: string, nombre: string) => {
      const attrs: Record<string, unknown> = { email, password, email_confirm: true, user_metadata: { nombre } };
      if (id) attrs.id = id;
      const { data, error } = await admin.auth.admin.createUser(attrs as never);
      if (error) return { error: msgEmail(error.message) };
      if (id && data.user.id !== id) {
        // no se ha respetado el id: se deshace para no dejar una cuenta huérfana
        await admin.auth.admin.deleteUser(data.user.id);
        await admin.from('profiles').delete().eq('id', data.user.id);
        return { error: 'No se ha podido crear el acceso con el mismo usuario. No se ha cambiado nada.' };
      }
      return { user: data.user };
    };
    const existeAcceso = async (id: string) => {
      const { data, error } = await admin.auth.admin.getUserById(id);
      return !error && !!data?.user;
    };

    if (body.accion === 'crear') {
      const email = String(body.email || '').trim().toLowerCase();
      const nombre = String(body.nombre || '').trim() || email.split('@')[0];
      if (!nombre) return json({ error: 'Falta el nombre' }, 400);
      // los roles válidos son los de la tabla «roles» (se gestionan en la web)
      const { data: roles } = await admin.from('roles').select('rol');
      const rol = String(body.rol || '');
      if (!(roles || []).some((r: { rol: string }) => r.rol === rol)) return json({ error: 'Rol no válido' }, 400);
      // centro al que se limita (vacío = todos los centros)
      const centro_id = body.centro_id ? String(body.centro_id) : null;
      if (centro_id) {
        const { data: c } = await admin.from('centros').select('id').eq('id', centro_id).maybeSingle();
        if (!c) return json({ error: 'Centro no válido' }, 400);
      }
      if (!email) {
        // sin email: solo la ficha, sin acceso. Cuando se le ponga el email podrá entrar.
        const { data: p, error: e0 } = await admin.from('profiles')
          .insert({ nombre, rol, activo: true, email: null, debe_cambiar_password: false, centro_id }).select().single();
        if (e0) return json({ error: e0.message }, 500);
        return json({ perfil: p });
      }
      if (!EMAIL_OK.test(email)) return json({ error: 'Email no válido' }, 400);
      if (!pass) return json({ error: 'Falta la contraseña provisional' }, 400);
      const r = await crearAcceso(null, email, pass, nombre);
      if (r.error) return json({ error: r.error }, 400);
      const { data: p, error: e2 } = await admin.from('profiles')
        .update({ nombre, rol, activo: true, email, debe_cambiar_password: true, centro_id }).eq('id', r.user!.id).select().single();
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

    if (body.accion === 'email') {
      const id = String(body.user_id || '');
      const email = String(body.email || '').trim().toLowerCase();
      if (!id) return json({ error: 'Faltan datos' }, 400);
      if (!EMAIL_OK.test(email)) return json({ error: 'Email no válido' }, 400);
      const { data: prof } = await admin.from('profiles').select('id, nombre, email').eq('id', id).maybeSingle();
      if (!prof) return json({ error: 'No existe ese usuario' }, 404);
      const { data: otro } = await admin.from('profiles').select('id').ilike('email', email).neq('id', id).maybeSingle();
      if (otro) return json({ error: 'Ya existe un usuario con ese email' }, 400);
      if (await existeAcceso(id)) {
        const { error } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
        if (error) return json({ error: msgEmail(error.message) }, 400);
        const { data: p, error: e2 } = await admin.from('profiles').update({ email }).eq('id', id).select().single();
        if (e2) return json({ error: e2.message }, 500);
        return json({ perfil: p, acceso_nuevo: false });
      }
      // todavía no tenía acceso: se le crea ahora, con el mismo id, y una contraseña provisional
      if (!pass) return json({ error: 'Falta la contraseña provisional' }, 400);
      const r = await crearAcceso(id, email, pass, prof.nombre);
      if (r.error) return json({ error: r.error }, 400);
      const { data: p, error: e2 } = await admin.from('profiles').update({ email, debe_cambiar_password: true }).eq('id', id).select().single();
      if (e2) return json({ error: e2.message }, 500);
      return json({ perfil: p, acceso_nuevo: true });
    }

    if (body.accion === 'bloquear') {
      const id = String(body.user_id || '');
      if (!id) return json({ error: 'Faltan datos' }, 400);
      if (id === quien.user.id) return json({ error: 'No puedes bloquearte a ti mismo' }, 400);
      const bloquear = body.bloquear !== false;
      if (await existeAcceso(id)) {
        // ~100 años: la cuenta no puede iniciar sesión ni renovar la sesión hasta que se desbloquee
        const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: bloquear ? '876000h' : 'none' });
        if (error) return json({ error: error.message }, 400);
      }
      const { data: p, error: e2 } = await admin.from('profiles').update({ activo: !bloquear }).eq('id', id).select().single();
      if (e2) return json({ error: e2.message }, 500);
      return json({ perfil: p });
    }

    if (body.accion === 'borrar') {
      const id = String(body.user_id || '');
      if (!id) return json({ error: 'Faltan datos' }, 400);
      if (id === quien.user.id) return json({ error: 'No puedes eliminarte a ti mismo' }, 400);
      const { data: prof } = await admin.from('profiles').select('id, nombre, email').eq('id', id).maybeSingle();
      // sus tareas se quedan con su nombre escrito a mano (si no, perderían quién las llevaba)
      if (prof) await admin.from('ac_tareas').update({ responsable: prof.nombre || prof.email }).eq('asignado_a', id).is('responsable', null);
      if (await existeAcceso(id)) {
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) return json({ error: error.message }, 400);
      }
      const { error: e2 } = await admin.from('profiles').delete().eq('id', id);
      if (e2) return json({ error: e2.message }, 500);
      return json({ ok: true });
    }
    return json({ error: 'Acción desconocida' }, 400);
  } catch (ex) {
    return json({ error: String((ex as Error)?.message || ex) }, 500);
  }
});
