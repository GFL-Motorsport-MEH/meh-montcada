// Control > Notas (hoja Notas: cuaderno de revisiones) y Balance > Datos de interés (hoja Datos interes).
import { h, clear, cargando, toast, fmtEUR2, fmtFecha, num, hoyISO, normalizar, tituloCategoria } from '../ui.js';
import * as db from '../db.js';
import { registrarSeccion } from './control.js';
import { aNumero } from '../facturacion.js';
import { calcularBalance } from '../balance.js';

// ---------- Notas ----------
async function renderNotas(cont, ctx) {
  clear(cont, cargando());
  const notas = await db.getNotas();
  let q = '', soloPend = false;
  const lista = h('div', { class: 'notas-lista' });
  const contador = h('div', { class: 'count' });

  async function guardar(n, cambios, el) {
    el?.classList.add('saving');
    try { Object.assign(n, await db.actualizarNota(n.id, cambios)); el?.classList.add('saved'); setTimeout(() => el?.classList.remove('saved'), 900); }
    catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
    finally { el?.classList.remove('saving'); }
  }
  function tarjeta(n) {
    const cargo = h('input', { type: 'text', value: n.ultimo_cargo || '', placeholder: 'Último cargo revisado', 'aria-label': `Último cargo · ${n.fecha}`, class: 'input-nota' });
    const texto = h('textarea', { rows: Math.min(6, Math.max(2, String(n.comentario || '').split('\n').length)), placeholder: 'Comentarios: qué está revisado, qué falta…', 'aria-label': `Comentario · ${n.fecha}`, class: 'input-nota' }, n.comentario || '');
    const fecha = h('input', { type: 'date', value: n.fecha, 'aria-label': `Fecha de la nota ${n.fecha}`, class: 'input-nota fecha-nota' });
    const hecho = h('input', { type: 'checkbox', checked: !!n.hecho, 'aria-label': `Resuelta · ${n.fecha}` });
    cargo.addEventListener('blur', () => { const v = cargo.value.trim() || null; if (v !== (n.ultimo_cargo || null)) guardar(n, { ultimo_cargo: v }, cargo); });
    texto.addEventListener('blur', () => { const v = texto.value.trim() || null; if (v !== (n.comentario || null)) guardar(n, { comentario: v }, texto); });
    fecha.addEventListener('change', () => { if (fecha.value) guardar(n, { fecha: fecha.value }, fecha); });
    hecho.addEventListener('change', () => { guardar(n, { hecho: hecho.checked }); art.classList.toggle('hecha', hecho.checked); });
    const art = h('article', { class: `card nota ${n.hecho ? 'hecha' : ''}` },
      h('div', { class: 'nota-cab' }, fecha, cargo, h('label', { class: 'check small' }, hecho, 'Resuelta')), texto);
    return art;
  }
  function pintar() {
    const nq = normalizar(q.trim());
    const l = notas.filter((n) => (!soloPend || !n.hecho) && (!nq || normalizar(`${n.ultimo_cargo} ${n.comentario}`).includes(nq)));
    contador.textContent = `${l.length} notas · ${notas.filter((n) => !n.hecho).length} sin resolver`;
    clear(lista, l.length ? l.map(tarjeta) : h('div', { class: 'card empty' }, 'No hay notas con estos filtros.'));
  }
  async function nueva() {
    try { notas.unshift(await db.crearNota({ fecha: hoyISO(), hecho: false })); q = ''; buscar.value = ''; pintar(); lista.querySelector('.nota input[type=text]')?.focus(); }
    catch (ex) { toast('No se ha creado: ' + ex.message, 'error'); }
  }
  const buscar = h('input', { type: 'search', placeholder: 'Buscar en las notas…', 'aria-label': 'Buscar en las notas', oninput: () => { q = buscar.value; pintar(); } });
  const pend = h('input', { type: 'checkbox', onchange: () => { soloPend = pend.checked; pintar(); } });
  clear(cont,
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'Notas de revisión'), contador),
      h('div', { class: 'section-actions' }, h('button', { class: 'btn primary', onclick: nueva }, '+ Nueva nota'))),
    h('p', { class: 'muted small' }, 'Cuaderno de revisiones (hoja Notas): hasta qué cargo está revisado y qué falta. Se guarda al salir de cada campo.'),
    h('div', { class: 'filters filters-2' }, h('div', { class: 'search' }, buscar), h('label', { class: 'check small' }, pend, 'Solo sin resolver')),
    lista);
  pintar();
}
registrarSeccion('notas', renderNotas);

