// Usuarios > Permisos de los roles: matriz editable (rol × permiso). Solo la ve el administrador.
// Lo que se guarda aquí es lo que aplica la base de datos (tabla rol_permisos); el rol Administrador siempre lo tiene todo.
import { h, clear, toast, cargando, confirmar } from '../ui.js';
import { getRoles, getPermisosRoles, guardarPermisos } from '../db.js';
import { GRUPOS_PERMISOS, OPCIONES, celda, RECOMENDADOS } from '../permisos.js';

export async function renderPermisosRoles(cont, ctx) {
  clear(cont, cargando());
  const [roles, filas] = await Promise.all([getRoles(), getPermisosRoles()]);
  const editables = roles.filter((r) => r.rol !== 'admin');
  const actual = new Map(filas.map((f) => [`${f.rol}|${f.permiso}`, celda(f)]));
  const cambios = new Map(); // 'rol|permiso' -> valor nuevo
  const valor = (rol, permiso) => (cambios.has(`${rol}|${permiso}`) ? cambios.get(`${rol}|${permiso}`) : actual.get(`${rol}|${permiso}`) || '');
  const nombreRol = (rol) => roles.find((r) => r.rol === rol)?.nombre || rol;

  const btnGuardar = h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Guardar cambios');
  const btnDescartar = h('button', { class: 'btn', type: 'button', disabled: true }, 'Descartar');
  const avisos = h('div');
  const celdas = new Map(); // 'rol|permiso' -> { td, select }

  function marcar(rol, p, v) {
    const k = `${rol}|${p.k}`;
    if (v === (actual.get(k) || '')) cambios.delete(k); else cambios.set(k, v);
    const c = celdas.get(k);
    c.td.classList.toggle('cambiado', cambios.has(k));
    c.select.value = v;
    refrescarBoton();
  }
  function refrescarBoton() {
    btnGuardar.disabled = !cambios.size; btnDescartar.disabled = !cambios.size;
    btnGuardar.textContent = cambios.size ? `Guardar cambios (${cambios.size})` : 'Guardar cambios';
  }

  const tbody = h('tbody');
  for (const g of GRUPOS_PERMISOS) {
    tbody.append(h('tr', { class: 'grupo' }, h('td', { colspan: String(2 + editables.length) }, g.grupo)));
    for (const p of g.items) {
      const tr = h('tr', {}, h('td', { class: 'permiso' }, p.t, p.dinero ? h('span', { class: 'pill warn', style: 'margin-left:6px', title: 'Da acceso a dinero' }, 'dinero') : null),
        h('td', { class: 'celda rol-fijo', title: 'El administrador siempre lo tiene todo' }, 'Todo'));
      for (const r of editables) {
        const select = h('select', { 'aria-label': `${p.t} · ${r.nombre}`, onchange: (e) => marcar(r.rol, p, e.target.value) },
          OPCIONES[p.tipo].map(([v, t]) => h('option', { value: v, selected: v === valor(r.rol, p.k) }, t)));
        const td = h('td', { class: 'celda' }, select);
        celdas.set(`${r.rol}|${p.k}`, { td, select });
        tr.append(td);
      }
      tbody.append(tr);
    }
  }

  btnDescartar.addEventListener('click', () => {
    for (const k of [...cambios.keys()]) { const c = celdas.get(k); c.select.value = actual.get(k) || ''; c.td.classList.remove('cambiado'); }
    cambios.clear(); refrescarBoton();
  });

  btnGuardar.addEventListener('click', async () => {
    const lista = [...cambios.entries()].map(([k, v]) => { const [rol, permiso] = k.split('|'); return { rol, permiso, valor: v, antes: actual.get(k) || '' }; });
    const todos = GRUPOS_PERMISOS.flatMap((g) => g.items);
    const linea = (c) => { const p = todos.find((x) => x.k === c.permiso); const t = (v) => (OPCIONES[p.tipo].find(([x]) => x === v) || [0, v])[1]; return `${nombreRol(c.rol)} · ${p.t}: ${t(c.antes)} → ${t(c.valor)}`; };
    const ok = await confirmar({
      titulo: 'Guardar permisos',
      texto: h('div', {}, h('p', {}, 'Se aplicarán ahora en la base de datos. Quien esté dentro verá los cambios al recargar la página.'),
        h('ul', { class: 'small', style: 'margin:6px 0 0; padding-left:18px' }, lista.map((c) => h('li', {}, linea(c))))),
      ok: 'Guardar',
    });
    if (!ok) return;
    btnGuardar.disabled = true;
    try {
      await guardarPermisos(lista);
      for (const c of lista) { const k = `${c.rol}|${c.permiso}`; if (c.valor) actual.set(k, c.valor); else actual.delete(k); celdas.get(k).td.classList.remove('cambiado'); }
      cambios.clear(); refrescarBoton();
      toast('Permisos guardados');
    } catch (ex) { btnGuardar.disabled = false; toast('No se han guardado: ' + ex.message, 'error'); }
  });

  // volver un rol a lo recomendado (queda pendiente de guardar)
  const selReset = h('select', { 'aria-label': 'Rol a restablecer' }, editables.filter((r) => RECOMENDADOS[r.rol]).map((r) => h('option', { value: r.rol }, r.nombre)));
  const btnReset = h('button', { class: 'btn small', type: 'button', onclick: () => {
    const rec = RECOMENDADOS[selReset.value] || {};
    for (const p of GRUPOS_PERMISOS.flatMap((g) => g.items)) marcar(selReset.value, p, rec[p.k] || '');
    toast('Valores recomendados puestos: revisa y pulsa «Guardar cambios».');
  } }, 'Poner lo recomendado');

  clear(cont,
    h('div', { class: 'card' },
      h('h3', {}, 'Qué puede hacer cada rol'),
      h('p', { class: 'small muted' }, 'Elige para cada rol qué secciones ve y si puede cambiarlas. «Lo suyo» significa lo asignado a su ficha de profesora: los grupos donde da clase, sus tutorías y los alumnos de sus grupos. ',
        'Se aplica en la base de datos, no solo en las pantallas. El Administrador siempre lo tiene todo y no se puede limitar.'),
      avisos,
      h('div', { class: 'table-wrap' }, h('table', { class: 'data matriz-roles' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Permiso'), h('th', { class: 'rol-col' }, 'Administrador', h('div', { class: 'small muted' }, 'siempre todo')),
          editables.map((r) => h('th', { class: 'rol-col', title: r.descripcion || '' }, r.nombre, h('div', { class: 'small muted' }, r.descripcion ? '' : '')))) ),
        tbody)),
      h('div', { class: 'ac-fila', style: 'margin-top:10px; flex-wrap:wrap; gap:8px' }, btnGuardar, btnDescartar, h('span', { class: 'muted small', style: 'margin-left:auto' }, 'Restablecer rol: '), selReset, btnReset),
      h('ul', { class: 'small muted' }, editables.map((r) => h('li', {}, h('strong', {}, r.nombre), ': ', r.descripcion || '')))));
}
