import { h, clear, toast, cargando, fmtFecha } from '../ui.js';
import { getPerfiles, actualizarPerfil } from '../db.js';
import { SUPABASE_DASHBOARD } from '../config.js';

export async function renderUsuarios(view, ctx) {
  clear(view, cargando());
  let perfiles = await getPerfiles();
  const yo = ctx.state.perfil.id;

  function fila(p) {
    const esYo = p.id === yo;
    const nombre = h('input', { type: 'text', value: p.nombre || '', 'aria-label': 'Nombre' });
    const rol = h('select', { 'aria-label': 'Rol', disabled: esYo },
      h('option', { value: 'empleado', selected: p.rol === 'empleado' }, 'Empleado'),
      h('option', { value: 'admin', selected: p.rol === 'admin' }, 'Administrador'));
    const activo = h('input', { type: 'checkbox', checked: p.activo, disabled: esYo, 'aria-label': 'Activo' });
    const btn = h('button', { class: 'btn', disabled: true }, 'Guardar');
    const marcar = () => { btn.disabled = false; btn.classList.add('primary'); };
    nombre.addEventListener('input', marcar); rol.addEventListener('change', marcar); activo.addEventListener('change', marcar);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const cambios = { nombre: nombre.value.trim() || p.nombre };
        if (!esYo) { cambios.rol = rol.value; cambios.activo = activo.checked; }
        const nuevo = await actualizarPerfil(p.id, cambios);
        perfiles = perfiles.map((x) => (x.id === p.id ? nuevo : x));
        btn.classList.remove('primary');
        toast('Usuario actualizado');
        if (esYo) ctx.state.perfil = nuevo;
      } catch (ex) { btn.disabled = false; toast(ex.message, 'error'); }
    });
    return h('tr', {},
      h('td', {}, nombre),
      h('td', {}, p.email || '—', esYo ? h('span', { class: 'line2' }, '(tú)') : null),
      h('td', {}, rol),
      h('td', {}, h('label', { class: 'check' }, activo, p.activo ? 'Activo' : h('span', { class: 'pill warn' }, 'Pendiente'))),
      h('td', { class: 'small muted' }, fmtFecha(p.created_at)),
      h('td', {}, btn));
  }

  const pendientes = perfiles.filter((p) => !p.activo).length;
  clear(view,
    h('div', { class: 'section-head' },
      h('div', {}, h('h2', {}, 'Usuarios'), h('div', { class: 'count' }, `${perfiles.length} usuarios · ${pendientes} pendientes de activar`))),
    h('div', { class: 'card users-help' },
      h('strong', {}, 'Cómo dar de alta a alguien'),
      h('ol', {},
        h('li', {}, 'En Supabase, ve a ', h('a', { href: `${SUPABASE_DASHBOARD}/auth/users`, target: '_blank', rel: 'noopener noreferrer' }, 'Authentication → Users'), ', pulsa “Add user” → “Create new user”, pon su email y una contraseña provisional y marca “Auto Confirm User”.'),
        h('li', {}, 'Aparece aquí como “Pendiente”: márcala como activa, elige su rol y pulsa Guardar.'),
        h('li', {}, 'Pásale el email y la contraseña provisional. Al entrar puede cambiarla desde el botón “Contraseña” de arriba.')),
      h('div', { style: 'margin-top:6px' }, 'Por ahora Supabase solo envía emails (invitaciones, recuperar contraseña) a los miembros de tu cuenta de Supabase; para el resto, usa la contraseña provisional.'),
      h('div', { style: 'margin-top:6px' }, 'Los empleados pueden ver, añadir y editar datos. Solo los administradores pueden borrar y gestionar usuarios.')),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, ['Nombre', 'Email', 'Rol', 'Estado', 'Alta', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, perfiles.map(fila)))));
}