// ---------- Datos de interés ----------
export async function vistaDatosInteres(ctx, curso, gastos, ingresos) {
  const admin = ctx.esAdmin();
  const [tarifas, params] = await Promise.all([db.getTarifas(), db.getParametros()]);
  const P = (k) => num(params.find((p) => p.clave === k)?.valor);
  const cont = h('div', { class: 'datos-interes' });

  function costeHora() {
    const horasMes = P('horas_semanales') * 4;
    const filas = [['Profesor', P('coste_hora_profesor')], ['Material', horasMes ? P('gastos_mes_material') / horasMes : 0],
      ['Local (luz, agua…)', horasMes ? P('gastos_mes_local') / horasMes : 0], ['MEH / banco / gestoría', horasMes ? P('gastos_mes_gestion') / horasMes : 0]];
    return { horasMes, filas, total: filas.reduce((s, f) => s + f[1], 0) };
  }
  // los mismos costes según los gastos reales del curso (media de los meses con gasto)
  function costeReal() {
    const b = calcularBalance(gastos, ingresos, ctx.state.taxonomia);
    const meses = b.totGas.filter((v) => v > 0).length || 1;
    const media = (cats) => cats.reduce((s, c) => s + (b.gasCat.get(c) || []).reduce((a, v) => a + v, 0), 0) / meses;
    return { meses, material: media(['MATERIAL']), local: media(['LOCAL', 'SEGUROS']), gestion: media(['GESTORIA', 'BANCO', 'FRANQUICIA']), trabajadores: media(['TRABAJADORES']) };
  }
  const editNum = (valor, label, onSave, attrs = {}) => {
    if (!admin) return h('span', {}, valor == null ? '—' : String(valor).replace('.', ','));
    const i = h('input', { type: 'text', class: 'cell', inputmode: 'decimal', value: valor == null ? '' : String(valor).replace('.', ','), 'aria-label': label, ...attrs });
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
    i.addEventListener('blur', async () => {
      const v = i.value.trim() === '' ? null : aNumero(i.value);
      if (Number.isNaN(v)) { i.classList.add('invalid'); return; }
      i.classList.remove('invalid');
      if (v === (valor == null ? null : num(valor))) return;
      try { await onSave(v); valor = v; pintar(); } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
    });
    return i;
  };

  function pintar() {
    const c = costeHora(), r = costeReal();
    const tabTarifas = h('table', { class: 'data tabla-tarifas' },
      h('thead', {}, h('tr', {}, ['Grupo', 'Cuota', 'Horas al mes', 'Ingreso por hora', 'Máx. por grupo', 'Máx. ingreso grupo/hora', 'Margen por hora'].map((t, i) => h('th', { scope: 'col', class: i ? 'num' : '' }, t)))),
      h('tbody', {}, tarifas.map((t) => {
        const ih = num(t.horas_mes) ? num(t.cuota) / num(t.horas_mes) : 0, max = ih * num(t.max_grupo);
        const set = (campo) => async (v) => Object.assign(t, await db.actualizarTarifa(t.id, { [campo]: v }));
        return h('tr', {}, h('th', { scope: 'row' }, t.nombre),
          h('td', { class: 'num cell-td' }, editNum(t.cuota, `Cuota ${t.nombre}`, set('cuota'))),
          h('td', { class: 'num cell-td' }, editNum(t.horas_mes, `Horas al mes ${t.nombre}`, set('horas_mes'))),
          h('td', { class: 'num' }, fmtEUR2(ih)),
          h('td', { class: 'num cell-td' }, editNum(t.max_grupo, `Máximo por grupo ${t.nombre}`, set('max_grupo'))),
          h('td', { class: 'num' }, fmtEUR2(max)),
          h('td', { class: `num ${max - c.total < 0 ? 'neg' : ''}` }, fmtEUR2(max - c.total)));
      })));
    const tabCostes = h('table', { class: 'data tabla-costes' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Coste por hora'), h('th', { scope: 'col', class: 'num' }, 'Según parámetros'), h('th', { scope: 'col', class: 'num' }, `Según gastos de ${curso.nombre}`))),
      h('tbody', {},
        c.filas.map(([n, v], i) => h('tr', {}, h('th', { scope: 'row' }, n), h('td', { class: 'num' }, fmtEUR2(v)),
          h('td', { class: 'num' }, i === 0 ? '—' : fmtEUR2([0, r.material, r.local, r.gestion][i] / (c.horasMes || 1))))),
        h('tr', { class: 'total' }, h('th', { scope: 'row' }, 'Total por hora'), h('td', { class: 'num' }, fmtEUR2(c.total)),
          h('td', { class: 'num' }, fmtEUR2(P('coste_hora_profesor') + (r.material + r.local + r.gestion) / (c.horasMes || 1)))),
        h('tr', {}, h('th', { scope: 'row' }, 'Personal (media mensual real)'), h('td', { class: 'num' }, '—'), h('td', { class: 'num' }, fmtEUR2(r.trabajadores)))));
    const tabParams = h('div', { class: 'parametros' }, params.map((p) => h('label', { class: 'param' }, h('span', {}, p.etiqueta),
      editNum(p.valor, p.etiqueta, async (v) => Object.assign(p, await db.guardarParametro(p.clave, v))))));
    clear(cont,
      h('section', { class: 'card lista-card' }, h('h3', {}, 'Ingresos por hora'), h('div', { class: 'table-wrap' }, tabTarifas),
        h('p', { class: 'muted small' }, 'Margen por hora = máximo ingreso del grupo por hora − coste total por hora (según parámetros).')),
      h('div', { class: 'chart-row' },
        h('section', { class: 'card lista-card' }, h('h3', {}, 'Costes por hora'), h('div', { class: 'table-wrap' }, tabCostes),
          h('p', { class: 'muted small' }, `Horas al mes = horas semanales × 4 (${c.horasMes}). La columna real usa la media de los ${r.meses} meses con gastos del curso: material; local + seguros; gestoría + banco + franquicia.`)),
        h('section', { class: 'card lista-card' }, h('h3', {}, 'Parámetros'), tabParams,
          admin ? null : h('p', { class: 'muted small' }, 'Solo un administrador puede cambiarlos.'))));
  }
  pintar();
  return { kpis: null, nota: 'Hoja "Datos interes": ingreso por hora de cada grupo y coste por hora de la academia.', el: cont, csv: null, sinTarjeta: true };
}
