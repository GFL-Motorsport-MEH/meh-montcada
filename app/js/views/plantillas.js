// Plantillas de gastos que se repiten (gastos mensuales y nóminas):
//  - Configuración > Plantillas de gastos: crear, editar, activar/desactivar, borrar y sugerir desde los gastos.
//  - Gastos > "Generar gastos del mes": crea de una vez los gastos de un mes a partir de las plantillas.
import { h, clear, cargando, toast, confirmar, fmtEUR2, num, MESES, capitalizar, tituloCategoria } from '../ui.js';
import * as db from '../db.js';
import { registrarSeccionConfig } from './config.js';
import { propuestaDesdePlantillas, sugerirPlantillas } from '../gastos-ops.js';

const GRUPOS = [['mensual', 'Gastos mensuales'], ['nomina', 'Nóminas']];
const leerImporte = (s) => { let t = String(s ?? '').trim().replace(/\s|€/g, ''); if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); const n = Number(t); return t === '' ? null : Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };

async function cargarPlantillas(ctx) {
  if (!ctx.state.plantillas) ctx.state.plantillas = await db.getPlantillas();
  return ctx.state.plantillas;
}

function selectSubcat(ctx, valor, label) {
  return h('select', { 'aria-label': label, class: 'select-celda' }, h('option', { value: '' }, '— categoría —'),
    ctx.state.taxonomia.map((c) => h('optgroup', { label: tituloCategoria(c.nombre) },
      c.subcategorias.map((s) => h('option', { value: s.id, selected: s.id === valor }, `${tituloCategoria(c.nombre)} › ${s.nombre}`)))));
}
const catDeSub = (ctx, subId) => ctx.state.taxonomia.find((c) => c.subcategorias.some((s) => s.id === subId))?.id || null;

