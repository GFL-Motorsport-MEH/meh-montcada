// Formulario lateral para crear / editar un gasto.
import { h, toast, confirmar, MESES, capitalizar, mesDeFecha, hoyISO, tituloCategoria, fmtEUR2 } from '../ui.js';
import { crearGasto, crearGastos, actualizarGasto, borrarGasto } from '../db.js';
import { dividirEnMeses, dividirEnCentros } from '../gastos-ops.js';

const esVerdad = (v) => /^(true|1|x|verdadero)$/i.test(String(v ?? '').trim());

function datalist(id, valores) {
  return h('datalist', { id }, valores.map((v) => h('option', { value: v })));
}

export function abrirGastoForm({ gasto, ctx, onGuardado, onBorrado, onDividido, inicial }) {
  const { state } = ctx;
  const nuevo = !gasto;
  const g = gasto || {
    curso_id: ctx.cursoActual().id, fecha_factura: hoyISO(), pago: 'True', fiscontal: 'False',
    check_banca: false, sin_factura: false, centro_id: ctx.centroActual()?.id || ctx.centroPrincipal()?.id || null,
    ...(inicial || {}),
  };
  const sug = state.sugerencias || { tipo: [], empresa: [], periodicidad: [], metodo_pago: [] };
  // valores de las listas editables (Configuración > Listas) primero; si aún no han cargado, los más usados
  const deLista = (lista, def) => { const v = (state.listas || []).filter((x) => x.lista === lista).map((x) => x.valor); return v.length ? v : def; };
  let mesTocado = !nuevo && !!g.mes;
  let cursoTocado = !nuevo;
  let sucio = false;

  const campo = (label, input, { req = false, full = false, ayuda } = {}) => {
    const err = h('span', { class: 'field-error', hidden: true });
    input.addEventListener('input', () => { sucio = true; input.classList.remove('invalid'); err.hidden = true; });
    const el = h('label', { class: 'field' + (full ? ' full' : '') }, h('span', {}, label, req ? h('span', { class: 'req' }, ' *') : null), input, ayuda ? h('span', { class: 'small muted', style: 'font-weight:400' }, ayuda) : null, err);
    el._error = (msg) => { input.classList.add('invalid'); err.textContent = msg; err.hidden = false; };
    return el;
  };
  const txt = (name, value, extra = {}) => h('input', { type: 'text', name, value: value ?? '', ...extra });

  // --- controles ---
  const cursosVisibles = state.cursosVisibles;
  const fCurso = h('select', { name: 'curso_id', onchange: () => { cursoTocado = true; } },
    cursosVisibles.map((c) => h('option', { value: c.id, selected: c.id === g.curso_id }, c.nombre)));
  const centrosActivos = state.centros.filter((c) => c.activo !== false || c.id === g.centro_id);
  const fCentro = h('select', { name: 'centro_id' }, centrosActivos.map((c) => h('option', { value: c.id, selected: c.id === (g.centro_id || ctx.centroPrincipal()?.id) }, ctx.tituloCentro(c.nombre))));
  const fMes = h('select', { name: 'mes', onchange: () => { mesTocado = true; } },
    MESES.map((m) => h('option', { value: m }, capitalizar(m))));
  const fFechaFactura = h('input', { type: 'date', name: 'fecha_factura', value: g.fecha_factura || '' });
  const fFechaPago = h('input', { type: 'date', name: 'fecha_pago', value: g.fecha_pago || '' });
  const fTipo = txt('tipo', g.tipo, { list: 'dl-tipo' });
  const fEmpresa = txt('empresa', g.empresa, { list: 'dl-empresa', autocomplete: 'off' });
  const fFactura = txt('factura_nr', g.factura_nr);
  const fConcepto = txt('concepto', g.concepto);
  const fCantidad = h('input', { type: 'number', name: 'cantidad', step: '0.01', inputmode: 'decimal', value: g.cantidad ?? '' });
  const fCategoria = h('select', { name: 'categoria_id' },
    h('option', { value: '' }, 'Elige categoría…'),
    state.taxonomia.map((c) => h('option', { value: c.id, selected: c.id === g.categoria_id }, tituloCategoria(c.nombre))));
  const fSub = h('select', { name: 'subcategoria_id' });
  const fPeriodicidad = txt('periodicidad', g.periodicidad, { list: 'dl-periodicidad' });
  const fMetodo = txt('metodo_pago', g.metodo_pago, { list: 'dl-metodo' });
  const fLink = txt('link_factura', g.link_factura, { placeholder: 'Enlace de Drive o nombre del PDF' });
  const fNif = txt('nif', g.nif);
  const fIban = txt('iban', g.iban);
  // al elegir una empresa de la lista se rellenan su CIF e IBAN (si están vacíos)
  fEmpresa.addEventListener('change', () => {
    const e = (state.empresas || []).find((x) => x.nombre_comercial.toLowerCase() === fEmpresa.value.trim().toLowerCase());
    if (!e) return;
    if (e.cif && (!fNif.value.trim() || fNif.value.trim() === '0')) fNif.value = e.cif;
    if (e.iban && (!fIban.value.trim() || fIban.value.trim() === '0')) fIban.value = e.iban;
  });
  const fSwift = txt('swift', g.swift);
  const fComentarios = h('textarea', { name: 'comentarios' }, g.comentarios || '');
  const cPago = h('input', { type: 'checkbox', checked: esVerdad(g.pago) });
  const cBanca = h('input', { type: 'checkbox', checked: !!g.check_banca });
  const cSinFactura = h('input', { type: 'checkbox', checked: !!g.sin_factura });
  const cFiscontal = h('input', { type: 'checkbox', checked: esVerdad(g.fiscontal) });

  function pintarSubs() {
    const cat = state.taxonomia.find((c) => c.id === fCategoria.value);
    fSub.replaceChildren(h('option', { value: '' }, cat ? 'Elige subcategoría…' : 'Primero elige categoría'),
      ...(cat ? cat.subcategorias.map((s) => h('option', { value: s.id, selected: s.id === g.subcategoria_id }, s.nombre)) : []));
    fSub.disabled = !cat;
  }
  fCategoria.addEventListener('change', () => { g.subcategoria_id = null; pintarSubs(); });
  pintarSubs();

  function mesAuto() {
    if (!mesTocado) fMes.value = mesDeFecha(fFechaPago.value || fFechaFactura.value) || fMes.value;
  }
  function cursoAuto() {
    if (cursoTocado || !fFechaFactura.value) return;
    const c = cursosVisibles.find((c) => c.fecha_inicio <= fFechaFactura.value && fFechaFactura.value <= c.fecha_fin);
    if (c) fCurso.value = c.id;
  }
  fMes.value = g.mes || mesDeFecha(g.fecha_pago || g.fecha_factura) || 'septiembre';
  fFechaFactura.addEventListener('change', () => { mesAuto(); cursoAuto(); });
  fFechaPago.addEventListener('change', mesAuto);

  // --- campos con validación ---
  const lFecha = campo('Fecha factura', fFechaFactura, { req: true });
  const lEmpresa = campo('Empresa / proveedor', fEmpresa, { req: true });
  const lConcepto = campo('Concepto', fConcepto, { req: true, full: true });
  const lCantidad = campo('Importe (€)', fCantidad, { req: true });
  const lCategoria = campo('Categoría', fCategoria, { req: true });
  const lSub = campo('Subcategoría', fSub, { req: true });

  const btnGuardar = h('button', { class: 'btn primary', type: 'submit' }, nuevo ? 'Guardar gasto' : 'Guardar cambios');
  const btnBorrar = !nuevo && ctx.esAdmin() ? h('button', { class: 'btn danger', type: 'button', onclick: borrar }, 'Borrar') : null;
  const errGeneral = h('div', { class: 'banner error', role: 'alert', hidden: true });

  const form = h('form', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gf-t', onsubmit: guardar, novalidate: true },
    h('div', { class: 'drawer-head' },
      h('h2', { id: 'gf-t' }, nuevo ? 'Nuevo gasto' : 'Editar gasto'),
      h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Cerrar', onclick: () => cerrar() }, '✕')),
    h('div', { class: 'drawer-body' },
      errGeneral,
      h('div', { class: 'form-section' },
        h('h3', {}, 'Gasto'),
        lFecha, campo('Fecha pago', fFechaPago),
        lEmpresa, campo('Nº factura', fFactura),
        lConcepto,
        lCantidad, campo('Tipo', fTipo, { ayuda: 'Factura, Recibo, Nomina…' }),
        campo('Curso', fCurso), campo('Mes al que se imputa', fMes, { ayuda: 'Se rellena solo con la fecha de pago; cámbialo si toca otro mes.' }),
        state.centros.length > 1 ? campo('Centro', fCentro) : null),
      h('div', { class: 'form-section' },
        h('h3', {}, 'Clasificación'),
        lCategoria, lSub,
        campo('Periodicidad', fPeriodicidad), campo('Método de pago', fMetodo)),
      h('div', { class: 'form-section' },
        h('h3', {}, 'Control'),
        h('div', { class: 'checks full' },
          h('label', { class: 'check' }, cPago, 'Pagado'),
          h('label', { class: 'check' }, cBanca, 'Comprobado en el banco'),
          h('label', { class: 'check' }, cSinFactura, 'Sin factura'),
          h('label', { class: 'check' }, cFiscontal, 'Enviado a FISCONTAL')),
        campo('Factura (enlace o archivo)', fLink, { full: true }),
        campo('NIF', fNif), campo('IBAN', fIban), campo('SWIFT', fSwift),
        campo('Comentarios', fComentarios, { full: true })),
      datalist('dl-tipo', deLista('tipo', sug.tipo)), datalist('dl-empresa', [...new Set([...sug.empresa, ...(state.empresas || []).map((e) => e.nombre_comercial)])]),
      datalist('dl-periodicidad', deLista('periodicidad', sug.periodicidad)), datalist('dl-metodo', deLista('metodo_pago', sug.metodo_pago))),
    h('div', { class: 'drawer-foot' },
      h('div', { style: 'display:flex; gap:8px; flex-wrap:wrap' }, btnBorrar,
        nuevo ? null : h('button', { class: 'btn', type: 'button', onclick: () => dividir('meses') }, 'Dividir entre meses'),
        nuevo || state.centros.filter((c) => c.activo !== false).length < 2 ? null : h('button', { class: 'btn', type: 'button', onclick: () => dividir('centros') }, 'Dividir entre centros')),
      h('div', { style: 'display:flex; gap:8px' },
        h('button', { class: 'btn', type: 'button', onclick: () => cerrar() }, 'Cancelar'), btnGuardar)));

  form.addEventListener('change', () => { sucio = true; });
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) cerrar(); } }, form);
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.dialog')) cerrar(); };
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  document.body.style.overflow = 'hidden';
  (nuevo ? fFechaFactura : fConcepto).focus();

  async function cerrar(forzar = false) {
    if (!forzar && sucio && !(await confirmar({ titulo: 'Descartar cambios', texto: 'Tienes cambios sin guardar. ¿Cerrar igualmente?', ok: 'Descartar', peligro: true }))) return;
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    overlay.remove();
  }

  const limpio = (v) => { const s = (v ?? '').trim(); return s === '' ? null : s; };

  async function guardar(e) {
    e.preventDefault();
    errGeneral.hidden = true;
    let ok = true;
    const fallo = (l, msg) => { l._error(msg); ok = false; };
    if (!fFechaFactura.value) fallo(lFecha, 'Pon la fecha de la factura.');
    if (!limpio(fEmpresa.value)) fallo(lEmpresa, 'Indica la empresa o proveedor.');
    if (!limpio(fConcepto.value)) fallo(lConcepto, 'Describe el gasto.');
    const cantidad = Number(String(fCantidad.value).replace(',', '.'));
    if (fCantidad.value === '' || !Number.isFinite(cantidad)) fallo(lCantidad, 'Pon un importe válido.');
    else if (Math.abs(cantidad) >= 1e10) fallo(lCantidad, 'Importe demasiado grande.');
    if (!fCategoria.value) fallo(lCategoria, 'Elige una categoría.');
    if (!fSub.value) fallo(lSub, 'Elige una subcategoría.');
    if (!ok) { form.querySelector('.invalid')?.focus(); return; }

    const cat = state.taxonomia.find((c) => c.id === fCategoria.value);
    const sub = cat.subcategorias.find((s) => s.id === fSub.value);
    const datos = {
      curso_id: fCurso.value, mes: fMes.value, ...(state.centros.length ? { centro_id: fCentro.value || null } : {}),
      fecha_factura: fFechaFactura.value || null, fecha_pago: fFechaPago.value || null,
      tipo: limpio(fTipo.value), empresa: limpio(fEmpresa.value), factura_nr: limpio(fFactura.value),
      concepto: limpio(fConcepto.value), cantidad: Math.round(cantidad * 100) / 100,
      categoria_id: cat.id, subcategoria_id: sub.id,
      categoria_texto: tituloCategoria(cat.nombre), subcategoria_texto: sub.nombre,
      periodicidad: limpio(fPeriodicidad.value), metodo_pago: limpio(fMetodo.value),
      link_factura: limpio(fLink.value), nif: limpio(fNif.value), iban: limpio(fIban.value), swift: limpio(fSwift.value),
      comentarios: limpio(fComentarios.value),
      pago: cPago.checked ? 'True' : 'False', fiscontal: cFiscontal.checked ? 'True' : 'False',
      check_banca: cBanca.checked, sin_factura: cSinFactura.checked,
    };
    btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando…';
    try {
      const guardado = nuevo ? await crearGasto(datos) : await actualizarGasto(g.id, datos);
      toast(nuevo ? 'Gasto guardado' : 'Cambios guardados');
      await cerrar(true);
      onGuardado(guardado, g);
    } catch (ex) {
      errGeneral.textContent = 'No se ha podido guardar: ' + ex.message;
      errGeneral.hidden = false;
      btnGuardar.disabled = false; btnGuardar.textContent = nuevo ? 'Guardar gasto' : 'Guardar cambios';
    }
  }

  // ---- dividir un gasto guardado entre varios meses o centros ----
  async function dividir(modo) {
    if (sucio) { toast('Guarda primero los cambios del gasto.', 'error'); return; }
    let cuerpo, leer;
    if (modo === 'meses') {
      const checks = MESES.map((m) => h('input', { type: 'checkbox', value: m, checked: m === g.mes }));
      cuerpo = h('div', {}, h('p', {}, `Se repartirán ${fmtEUR2(g.cantidad)} a partes iguales entre los meses que elijas (el gasto actual pasa a ser la primera parte).`),
        h('div', { class: 'grid-checks' }, MESES.map((m, i) => h('label', { class: 'check small' }, checks[i], capitalizar(m)))));
      leer = () => checks.filter((c) => c.checked).map((c) => c.value);
    } else {
      const activos = state.centros.filter((c) => c.activo !== false);
      const filas = activos.map((c) => ({ c, chk: h('input', { type: 'checkbox', checked: true }), pct: h('input', { type: 'number', min: 0, max: 100, step: 'any', value: Math.round(10000 / activos.length) / 100, class: 'input-corto', 'aria-label': `% para ${c.nombre}` }) }));
      cuerpo = h('div', {}, h('p', {}, `Se repartirán ${fmtEUR2(g.cantidad)} entre los centros marcados según el porcentaje.`),
        h('div', { class: 'reparto-centros' }, filas.map((f) => h('label', { class: 'check small' }, f.chk, ctx.tituloCentro(f.c.nombre), f.pct, '%'))));
      leer = () => filas.filter((f) => f.chk.checked && Number(f.pct.value) > 0).map((f) => ({ centro_id: f.c.id, peso: Number(f.pct.value) }));
    }
    const ok = await confirmar({ titulo: modo === 'meses' ? 'Dividir entre meses' : 'Dividir entre centros', texto: cuerpo, ok: 'Dividir' });
    if (!ok) return;
    const sel = leer();
    if (sel.length < 2) { toast(modo === 'meses' ? 'Elige al menos dos meses.' : 'Elige al menos dos centros con porcentaje.', 'error'); return; }
    const nombre = (id) => ctx.tituloCentro(state.centros.find((c) => c.id === id)?.nombre || '');
    const { original, nuevos } = modo === 'meses' ? dividirEnMeses(g, sel) : dividirEnCentros(g, sel, nombre);
    try {
      const actualizado = await actualizarGasto(g.id, original);
      const creados = await crearGastos(nuevos);
      toast(`Gasto dividido en ${creados.length + 1} partes`);
      await cerrar(true);
      (onDividido || (() => {}))(actualizado, creados, g);
    } catch (ex) { toast('No se ha podido dividir: ' + ex.message, 'error'); }
  }

  async function borrar() {
    const okBorrar = await confirmar({
      titulo: 'Borrar gasto',
      texto: `Se borrará "${g.concepto || ''}" de ${g.empresa || ''} (${fmtEUR2(g.cantidad)}). No se puede deshacer.`,
      ok: 'Borrar', peligro: true,
    });
    if (!okBorrar) return;
    try {
      await borrarGasto(g.id);
      toast('Gasto borrado');
      await cerrar(true);
      onBorrado(g);
    } catch (ex) { toast(ex.message, 'error'); }
  }
}
