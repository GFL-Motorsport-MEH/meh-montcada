// Panel de usuarios (solo administradores): altas, roles, activar/desactivar y contraseñas provisionales.
// Los permisos de cada rol se aplican en la base de datos (RLS), no solo en la app.
import { h, clear, toast, cargando, fmtFecha, confirmar } from '../ui.js';
import { getPerfiles, actualizarPerfil, adminUsuarios, getRoles } from '../db.js';
import * as ac from '../academia/api.js';
import { renderPermisosRoles } from './permisos-roles.js';

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
  const [perfilesIni, rolesDb, fichas] = await Promise.all([getPerfiles(), getRoles(), ac.profesoras().catch(() => [])]);
  let perfiles = perfilesIni;
  let fichasProf = fichas;
  const ROLES = (rolesDb.length ? rolesDb : [{ rol: 'admin', nombre: 'Administrador' }]).map((r) => [r.rol, r.nombre, r.descripcion || '']);
  const nombreDe = (v) => ROLES.find((x) => x[0] === v)?.[1] || v;
  const yo = ctx.state.perfil.id;
  const tbody = h('tbody');
  const contador = h('div', { class: 'count' });

  // Una profesora ve «lo suyo» (grupos, tutorías, alumnos) a través de su ficha en Academia > Profesoras.
  // Cualquier rol puede tener ficha (p. ej. coordinación que además da clase): en su caso no limita lo que ve, solo la identifica como profesora.
  function fichaSelect(p) {
    const actual = fichasProf.find((f) => f.profile_id === p.id);
    const sel = h('select', { 'aria-label': `Ficha de profesora de ${p.email || p.nombre}`, class: 'ficha-prof' },
      h('option', { value: '' }, actual ? '— quitar ficha —' : '— sin ficha de profesora —'),
      fichasProf.filter((f) => !f.profile_id || f.profile_id === p.id).map((f) => h('option', { value: f.id, selected: actual?.id === f.id }, f.nombre)));
    sel.addEventListener('change', async () => {
      try {
        if (actual) await ac.upd('ac_profesoras', actual.id, { profile_id: null });
        if (sel.value) await ac.upd('ac_profesoras', sel.value, { profile_id: p.id });
        fichasProf = await ac.profesoras();
        toast('Ficha actualizada'); pintar();
      } catch (ex) { toast(ex.message, 'error'); }
    });
    const crear = h('button', { class: 'btn small ghost', type: 'button', title: 'Crea una ficha de profesora con su nombre y la vincula', onclick: async () => {
      try {
        await ac.ins('ac_profesoras', { nombre: p.nombre || (p.email || '').split('@')[0], profile_id: p.id });
        fichasProf = await ac.profesoras(); toast('Ficha creada'); pintar();
      } catch (ex) { toast(ex.message, 'error'); }
    } }, 'Crear ficha');
    return h('div', { class: 'ficha-vinculo' }, h('div', { class: 'small muted' }, 'Ficha de profesora'), sel,
      actual ? null : h('div', {}, p.rol === 'profesora' ? h('span', { class: 'pill warn', title: 'Sin ficha no ve sus grupos, tutorías ni alumnos' }, 'Sin ficha: no verá nada suyo') : null, ' ', crear));
  }

  const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const reemplazar = (nuevo) => { perfiles = perfiles.map((x) => (x.id === nuevo.id ? { ...x, ...nuevo } : x)); };

  function fila(p) {
    const esYo = p.id === yo;
    const sinAcceso = !p.email; // sin email no hay cuenta para entrar: solo la ficha (tareas, profesoras…)
    const etq = p.email || p.nombre || 'usuario';
    const nombre = h('input', { type: 'text', value: p.nombre || '', 'aria-label': `Nombre de ${etq}` });
    const siglas = h('input', { type: 'text', value: p.siglas || '', maxlength: 4, placeholder: 'Siglas', class: 'siglas', style: 'width:64px;margin-top:4px', title: 'Abreviatura que se ve en las tareas (GF, MG…)', 'aria-label': `Siglas de ${etq}` });
    const email = h('input', { type: 'email', value: p.email || '', placeholder: 'Sin email · sin acceso', 'aria-label': `Email de ${etq}`, title: sinAcceso ? 'Cuando le pongas un email y guardes, podrá entrar (se le da una contraseña provisional)' : 'Cambia el email con el que entra' });
    const rol = h('select', { 'aria-label': `Rol de ${etq}`, disabled: esYo }, ROLES.map(([v, t]) => h('option', { value: v, selected: p.rol === v }, t)));
    const ficha = fichaSelect(p);
    const btn = h('button', { class: 'btn small', disabled: true }, 'Guardar');
    const marcar = () => { btn.disabled = false; btn.classList.add('primary'); };
    nombre.addEventListener('input', marcar); siglas.addEventListener('input', marcar); rol.addEventListener('change', marcar); email.addEventListener('input', marcar);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const cambios = { nombre: nombre.value.trim() || p.nombre, siglas: siglas.value.trim().toUpperCase() || null };
        if (!esYo) cambios.rol = rol.value;
        const nuevoEmail = email.value.trim().toLowerCase();
        const cambiaEmail = nuevoEmail !== (p.email || '');
        if (cambiaEmail) {
          if (!nuevoEmail) { toast('El email no se puede quitar: si no quieres que entre, bloquea su acceso', 'error'); email.value = p.email || ''; btn.disabled = false; return; }
          if (!EMAIL_OK.test(nuevoEmail)) { toast('Escribe un email válido', 'error'); email.focus(); btn.disabled = false; return; }
        }
        if (!esYo && cambios.rol === 'admin' && p.rol !== 'admin'
          && !(await confirmar({ titulo: 'Dar permisos de administrador', texto: `${etq} podrá borrar datos y gestionar usuarios. ¿Seguro?`, ok: 'Sí, hacerle administrador' }))) { btn.disabled = false; return; }
        if (cambiaEmail && !sinAcceso
          && !(await confirmar({ titulo: 'Cambiar el email', texto: `${p.email} pasará a ser ${nuevoEmail}. ${esYo ? 'Con este nuevo email entrarás tú a partir de ahora.' : 'Con el nuevo email entrará esta persona a partir de ahora.'}`, ok: 'Cambiar email' }))) { btn.disabled = false; return; }
        let nuevo = await actualizarPerfil(p.id, cambios);
        reemplazar(nuevo);
        let pass = null;
        if (cambiaEmail) {
          pass = sinAcceso ? generarPassword() : null;
          const r = await adminUsuarios({ accion: 'email', user_id: p.id, email: nuevoEmail, ...(pass ? { password: pass } : {}) });
          nuevo = r.perfil; reemplazar(nuevo);
        }
        btn.classList.remove('primary');
        toast(cambiaEmail ? (pass ? 'Acceso creado' : 'Email cambiado') : 'Usuario actualizado');
        if (esYo) ctx.state.perfil = { ...ctx.state.perfil, ...nuevo };
        pintar();
        if (pass) await mostrarPassword({ titulo: 'Acceso creado', email: nuevoEmail, pass });
      } catch (ex) { btn.disabled = false; toast(ex.message, 'error'); pintar(); }
    });
    const btnPass = esYo || sinAcceso ? null : h('button', { class: 'btn small ghost', type: 'button', title: 'Pone una contraseña provisional nueva (por si la ha olvidado)', onclick: async () => {
      if (!(await confirmar({ titulo: 'Nueva contraseña provisional', texto: `Se cambiará la contraseña de ${p.email}. Tendrá que elegir otra al entrar.`, ok: 'Cambiar' }))) return;
      const pass = generarPassword();
      try { await adminUsuarios({ accion: 'password', user_id: p.id, password: pass }); p.debe_cambiar_password = true; pintar(); await mostrarPassword({ titulo: 'Contraseña provisional', email: p.email, pass }); }
      catch (ex) { toast(ex.message, 'error'); }
    } }, 'Nueva contraseña');
    const btnBloq = esYo ? null : h('button', { class: 'btn small ghost', type: 'button',
      title: p.activo ? 'No podrá entrar ni se le podrán asignar tareas. Sus datos se conservan y puedes desbloquearlo cuando quieras.' : 'Vuelve a darle acceso',
      onclick: async () => {
        if (p.activo && !(await confirmar({ titulo: 'Bloquear el acceso', texto: `${etq} no podrá entrar ni aparecerá para asignarle tareas. Sus datos se conservan y podrás desbloquearlo cuando quieras.`, ok: 'Bloquear' }))) return;
        try {
          const r = await adminUsuarios({ accion: 'bloquear', user_id: p.id, bloquear: p.activo });
          reemplazar(r.perfil); toast(r.perfil.activo ? 'Acceso desbloqueado' : 'Acceso bloqueado'); pintar();
        } catch (ex) { toast(ex.message, 'error'); }
      } }, p.activo ? 'Bloquear' : 'Desbloquear');
    const btnBorrar = esYo ? null : h('button', { class: 'btn small danger', type: 'button', title: 'Elimina el usuario para siempre', onclick: async () => {
      if (!(await confirmar({ titulo: 'Eliminar usuario', texto: `Se eliminará a ${etq}${sinAcceso ? '' : ' y su acceso'}. Sus tareas se quedarán con su nombre escrito, y lo que haya creado o modificado se conserva sin nombre de autor. No se puede deshacer. Si solo quieres que no entre, mejor «Bloquear».`, ok: 'Eliminar para siempre' }))) return;
      try {
        await adminUsuarios({ accion: 'borrar', user_id: p.id });
        perfiles = perfiles.filter((x) => x.id !== p.id);
        fichasProf = fichasProf.map((f) => (f.profile_id === p.id ? { ...f, profile_id: null } : f));
        toast('Usuario eliminado'); pintar();
      } catch (ex) { toast(ex.message, 'error'); }
    } }, 'Eliminar');
    const estado = !p.activo ? h('span', { class: 'pill warn' }, 'Bloqueado')
      : sinAcceso ? h('span', { class: 'pill', title: 'Existe para tareas y fichas, pero no puede entrar hasta que tenga email' }, 'Sin acceso') : h('span', { class: 'pill ok' }, 'Activo');
    return h('tr', { class: p.activo ? '' : 'inactivo' },
      h('td', {}, nombre, siglas),
      h('td', {}, email, esYo ? h('span', { class: 'line2' }, '(tú)') : null),
      h('td', {}, rol, ficha),
      h('td', {}, estado),
      h('td', { class: 'small' }, sinAcceso ? h('span', { class: 'muted' }, '—') : p.debe_cambiar_password ? h('span', { class: 'pill warn', title: 'Todavía no ha cambiado la contraseña provisional' }, 'Provisional') : h('span', { class: 'muted' }, 'Propia')),
      h('td', { class: 'small muted' }, fmtFecha(p.created_at)),
      h('td', { class: 'acciones-usuario' }, btn, btnPass, btnBloq, btnBorrar));
  }
  function pintar() {
    const act = perfiles.filter((p) => p.activo).length;
    const sin = perfiles.filter((p) => p.activo && !p.email).length;
    contador.textContent = `${perfiles.length} usuarios · ${act} activos${sin ? ` (${sin} sin acceso por no tener email)` : ''}`;
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
    const nombreNuevo = aNombre.value.trim();
    if (!nombreNuevo) { toast('Escribe el nombre', 'error'); aNombre.focus(); return; }
    if (email && !EMAIL_OK.test(email)) { toast('Escribe un email válido (o déjalo vacío)', 'error'); aEmail.focus(); return; }
    const pass = email ? generarPassword() : null;
    aBtn.disabled = true;
    try {
      const r = await adminUsuarios({ accion: 'crear', email, nombre: nombreNuevo, rol: aRol.value, ...(pass ? { password: pass } : {}) });
      perfiles = [...perfiles, r.perfil];
      pintar();
      aNombre.value = ''; aEmail.value = '';
      if (pass) await mostrarPassword({ titulo: `Usuario creado: ${nombreDe(r.perfil.rol)}`, email, pass });
      else toast('Creado sin acceso. Cuando le pongas un email podrá entrar.');
    } catch (ex) { toast('No se ha creado: ' + ex.message, 'error'); }
    finally { aBtn.disabled = false; }
  } },
  h('label', { class: 'field' }, h('span', {}, 'Nombre'), aNombre), h('label', { class: 'field' }, h('span', {}, 'Email (opcional)'), aEmail),
  h('label', { class: 'field' }, h('span', {}, 'Rol'), aRol), h('div'), aBtn);

  const panelUsuarios = h('div', {},
    h('div', { class: 'card' }, h('h3', {}, 'Dar de alta'),
      h('p', { class: 'small muted' }, 'Con email: se crea con una contraseña provisional que verás una sola vez para pasársela; al entrar, la app le obliga a elegir la suya. Sin email: se crea solo la ficha, sin acceso (sirve para asignarle tareas o vincular a una profesora); cuando le pongas el email en la tabla y guardes, podrá entrar. Si es profesora, vincúlala a su ficha.'),
      alta),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data tabla-usuarios' },
      h('thead', {}, h('tr', {}, ['Nombre', 'Email', 'Rol', 'Estado', 'Contraseña', 'Alta', ''].map((t) => h('th', { scope: 'col' }, t)))), tbody)));
  const panelPermisos = h('div', { hidden: true });
  let permisosCargados = false;
  const seg = (txt, id) => h('button', { class: 'seg-btn', type: 'button', 'data-id': id, onclick: () => mostrar(id) }, txt);
  const segUsuarios = seg('Usuarios', 'u'); const segPermisos = seg('Permisos de los roles', 'p');
  function mostrar(id) {
    segUsuarios.setAttribute('aria-selected', String(id === 'u')); segPermisos.setAttribute('aria-selected', String(id === 'p'));
    panelUsuarios.hidden = id !== 'u'; panelPermisos.hidden = id !== 'p';
    if (id === 'p' && !permisosCargados) { permisosCargados = true; renderPermisosRoles(panelPermisos, ctx); }
  }

  clear(view,
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'Usuarios y permisos'), contador)),
    h('div', { class: 'segmented', style: 'margin-bottom:12px' }, segUsuarios, segPermisos),
    panelUsuarios, panelPermisos);
  pintar();
  mostrar('u');
}
