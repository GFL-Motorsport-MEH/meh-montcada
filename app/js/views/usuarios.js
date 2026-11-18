// Panel de usuarios (solo administradores): altas, roles, activar/desactivar y contraseñas provisionales.
// Los permisos de cada rol se aplican en la base de datos (RLS), no solo en la app.
import { h, clear, toast, cargando, fmtFecha, confirmar } from '../ui.js';
import { getPerfiles, actualizarPerfil, adminUsuarios } from '../db.js';

const ROLES = [
  ['admin', 'Administrador', 'Todo, incluidos usuarios y borrar.'],
  ['empleado', 'Gestión', 'Ve y edita toda la contabilidad. No borra ni gestiona usuarios.'],
  ['consulta', 'Consulta', 'Solo ve. No puede cambiar nada.'],
  ['escaner', 'Solo escáner', 'Solo la pantalla del escáner: añade gastos (quedan en amarillo hasta que los revises) y ve los suyos pendientes.'],
];
const PERMISOS = [
  ['Ver gastos, ingresos, balances y facturación', [1, 1, 1, 0]],
  ['Escanear facturas y añadir gastos', [1, 1, 0, 1]],
  ['Editar gastos, ingresos, facturación y control', [1, 1, 0, 0]],
  ['Revisar los gastos del escáner', [1, 1, 0, 0]],
  ['Configuración (empresas, plantillas…)', [1, 1, 0, 0]],
  ['Listas, categorías, centros, cursos y cuentas', [1, 0, 0, 0]],
  ['Borrar datos', [1, 0, 0, 0]],
  ['Gestionar usuarios', [1, 0, 0, 0]],
];

// contraseña provisional legible (sin 0/O, 1/l/I)
function generarPassword(n = 12) {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint32Array(n));
  return [...r].map((x) => a[x % a.length]).join('');
}

function mostrarPassword({ titulo, email, pass }) {
  const txt = `Usuario: ${email}\nContraseña provisional: ${pass}\nEntra en https://meh-montcada.netlify.app y elige tu contraseña.`;
  return confirmar({
    titulo,
    texto: h('div', {}, h('p', {}, 'Pásale estos datos. Al entrar, la app le pedirá que elija su propia contraseña. Esta contraseña no se vuelve a mostrar.'),
      h('div', { class: 'pass-provisional' }, `${email}\n`, h('br'), pass),
      h('button', { class: 'btn small', type: 'button', style: 'margin-top:8px', onclick: async (e) => {
        try { await navigator.clipboard.writeText(txt); e.target.textContent = 'Copiado'; } catch { toast('No se ha podido copiar: selecciónalo a mano', 'error'); }
      } }, 'Copiar los datos')),
    ok: 'Hecho',
  });
}