async function renderPlantillas(cont, ctx) {
  clear(cont, cargando());
  const plantillas = await cargarPlantillas(ctx);
  const metodos = (ctx.state.listas || []).filter((x) => x.lista === 'metodo_pago').map((x) => x.valor);
  const secciones = {};

  async function guardar(p, cambios, el) {
    el?.classList.add('saving');
    try { Object.assign(p, await db.actualizarPlantilla(p.id, cambios)); el?.classList.add('saved'); setTimeout(() => el?.classList.remove('saved'), 900); pintarTotales(); }
    catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
    finally { el?.classList.remove('saving'); }
  }

  function fila(p) {
    const txt = (campo, label, attrs = {}) => {
      const i = h('input', { type: 'text', class: 'cell cell-text', value: p[campo] ?? '', 'aria-label': `${label} · ${p.empresa}`, ...attrs });
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
      i.addEventListener('blur', () => {
        let v = i.value.trim();
        if (campo === 'cantidad') { v = leerImporte(v); if (Number.isNaN(v)) { i.classList.add('invalid'); toast('Importe no válido', 'error'); return; } i.classList.remove('invalid'); i.value = v == null ? '' : String(v).replace('.', ','); }
        if (campo === 'dia_pago') { v = v === '' ? null : Math.min(31, Math.max(1, parseInt(v, 10) || 1)); i.value = v ?? ''; }
        if (campo === 'empresa' && !v) { i.value = p.empresa; return; }
        if ((v ?? null) === (p[campo] ?? null) || (campo === 'cantidad' && num(v) === num(p[campo]) && p[campo] != null)) return;
        guardar(p, { [campo]: v === '' ? null : v }, i).then(() => { if (campo === 'empresa') pintar(); });
      });
      return h('td', { class: 'cell-td' }, i);
    };
    const sub = selectSubcat(ctx, p.subcategoria_id, `Categoría · ${p.empresa}`);
    sub.addEventListener('change', () => guardar(p, { subcategoria_id: sub.value || null, categoria_id: catDeSub(ctx, sub.value) }, sub));
    const met = h('select', { 'aria-label': `Método · ${p.empresa}`, class: 'select-celda' }, h('option', { value: '' }, '—'),
      [...new Set([...metodos, p.metodo_pago].filter(Boolean))].map((m) => h('option', { value: m, selected: m === p.metodo_pago }, m)));
    met.addEventListener('change', () => guardar(p, { metodo_pago: met.value || null }, met));
    const cen = ctx.state.centros.length > 1 ? h('select', { 'aria-label': `Centro · ${p.empresa}`, class: 'select-celda' }, h('option', { value: '' }, 'Principal'),
      ctx.state.centros.map((c) => h('option', { value: c.id, selected: c.id === p.centro_id }, ctx.tituloCentro(c.nombre)))) : null;
    cen?.addEventListener('change', () => guardar(p, { centro_id: cen.value || null }, cen));
    const act = h('input', { type: 'checkbox', checked: p.activo !== false, 'aria-label': `Activa · ${p.empresa}`, onchange: () => guardar(p, { activo: act.checked }) });
    return h('tr', { class: p.activo === false ? 'inactiva' : '' },
      h('td', { class: 'center' }, act), txt('empresa', 'Empresa', { list: 'dl-pl-empresa' }), txt('concepto', 'Concepto', { placeholder: 'p.ej. Nómina {mes}' }),
      txt('cantidad', 'Importe', { class: 'cell', inputmode: 'decimal' }), h('td', { class: 'cell-td' }, sub), h('td', { class: 'cell-td' }, met),
      txt('dia_pago', 'Día', { class: 'cell cell-dia', inputmode: 'numeric' }), cen ? h('td', { class: 'cell-td' }, cen) : null,
      h('td', {}, h('button', { class: 'btn ghost small', 'aria-label': `Borrar plantilla ${p.empresa}`, onclick: async () => {
        if (!(await confirmar({ titulo: 'Borrar plantilla', texto: `Se borrará la plantilla "${p.empresa} · ${p.concepto || ''}". Los gastos ya creados no se tocan.`, ok: 'Borrar', peligro: true }))) return;
        try { await db.borrarPlantilla(p.id); plantillas.splice(plantillas.indexOf(p), 1); pintar(); } catch (ex) { toast(ex.message, 'error'); }
      } }, '✕')));
  }

  const totales = {};
  function pintarTotales() {
    for (const [g] of GRUPOS) {
      const act = plantillas.filter((p) => p.grupo === g && p.activo !== false);
      if (totales[g]) totales[g].textContent = `${act.length} activas · ${fmtEUR2(act.reduce((s, p) => s + num(p.cantidad), 0))} al mes`;
    }
  }
  function pintar() {
    for (const [g] of GRUPOS) {
      clear(secciones[g], plantillas.filter((p) => p.grupo === g).length
        ? plantillas.filter((p) => p.grupo === g).map(fila)
        : h('tr', {}, h('td', { colspan: 9, class: 'empty' }, 'Sin plantillas. Añade una o pulsa "Sugerir desde los gastos".')));
    }
    pintarTotales();
  }
  async function anadir(grupo, datos = {}) {
    try {
      const p = await db.crearPlantilla({ grupo, empresa: datos.empresa || (grupo === 'nomina' ? 'Nueva persona' : 'Nueva empresa'), concepto: datos.concepto ?? (grupo === 'nomina' ? 'Nómina {mes}' : '{mes}'),
        tipo: datos.tipo || (grupo === 'nomina' ? 'Nomina' : 'Factura'), periodicidad: 'Mensual', orden: plantillas.length, ...datos, grupo });
      plantillas.push(p); pintar();
      return p;
    } catch (ex) { toast('No se ha creado: ' + ex.message, 'error'); return null; }
  }
  const sugCont = h('div');
  async function sugerir() {
    const curso = ctx.cursoActual();
    const sug = sugerirPlantillas(await ctx.gastos(curso.id), plantillas);
    if (!sug.length) { clear(sugCont, h('p', { class: 'muted small' }, `No hay más gastos que se repitan cada mes en ${curso.nombre}.`)); return; }
    clear(sugCont, h('section', { class: 'card sugerencias' }, h('h3', {}, `Sugerencias (gastos que se repiten en ${curso.nombre})`),
      h('ul', {}, sug.map((s) => {
        const li = h('li', {}, h('span', {}, h('strong', {}, s.empresa), ` · ${s.concepto || ''} · ${fmtEUR2(s.cantidad)} · ${s.meses} meses`, h('span', { class: 'pill' }, s.grupo === 'nomina' ? 'nómina' : 'mensual')),
          h('button', { class: 'btn small', onclick: async () => { const { meses, ...datos } = s; if (await anadir(s.grupo, datos)) li.remove(); } }, 'Añadir'));
        return li;
      }))));
  }

  clear(cont,
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'Plantillas de gastos'),
      h('div', { class: 'count' }, 'Gastos que se repiten cada mes y nóminas. Desde Gastos > "Generar gastos del mes" se crean todos de una vez. En el concepto, {mes} se cambia por el mes.')),
      h('div', { class: 'section-actions' }, h('button', { class: 'btn', onclick: sugerir }, 'Sugerir desde los gastos'))),
    sugCont,
    h('datalist', { id: 'dl-pl-empresa' }, (ctx.state.empresas || []).map((e) => h('option', { value: e.nombre_comercial }))),
    GRUPOS.map(([g, titulo]) => {
      secciones[g] = h('tbody');
      totales[g] = h('span', { class: 'muted small' });
      return h('section', { class: 'card lista-card' },
        h('div', { class: 'section-head' }, h('div', {}, h('h3', {}, titulo), totales[g]), h('button', { class: 'btn small primary', onclick: () => anadir(g) }, g === 'nomina' ? '+ Añadir nómina' : '+ Añadir gasto mensual')),
        h('div', { class: 'table-wrap' }, h('table', { class: `data tabla-plantillas pl-${g}` },
          h('thead', {}, h('tr', {}, ['Activa', 'Empresa / persona', 'Concepto', 'Importe', 'Categoría', 'Método', 'Día'].map((t) => h('th', { scope: 'col' }, t)),
            ctx.state.centros.length > 1 ? h('th', { scope: 'col' }, 'Centro') : null, h('th', {}))),
          secciones[g])));
    }));
  pintar();
}
registrarSeccionConfig('plantillas', renderPlantillas);

