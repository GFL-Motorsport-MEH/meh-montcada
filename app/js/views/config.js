// Pestaña Configuración: empresas, listas, centros y plantillas de gastos.
import { h, clear, fmtEUR2, fmtFecha, num, normalizar, cargando, descargarCSV, toast, confirmar, hoyISO } from '../ui.js';
import * as db from '../db.js';

const SECCIONES = [['empresas', 'Empresas'], ['listas', 'Listas'], ['centros', 'Centros'], ['plantillas', 'Plantillas de gastos']];
const LS = 'meh.config';
const leerPref = () => { try { return localStorage.getItem(LS) || 'empresas'; } catch { return 'empresas'; } };
const guardarPref = (v) => { try { localStorage.setItem(LS, v); } catch { /* sin almacenamiento */ } };
const extras = {};
export function registrarSeccionConfig(id, render) { extras[id] = render; }

export const limpiarIBAN = (s) => String(s || '').replace(/[\s-]/g, '').toUpperCase();
export const formatoIBAN = (s) => limpiarIBAN(s).replace(/(.{4})/g, '$1 ').trim();
// IBAN válido según el dígito de control (mod 97). Vacío = válido.
export function ibanValido(s) {
  const v = limpiarIBAN(s);
  if (!v) return true;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return false;
  const r = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0;
  for (const d of r) m = (m * 10 + Number(d)) % 97;
  return m === 1;
}