export async function renderUsuarios(view, ctx) {
  clear(view, cargando());
  let perfiles = await getPerfiles();
  const yo = ctx.state.perfil.id;
  const tbody = h('tbody');
  const contador = h('div', { class: 'count' });

  function fila(p) {
    const esYo = p.id === yo;
    const nombre = h('input', { type: 'text', value: p.nombre || '', 'aria-label': `Nombre de ${p.email}` });
    const rol = h('select', { 'aria-label': `Rol de ${p.email}`, disabled: esYo }, ROLES.map(([v, t]) => h('option', { value: v, selected: p.rol === v }, t)));
    const activo = h('input', { type: 'checkbox', checked: p.activo, disabled: esYo, 'aria-label': `Activo ${p.email}` });
    const sinDinero = h('input', { type: 'checkbox', checked: !!p.sin_dinero, 'aria-label': `Sin acceso a dinero ${p.email}` });
    const btn = h('button', { class: 'btn small', disabled: true }, 'Guardar');
    const marcar = () => { btn.disabled = false; btn.classList.add('primary'); };
    nombre.addEventListener('input', marcar); rol.addEventListener('change', marcar); activo.addEventListener('change', marcar); sinDinero.addEventListener('change', marcar);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const cambios = { nombre: nombre.value.trim() || p.nombre, sin_dinero: sinDinero.checked };
        if (!esYo) { cambios.rol = rol.value; cambios.activo = activo.checked; }
        if (!esYo && cambios.rol === 'admin' && p.rol !== 'admin'
          && !(await confirmar({ titulo: 'Dar permisos de administrador', texto: `${p.email} podrá borrar datos y gestionar usuarios. ¿Seguro?`, ok: 'Sí, hacerle administrador' }))) { btn.disabled = false; return; }
        const nuevo = await actualizarPerfil(p.id, cambios);
        perfiles = perfiles.map((x) => (x.id === p.id ? nuevo : x));
        btn.classList.remove('primary');
        toast('Usuario actualizado');
        if (esYo) ctx.state.perfil = nuevo;
        pintar();
      } catch (ex) { btn.disabled = false; toast(ex.message, 'error'); }
    });
    const btnPass = esYo ? null : h('button', { class: 'btn small ghost', type: 'button', title: 'Pone una contraseña provisional nueva (por si la ha olvidado)', onclick: async () => {
      if (!(await confirmar({ titulo: 'Nueva contraseña provisional', texto: `Se cambiará la contraseña de ${p.email}. Tendrá que elegir otra al entrar.`, ok: 'Cambiar' }))) return;
      const pass = generarPassword();
      try { await adminUsuarios({ accion: 'password', user_id: p.id, password: pass }); p.debe_cambiar_password = true; pintar(); await mostrarPassword({ titulo: 'Contraseña provisional', email: p.email, pass }); }
      catch (ex) { toast(ex.message, 'error'); }
    } }, 'Nueva contraseña');
    return h('tr', { class: p.activo ? '' : 'inactivo' },
      h('td', {}, nombre),
      h('td', {}, p.email || '—', esYo ? h('span', { class: 'line2' }, '(tú)') : null),
      h('td', {}, rol),
      h('td', {}, h('label', { class: 'check' }, activo, p.activo ? 'Activo' : h('span', { class: 'pill warn' }, 'Desactivado')),
        h('label', { class: 'check small', title: 'No ve las tareas de Contabilidad ni de Domiciliaciones y pagos' }, sinDinero, ' Sin dinero')),
      h('td', { class: 'small' }, p.debe_cambiar_password ? h('span', { class: 'pill warn', title: 'Todavía no ha cambiado la contraseña provisional' }, 'Provisional') : h('span', { class: 'muted' }, 'Propia')),
      h('td', { class: 'small muted' }, fmtFecha(p.created_at)),
      h('td', { class: 'acciones-usuario' }, btn, btnPass));
  }
  function pintar() {
    const act = perfiles.filter((p) => p.activo).length;
    contador.textContent = `${perfiles.length} usuarios · ${act} activos`;
    clear(tbody, perfiles.map(fila));
  }

  // ---------- alta ----------
  const aNombre = h('input', { type: 'text', placeholder: 'Nombre', 'aria-label': 'Nombre del usuario nuevo' });
  const aEmail = h('input', { type: 'email', placeholder: 'email@ejemplo.com', 'aria-label': 'Email del usuario nuevo' });
  const aRol = h('select', { 'aria-label': 'Rol del usuario nuevo' }, ROLES.map(([v, t]) => h('option', { value: v, selected: v === 'escaner' }, t)));
  const aBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Crear usuario');
  const alta = h('form', { class: 'alta-usuario', onsubmit: async (e) => {
    e.preventDefault();
    const email = aEmail.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Escribe un email válido', 'error'); aEmail.focus(); return; }
    const pass = generarPassword();
    aBtn.disabled = true;
    try {
      const r = await adminUsuarios({ accion: 'crear', email, nombre: aNombre.value.trim(), rol: aRol.value, password: pass });
      perfiles = [...perfiles, r.perfil];
      pintar();
      aNombre.value = ''; aEmail.value = '';
      await mostrarPassword({ titulo: `Usuario creado: ${ROLES.find((x) => x[0] === r.perfil.rol)?.[1] || r.perfil.rol}`, email, pass });
    } catch (ex) { toast('No se ha creado: ' + ex.message, 'error'); }
    finally { aBtn.disabled = false; }
  } },
  h('label', { class: 'field' }, h('span', {}, 'Nombre'), aNombre), h('label', { class: 'field' }, h('span', {}, 'Email'), aEmail),
  h('label', { class: 'field' }, h('span', {}, 'Rol'), aRol), h('div'), aBtn);

  const matriz = h('table', { class: 'data matriz-permisos' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Permiso'), ROLES.map(([, t]) => h('th', { class: 'center' }, t)))),
    h('tbody', {}, PERMISOS.map(([t, v]) => h('tr', {}, h('td', {}, t), v.map((x) => h('td', { class: x ? 'si' : 'no' }, x ? '✓' : '—'))))));

  clear(view,
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'Usuarios y permisos'), contador)),
    h('div', { class: 'card' }, h('h3', {}, 'Dar de alta'),
      h('p', { class: 'small muted' }, 'Se crea con una contraseña provisional que verás una sola vez para pasársela. Al entrar, la app le obliga a elegir la suya.'),
      alta),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data tabla-usuarios' },
      h('thead', {}, h('tr', {}, ['Nombre', 'Email', 'Rol', 'Estado', 'Contraseña', 'Alta', ''].map((t) => h('th', { scope: 'col' }, t)))), tbody)),
    h('div', { class: 'card' }, h('h3', {}, 'Qué puede hacer cada rol'),
      h('p', { class: 'small muted' }, 'Se aplica en la base de datos: aunque alguien intentara saltarse la app, no podría ver ni cambiar lo que su rol no permite. Desactivar a alguien le quita el acceso al momento.'),
      h('div', { class: 'table-wrap' }, matriz),
      h('ul', { class: 'small muted' }, ROLES.map(([, t, d]) => h('li', {}, h('strong', {}, t), ': ', d)))));
  pintar();
}
