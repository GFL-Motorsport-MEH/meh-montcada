// Configuración > Centros: crear, renombrar, activar/desactivar y elegir el principal.
import { h, clear, cargando, toast, fmtEUR2, num } from '../ui.js';
import * as db from '../db.js';
import { registrarSeccionConfig } from './config.js';

async function renderCentros(cont, ctx) {
  clear(cont, cargando());
  const admin = ctx.esAdmin();
  const centros = ctx.state.centros;
  const principal = () => ctx.centroPrincipal()?.id;
  const uso = new Map();
  for (const c of ctx.state.cursosVisibles) {
    for (const g of await ctx.gastos(c.id)) {
      const k = g.centro_id || principal();
      const u = uso.get(k) || { n: 0, total: 0 }; u.n++; u.total += num(g.cantidad); uso.set(k, u);
    }
  }
  const tbody = h('tbody');
  async function cambiar(c, cambios, msg) {
    try {
      if (cambios.principal) {
        const ant = centros.find((x) => x.principal && x !== c);
        if (ant) Object.assign(ant, await db.actualizarCentro(ant.id, { principal: false }));
      }
      Object.assign(c, await db.actualizarCentro(c.id, cambios));
      toast(msg); pintar(); ctx.repintarCabecera();
    } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); pintar(); }
  }
  function pintar() {
    clear(tbody, centros.map((c) => {
      const u = uso.get(c.id);
      let nombre;
      if (admin) {
        nombre = h('input', { type: 'text', class: 'cell cell-text', value: c.nombre, 'aria-label': `Nombre del centro ${c.nombre}` });
        nombre.addEventListener('keydown', (e) => { if (e.key === 'Enter') nombre.blur(); });
        nombre.addEventListener('blur', () => {
          const v = nombre.value.trim().toUpperCase();
          if (!v || v === c.nombre) { nombre.value = c.nombre; return; }
          if (centros.some((x) => x !== c && x.nombre === v)) { toast('Ya existe ese centro.', 'error'); nombre.value = c.nombre; return; }
          cambiar(c, { nombre: v }, 'Centro renombrado');
        });
      } else nombre = h('span', {}, ctx.tituloCentro(c.nombre));
      return h('tr', {},
        h('td', { class: 'cell-td' }, nombre),
        h('td', { class: 'center' }, h('input', { type: 'radio', name: 'principal', checked: !!c.principal, disabled: !admin, 'aria-label': `${c.nombre} es el centro principal`,
          onchange: () => cambiar(c, { principal: true }, `${ctx.tituloCentro(c.nombre)} es ahora el centro principal`) })),
        h('td', { class: 'center' }, h('input', { type: 'checkbox', checked: c.activo !== false, disabled: !admin || c.principal, 'aria-label': `${c.nombre} activo`,
          onchange: (e) => cambiar(c, { activo: e.target.checked }, e.target.checked ? 'Centro activado' : 'Centro desactivado: ya no aparece al crear gastos') })),
        h('td', { class: 'num' }, u ? `${u.n} gastos · ${fmtEUR2(u.total)}` : 'sin gastos'));
    }));
  }
  const nuevo = h('input', { type: 'text', placeholder: 'Nombre del nuevo centro', 'aria-label': 'Nombre del nuevo centro', class: 'input-anadir' });
  async function crear() {
    const v = nuevo.value.trim().toUpperCase();
    if (!v) return;
    if (centros.some((x) => x.nombre === v)) { toast('Ya existe ese centro.', 'error'); return; }
    try { centros.push(await db.crearCentro(v, centros.length)); nuevo.value = ''; pintar(); toast('Centro creado'); ctx.repintarCabecera(); }
    catch (ex) { toast('No se ha creado: ' + ex.message, 'error'); }
  }
  nuevo.addEventListener('keydown', (e) => { if (e.key === 'Enter') crear(); });
  clear(cont,
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'Centros'),
      h('div', { class: 'count' }, 'Elige el centro arriba (junto al curso) para ver gastos, Panel y Balance de un solo centro. En Gastos puedes seleccionar varios y moverlos a otro centro.'))),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data tabla-centros' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Centro'), h('th', { scope: 'col', class: 'center' }, 'Principal'), h('th', { scope: 'col', class: 'center' }, 'Activo'), h('th', { scope: 'col', class: 'num' }, 'Gastos (todos los cursos)'))),
      tbody)),
    admin ? h('div', { class: 'fila-anadir' }, nuevo, h('button', { class: 'btn primary', onclick: crear }, 'Crear centro')) : null,
    h('p', { class: 'muted small' }, 'Los ingresos todavía no se separan por centro: cuentan como del centro principal.'));
  pintar();
}

registrarSeccionConfig('centros', renderCentros);