// ---------- Generar gastos del mes ----------
export async function generarGastosDelMes(ctx, { curso, gastos, onCreados }) {
  const plantillas = await cargarPlantillas(ctx);
  if (!plantillas.some((p) => p.activo !== false)) { toast('No hay plantillas activas. Créalas en Configuración > Plantillas de gastos.', 'error'); return; }
  const hoyMes = MESES[(new Date().getMonth() + 4) % 12];
  const selMes = h('select', { 'aria-label': 'Mes a generar' }, MESES.map((m) => h('option', { value: m, selected: m === hoyMes }, capitalizar(m))));
  const selGrupo = h('select', { 'aria-label': 'Qué generar' }, h('option', { value: '' }, 'Mensuales y nóminas'), GRUPOS.map(([g, t]) => h('option', { value: g }, t)));
  const tbody = h('tbody');
  const resumen = h('div', { class: 'muted small' });
  let filas = [];
  function pintar() {
    const lista = plantillas.filter((p) => !selGrupo.value || p.grupo === selGrupo.value);
    filas = propuestaDesdePlantillas(lista, { curso, mes: selMes.value, existentes: gastos, centroPorDefecto: ctx.centroActual()?.id || ctx.centroPrincipal()?.id }).map((x) => ({
      ...x, chk: h('input', { type: 'checkbox', checked: !x.duplicado, 'aria-label': `Crear ${x.gasto.empresa} ${x.gasto.concepto}`, onchange: total }),
      imp: h('input', { type: 'text', class: 'cell', inputmode: 'decimal', value: x.gasto.cantidad ? x.gasto.cantidad.toFixed(2).replace('.', ',') : '', 'aria-label': `Importe ${x.gasto.empresa}`, oninput: total }),
    }));
    clear(tbody, filas.map((x) => h('tr', { class: x.duplicado ? 'duplicado' : '' },
      h('td', { class: 'center' }, x.chk), h('td', {}, x.gasto.empresa, h('span', { class: 'line2' }, x.gasto.concepto)),
      h('td', { class: 'mono' }, x.gasto.fecha_pago), h('td', { class: 'cell-td' }, x.imp),
      h('td', {}, x.duplicado ? h('span', { class: 'pill warn' }, 'ya existe') : ''))));
    total();
  }
  function total() {
    const sel = filas.filter((x) => x.chk.checked);
    resumen.textContent = `${sel.length} gastos · ${fmtEUR2(sel.reduce((s, x) => s + num(leerImporte(x.imp.value)), 0))}`;
  }
  selMes.addEventListener('change', pintar); selGrupo.addEventListener('change', pintar);
  pintar();
  const ok = await confirmar({ titulo: `Generar gastos del mes · ${curso.nombre}`, ok: 'Crear gastos',
    texto: h('div', { class: 'generar' }, h('div', { class: 'generar-ctrl' }, h('label', { class: 'check small' }, 'Mes', selMes), h('label', { class: 'check small' }, selGrupo), resumen),
      h('p', { class: 'muted small' }, 'Revisa los importes (las nóminas pueden variar). Los que ya existen en ese mes salen desmarcados.'),
      h('div', { class: 'table-wrap generar-tabla' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['', 'Gasto', 'Fecha', 'Importe', ''].map((t, i) => h('th', { scope: 'col', class: i === 3 ? 'num' : '' }, t)))), tbody))) });
  if (!ok) return;
  const nuevos = [];
  for (const x of filas.filter((f) => f.chk.checked)) {
    const v = leerImporte(x.imp.value);
    if (v == null || Number.isNaN(v)) { toast(`Falta un importe válido para ${x.gasto.empresa}.`, 'error'); return; }
    const cat = ctx.state.taxonomia.find((c) => c.id === x.gasto.categoria_id);
    const sub = cat?.subcategorias.find((s) => s.id === x.gasto.subcategoria_id);
    nuevos.push({ ...x.gasto, cantidad: v, categoria_texto: cat ? tituloCategoria(cat.nombre) : null, subcategoria_texto: sub?.nombre || null });
  }
  if (!nuevos.length) { toast('No has marcado ningún gasto.'); return; }
  try {
    const creados = await db.crearGastos(nuevos);
    toast(`${creados.length} gastos creados en ${capitalizar(selMes.value)}`);
    onCreados(creados);
  } catch (ex) { toast('No se han creado: ' + ex.message, 'error'); }
}