async function renderEmpresas(cont, ctx) {
  clear(cont, cargando());
  const empresas = await ctx.empresas();
  const uso = new Map();
  for (const c of ctx.state.cursosVisibles) {
    for (const g of await ctx.gastos(c.id)) {
      const k = (g.empresa || '').trim().toLowerCase(); if (!k) continue;
      const u = uso.get(k) || { n: 0, total: 0 }; u.n++; u.total += num(g.cantidad); uso.set(k, u);
    }
  }
  let q = '', soloSinDatos = false;
  const contador = h('div', { class: 'count' });
  const tbody = h('tbody');
  const fQ = h('input', { type: 'search', placeholder: 'Buscar empresa, CIF o IBAN…', 'aria-label': 'Buscar empresa', oninput: () => { q = fQ.value; pintar(); } });
  const fSin = h('input', { type: 'checkbox', onchange: () => { soloSinDatos = fSin.checked; pintar(); } });

  async function guardarCampo(e, campo, input) {
    let valor = input.value.trim();
    if (campo === 'iban') {
      if (valor && !ibanValido(valor)) { input.classList.add('invalid'); toast('El IBAN no es válido (revisa los dígitos).', 'error'); return; }
      valor = valor ? formatoIBAN(valor) : '';
    }
    if (campo === 'cif') valor = valor.toUpperCase();
    input.classList.remove('invalid');
    const antes = e[campo] || '';
    if (valor === antes) { input.value = antes; return; }
    if (campo === 'nombre_comercial') {
      if (!valor) { input.value = antes; toast('El nombre comercial no puede quedar vacío.', 'error'); return; }
      if (empresas.some((x) => x !== e && x.nombre_comercial.toLowerCase() === valor.toLowerCase())) { input.value = antes; toast(`Ya existe la empresa "${valor}".`, 'error'); return; }
      const n = uso.get(antes.toLowerCase())?.n || 0;
      if (n && !(await confirmar({ titulo: 'Cambiar nombre de la empresa', texto: `Se cambiará "${antes}" por "${valor}" en la ficha y en sus ${n} gastos de todos los cursos.`, ok: 'Cambiar en todo' }))) { input.value = antes; return; }
    }
    input.classList.add('saving');
    try {
      Object.assign(e, await db.actualizarEmpresa(e.id, { [campo]: valor || null }));
      if (campo === 'nombre_comercial' && antes) {
        const n = await db.renombrarEmpresaEnGastos(antes, valor);
        for (const c of ctx.state.cursos) ctx.invalidar(c.id);
        ctx.state.sugerencias = null;
        const u = uso.get(antes.toLowerCase()); uso.delete(antes.toLowerCase()); if (u) uso.set(valor.toLowerCase(), u);
        if (n) toast(`Nombre cambiado también en ${n} gastos.`);
      }
      input.value = e[campo] || '';
      input.classList.add('saved'); setTimeout(() => input.classList.remove('saved'), 900);
    } catch (ex) { input.value = antes; toast('No se ha guardado: ' + ex.message, 'error'); }
    finally { input.classList.remove('saving'); }
  }
  const campo = (e, c, label, attrs = {}) => {
    const input = h('input', { type: 'text', class: 'cell cell-text', value: e[c] || '', 'aria-label': `${label} · ${e.nombre_comercial}`, ...attrs });
    input.addEventListener('blur', () => guardarCampo(e, c, input));
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') input.blur(); if (ev.key === 'Escape') { input.value = e[c] || ''; input.blur(); } });
    return h('td', { class: 'cell-td' }, input);
  };

  function lista() {
    const nq = normalizar(q.trim());
    return empresas.filter((e) => (!soloSinDatos || !e.cif || !e.iban)
      && (!nq || normalizar(`${e.nombre_comercial} ${e.razon_social} ${e.cif} ${limpiarIBAN(e.iban)}`).includes(nq.replace(/\s/g, '')) || normalizar(`${e.nombre_comercial} ${e.razon_social}`).includes(nq)))
      .sort((a, b) => a.nombre_comercial.localeCompare(b.nombre_comercial, 'es'));
  }
  function pintar() {
    const l = lista();
    contador.textContent = `${l.length} de ${empresas.length} empresas · ${empresas.filter((e) => e.cif).length} con CIF · ${empresas.filter((e) => e.iban).length} con IBAN`;
    clear(tbody, l.map((e) => {
      const u = uso.get(e.nombre_comercial.toLowerCase());
      return h('tr', { 'data-id': e.id },
        campo(e, 'nombre_comercial', 'Nombre comercial'), campo(e, 'razon_social', 'Razón social'),
        campo(e, 'cif', 'CIF', { class: 'cell cell-text mono' }), campo(e, 'iban', 'IBAN', { class: 'cell cell-text mono cell-iban' }),
        h('td', { class: 'mono small' }, e.fecha_registro ? fmtFecha(e.fecha_registro) : '—'),
        h('td', { class: 'num small' }, u ? `${u.n} · ${fmtEUR2(u.total)}` : '—'));
    }));
  }
  async function nueva() {
    let nombre = 'Nueva empresa', i = 2;
    while (empresas.some((e) => e.nombre_comercial.toLowerCase() === nombre.toLowerCase())) nombre = `Nueva empresa ${i++}`;
    try {
      const e = await db.crearEmpresa({ nombre_comercial: nombre, fecha_registro: hoyISO() });
      empresas.push(e); q = ''; fQ.value = ''; pintar();
      const input = tbody.querySelector(`tr[data-id="${e.id}"] input`);
      input?.focus(); input?.select();
    } catch (ex) { toast('No se ha creado: ' + ex.message, 'error'); }
  }
  function exportar() {
    descargarCSV('empresas.csv', [['Nombre comercial', 'Razón social', 'CIF', 'IBAN', 'Fecha registro', 'Nº gastos'],
      ...lista().map((e) => [e.nombre_comercial, e.razon_social, e.cif, e.iban, e.fecha_registro ? fmtFecha(e.fecha_registro) : '', uso.get(e.nombre_comercial.toLowerCase())?.n || 0])]);
  }

  clear(cont,
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'Empresas y proveedores'), contador),
      h('div', { class: 'section-actions' }, h('button', { class: 'btn', onclick: exportar }, 'Exportar CSV'), h('button', { class: 'btn primary', onclick: nueva }, '+ Nueva empresa'))),
    h('p', { class: 'muted small' }, 'El nombre comercial es el que aparece en los gastos: si lo cambias, se cambia en todos los gastos. Al elegir la empresa en un gasto se rellenan solos el CIF y el IBAN.'),
    h('div', { class: 'filters filters-2' }, h('div', { class: 'search' }, fQ), h('label', { class: 'check small' }, fSin, 'Solo sin CIF o sin IBAN')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data tabla-empresas' },
      h('thead', {}, h('tr', {}, ['Nombre comercial', 'Razón social', 'CIF', 'IBAN', 'Registro'].map((t) => h('th', { scope: 'col' }, t)), h('th', { scope: 'col', class: 'num' }, 'Gastos'))),
      tbody)));
  pintar();
}

export async function renderConfig(view, ctx) {
  let sec = leerPref();
  if (!SECCIONES.some(([id]) => id === sec)) sec = 'empresas';
  const seg = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Sección de configuración' });
  const cuerpo = h('div', { class: 'control-cuerpo' });
  async function pintar() {
    clear(seg, SECCIONES.map(([id, label]) => h('button', { class: 'seg-btn', role: 'tab', 'aria-selected': String(id === sec), onclick: () => { sec = id; guardarPref(id); pintar(); } }, label)));
    if (sec === 'empresas') await renderEmpresas(cuerpo, ctx);
    else if (extras[sec]) await extras[sec](cuerpo, ctx);
    else clear(cuerpo, h('div', { class: 'card empty' }, 'Próximamente.'));
  }
  clear(view, h('div', { class: 'section-head no-print' }, seg), cuerpo);
  await pintar();
}
