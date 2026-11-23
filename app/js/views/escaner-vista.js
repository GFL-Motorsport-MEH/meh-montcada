// Pestaña «Escáner»: escanear facturas y tickets y añadirlos como gasto.
// Es la única pestaña que ve el usuario con rol «escaner»; sus gastos quedan pendientes de revisar (amarillo en Gastos).
import { h, clear, toast, normalizar, fmtEUR2, fmtFecha, fmtFechaCorta, num, mesDeFecha, hoyISO, tituloCategoria, cargando } from '../ui.js';
import { crearGasto, crearGastos, getGastosPendientes, actualizarGasto, getListas, escanerEmpresas, agrupar } from '../db.js';
import { montarEscaner } from './escaner.js';
import { abrirGastoForm } from './gasto-form.js';
import { abrirFactura, bloqueFactura } from '../factura-archivo.js';

const leerImporte = (t) => {
  const s = String(t ?? '').replace(/\s|€/g, '');
  if (!s) return null;
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

export async function renderEscanerVista(view, ctx) {
  const { state } = ctx;
  const editor = ctx.puedeEditar();
  if (!state.listas) { try { state.listas = await getListas(); } catch { state.listas = []; } }
  const metodos = state.listas.filter((x) => x.lista === 'metodo_pago').map((x) => x.valor);
  const zonaEscaner = h('div', { class: 'escaner-cuerpo' });
  const zonaForm = h('div');
  const listaPend = h('div');
  // listado de empresas: se vincula el proveedor por nombre comercial, razón social o CIF
  let empresas = [];
  const cargaEmpresas = escanerEmpresas().then((l) => { empresas = l.map((e) => ({ ...e, _k: normalizar(`${e.nombre_comercial} ${e.razon_social || ''} ${e.cif || ''}`) })); }).catch(() => {});
  const buscarEmpresa = (t) => { const k = normalizar(t).trim(); return k ? empresas.find((e) => normalizar(e.nombre_comercial) === k || (e.razon_social && normalizar(e.razon_social) === k) || (e.cif && normalizar(e.cif).replace(/\W/g, '') === k.replace(/\W/g, ''))) : null; };
  // casilla con desplegable que filtra por cualquiera de los tres datos
  function comboEmpresa(input, alElegir) {
    const lista = h('ul', { class: 'combo-lista', role: 'listbox', hidden: true });
    const caja = h('div', { class: 'combo' }, input, lista);
    let activo = -1, items = [];
    const cerrar = () => { lista.hidden = true; activo = -1; };
    const elegir = (e) => { input.value = e.nombre_comercial; cerrar(); alElegir(e); };
    const pintar = () => {
      const k = normalizar(input.value).trim();
      items = (k ? empresas.filter((e) => k.split(/\s+/).every((w) => e._k.includes(w))) : empresas).slice(0, 12);
      lista.replaceChildren(...items.map((e, i) => h('li', { role: 'option', class: i === activo ? 'activo' : '', onmousedown: (ev) => { ev.preventDefault(); elegir(e); } },
        h('strong', {}, e.nombre_comercial), e.razon_social && normalizar(e.razon_social) !== normalizar(e.nombre_comercial) ? h('span', { class: 'muted small' }, ` · ${e.razon_social}`) : null, e.cif && e.cif.length <= 12 ? h('span', { class: 'muted small' }, ` · ${e.cif}`) : null)));
      lista.hidden = !items.length;
    };
    input.addEventListener('input', () => { activo = -1; pintar(); });
    input.addEventListener('focus', pintar);
    input.addEventListener('blur', () => setTimeout(cerrar, 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (lista.hidden) pintar(); activo = (activo + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(items.length, 1); pintar(); }
      else if (e.key === 'Enter' && !lista.hidden && activo >= 0) { e.preventDefault(); elegir(items[activo]); }
      else if (e.key === 'Escape') cerrar();
    });
    return caja;
  }

  const esc = { reiniciar: () => {} };
  function pintarEscaner() { Object.assign(esc, montarEscaner(zonaEscaner, ctx, { onDatos: formulario, textoBoton: 'Continuar', onVarios: guardarVarios })); }

  // nómina escaneada: se crean de una vez los gastos marcados (nómina, SS, IRPF)
  async function guardarVarios(lista) {
    try {
      await crearGastos(lista);
      ctx.invalidar(lista[0].curso_id);
      toast(`${lista.length} ${lista.length === 1 ? 'gasto creado' : 'gastos creados'} de la nómina${editor ? '' : ': quedan pendientes de revisar'}`);
      clear(zonaForm); esc.reiniciar(); pintarPendientes();
    } catch (ex) { toast('No se han guardado: ' + ex.message, 'error'); esc.reiniciar(); }
  }

  // ---------- formulario corto del gasto ----------
  function formulario(d = {}, info = {}) {
    const campo = (label, el, ancho = '') => h('label', { class: `field ${ancho}` }, h('span', {}, label), el);
    const fFecha = h('input', { type: 'date', value: d.fecha_factura || hoyISO(), required: true });
    const fEmp = h('input', { type: 'text', value: d.empresa || '', required: true, autocomplete: 'off', placeholder: 'Busca por nombre comercial, razón social o CIF' });
    const vinculo = h('span', { class: 'small muted' });
    let vinc = null;
    const fNum = h('input', { type: 'text', value: d.factura_nr || '', placeholder: 'Nº de factura o ticket' });
    const fImp = h('input', { type: 'text', inputmode: 'decimal', value: d.cantidad === '' || d.cantidad == null ? '' : String(d.cantidad).replace('.', ','), required: true, placeholder: '0,00' });
    const fConc = h('input', { type: 'text', value: d.concepto || '', placeholder: '¿Qué se ha comprado?' });
    const fCat = h('select', {}, h('option', { value: '' }, '— Sin clasificar —'), state.taxonomia.map((c) => h('option', { value: c.id, selected: c.id === d.categoria_id }, tituloCategoria(c.nombre))));
    const fSub = h('select', {});
    const pintarSub = () => { const c = state.taxonomia.find((x) => x.id === fCat.value); fSub.replaceChildren(h('option', { value: '' }, c ? 'Elige…' : '—'), ...(c ? c.subcategorias.map((s) => h('option', { value: s.id, selected: s.id === d.subcategoria_id }, s.nombre)) : [])); fSub.disabled = !c; };
    fCat.addEventListener('change', pintarSub); pintarSub();
    const fMet = h('select', {}, h('option', { value: '' }, '—'), [...new Set([...metodos, d.metodo_pago].filter(Boolean))].map((m) => h('option', { value: m, selected: m === d.metodo_pago }, m)));
    const fPago = h('select', {}, h('option', { value: 'True', selected: true }, 'Sí, ya está pagado'), h('option', { value: 'False' }, 'No, pendiente de pago'));
    const centros = state.centros.filter((c) => c.activo !== false);
    const fCen = centros.length > 1 ? h('select', {}, centros.map((c) => h('option', { value: c.id, selected: c.id === (d.centro_id || ctx.centroPrincipal()?.id) }, ctx.tituloCentro(c.nombre)))) : null;
    const fCom = h('textarea', { rows: 2, placeholder: 'Opcional' }, (d.comentarios || '').replace(/^Escaneada[^.]*\.\s*/, ''));
    const marcar = (e) => { vinc = e || null; vinculo.textContent = e ? `✓ Vinculado con el listado${e.razon_social && normalizar(e.razon_social) !== normalizar(e.nombre_comercial) ? ` · razón social: ${e.razon_social}` : ''}` : (fEmp.value.trim() ? 'No está en el listado de empresas: se guardará con este nombre.' : ''); };
    const cbEmp = comboEmpresa(fEmp, marcar);
    fEmp.addEventListener('change', () => { const e = buscarEmpresa(fEmp.value); if (e) fEmp.value = e.nombre_comercial; marcar(e); });
    cargaEmpresas.then(() => { const e = buscarEmpresa(fEmp.value); if (e) { fEmp.value = e.nombre_comercial; marcar(e); } else marcar(null); });

    const btnG = h('button', { class: 'btn primary', type: 'submit' }, 'Guardar gasto');
    const form = h('form', { class: 'card form-escaner', novalidate: true, onsubmit: guardar },
      h('h3', {}, info.file ? `Datos del gasto · ${info.file.name}` : 'Datos del gasto'),
      info.link ? null : h('div', { class: 'banner warn small' }, info.file ? 'La factura no se ha podido adjuntar.' : 'Gasto sin archivo adjunto.'),
      bloqueFactura(info),
      h('div', { class: 'form-grid-esc' },
        campo('Fecha factura', fFecha), campo('Proveedor', h('div', {}, cbEmp, vinculo), 'ancho2'), campo('Nº factura', fNum), campo('Importe (€)', fImp),
        campo('Concepto', fConc, 'ancho2'), campo('Categoría', fCat), campo('Subcategoría', fSub), campo('Método de pago', fMet), campo('¿Pagado?', fPago),
        fCen ? campo('Centro', fCen) : null, campo('Comentario', fCom, 'ancho3')),
      h('div', { class: 'escaner-acciones' },
        h('button', { class: 'btn', type: 'button', onclick: () => { clear(zonaForm); esc.reiniciar(); } }, 'Cancelar'),
        editor ? h('button', { class: 'btn', type: 'button', onclick: () => fichaCompleta() }, 'Abrir ficha completa') : null,
        btnG));
    clear(zonaForm, form);
    clear(zonaEscaner, h('div', { class: 'muted small' }, 'Revisa los datos y guarda. ', h('button', { class: 'link-btn', type: 'button', onclick: () => { clear(zonaForm); esc.reiniciar(); } }, 'Escanear otra')));
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => (fEmp.value ? fImp : fEmp).focus(), 50);

    function datos() {
      const fecha = fFecha.value;
      const curso = state.cursos.find((c) => c.fecha_inicio <= fecha && fecha <= c.fecha_fin) || ctx.cursoActual();
      const cat = state.taxonomia.find((c) => c.id === fCat.value);
      const sub = cat?.subcategorias.find((s) => s.id === fSub.value);
      return {
        ...d, fecha_factura: fecha, empresa: fEmp.value.trim(), nif: d.nif || (vinc?.cif && /^[A-Za-z0-9-]{8,12}$/.test(vinc.cif) ? vinc.cif : ''), iban: d.iban || vinc?.iban || '', factura_nr: fNum.value.trim() || null, cantidad: leerImporte(fImp.value),
        concepto: fConc.value.trim() || null, categoria_id: cat?.id || null, subcategoria_id: sub?.id || null,
        categoria_texto: cat ? tituloCategoria(cat.nombre) : null, subcategoria_texto: sub?.nombre || null,
        metodo_pago: fMet.value || null, pago: fPago.value, fecha_pago: fPago.value === 'True' ? fecha : null,
        centro_id: fCen ? fCen.value : (d.centro_id || ctx.centroPrincipal()?.id || null), comentarios: [fCom.value.trim(), d.comentarios && /OneDrive:/.test(d.comentarios) ? d.comentarios.replace(/^.*?(OneDrive:)/, '$1') : ''].filter(Boolean).join(' · ') || null,
        mes: mesDeFecha(fecha), curso_id: curso?.id, tipo: d.tipo || 'Factura', link_factura: d.link_factura || info.link || null, sin_factura: !(d.link_factura || info.link),
      };
    }
    function fichaCompleta() { const x = datos(); clear(zonaForm); esc.reiniciar(); abrirGastoForm({ gasto: null, ctx, inicial: x, escaneo: info, onGuardado: () => { ctx.invalidar(x.curso_id); pintarPendientes(); } }); }
    async function guardar(e) {
      e.preventDefault();
      const x = datos();
      const errores = [];
      if (!x.fecha_factura) errores.push('la fecha');
      if (!x.empresa) errores.push('el proveedor');
      if (x.cantidad === null || Number.isNaN(x.cantidad)) errores.push('el importe');
      if (errores.length) { toast(`Falta o no es válido: ${errores.join(', ')}`, 'error'); return; }
      if (!x.curso_id) { toast('No hay ningún curso para esa fecha.', 'error'); return; }
      delete x.division_id;
      btnG.disabled = true;
      try {
        await crearGasto(x);
        ctx.invalidar(x.curso_id);
        toast(editor ? 'Gasto guardado' : 'Gasto enviado: queda pendiente de revisar');
        clear(zonaForm); esc.reiniciar(); pintarPendientes();
      } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); btnG.disabled = false; }
    }
  }

  // ---------- pendientes de revisar ----------
  async function pintarPendientes() {
    clear(listaPend, cargando());
    let l = [];
    try { l = await getGastosPendientes(); } catch (ex) { clear(listaPend, h('div', { class: 'banner error' }, ex.message)); return; }
    const titulo = editor ? 'Pendientes de revisar' : 'Tus gastos pendientes de revisar';
    if (!l.length) { clear(listaPend, h('h3', { class: 'sub-titulo' }, titulo), h('p', { class: 'muted small' }, editor ? 'No hay gastos pendientes de revisar.' : 'No tienes gastos pendientes: el administrador ya los ha revisado todos.')); return; }
    const total = l.reduce((s, g) => s + num(g.cantidad), 0);
    clear(listaPend, h('h3', { class: 'sub-titulo' }, `${titulo} · ${l.length} · ${fmtEUR2(total)}`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data tabla-pendientes' },
        h('thead', {}, h('tr', {}, ['Fecha', 'Proveedor', 'Nº', 'Concepto', 'Categoría'].map((t) => h('th', { scope: 'col' }, t)), h('th', { class: 'num' }, 'Importe'), h('th', {}, 'Factura'), editor ? h('th', {}) : null)),
        h('tbody', {}, l.map((g) => h('tr', { class: 'pendiente-rev' },
          h('td', {}, fmtFechaCorta(g.fecha_factura)), h('td', {}, g.empresa || '—'), h('td', {}, g.factura_nr || '—'), h('td', {}, g.concepto || '—'),
          h('td', {}, [g.categoria_texto, g.subcategoria_texto].filter(Boolean).join(' › ') || h('span', { class: 'muted' }, 'sin clasificar')),
          h('td', { class: 'num' }, fmtEUR2(num(g.cantidad))),
          h('td', {}, g.link_factura ? h('button', { class: 'link-btn', type: 'button', onclick: () => abrirFactura(g.link_factura) }, 'Ver') : h('span', { class: 'muted' }, '—')),
          editor ? h('td', {}, h('button', { class: 'btn small', type: 'button', onclick: async (e) => {
            e.target.disabled = true;
            try { await actualizarGasto(g.id, { revisado: true }); ctx.invalidar(g.curso_id); toast('Marcado como revisado'); pintarPendientes(); ctx.actualizarPendientes?.(); } catch (ex) { toast(ex.message, 'error'); e.target.disabled = false; }
          } }, 'Revisado')) : null))))),
      editor ? h('div', { class: 'escaner-acciones' }, h('a', { class: 'btn', href: '#/gastos?pendientes' }, 'Ver en Gastos'),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          try { await agrupar(`Marcar ${l.length} gastos como revisados`, async () => { for (const g of l) await actualizarGasto(g.id, { revisado: true }); }); state.gastos.clear(); toast(`${l.length} gastos revisados`); pintarPendientes(); ctx.actualizarPendientes?.(); } catch (ex) { toast(ex.message, 'error'); }
        } }, 'Marcar todos como revisados')) : null);
  }

  clear(view,
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'Escáner de facturas y tickets'),
      h('div', { class: 'count' }, editor ? 'Escanea o haz una foto, revisa los datos y guarda el gasto.' : 'Escanea o haz una foto de la factura o el ticket, revisa los datos y guárdalo. El administrador lo revisará.')),
      h('div', { class: 'section-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => formulario({}, {}) }, 'Añadir sin archivo'))),
    h('div', { class: 'card' }, zonaEscaner),
    zonaForm,
    listaPend);
  pintarEscaner();
  pintarPendientes();
}
