// Pestaña Facturación: hoja "Fact Meharic" + macro de importación del CRM.
import { h, clear, fmtEUR2, fmtFecha, num, normalizar, cargando, descargarCSV, toast, confirmar, leerHojaArchivo } from '../ui.js';
import * as db from '../db.js';
import { filasCRMaRegistros, separarNuevas, huecosRecibos, resumenTrimestral, METODOS_FACT, esVerdadero } from '../facturacion.js';

const POR_PAGINA = 100;

export async function renderFacturacion(view, ctx) {
  clear(view, cargando());
  if (!ctx.state.facturacion) ctx.state.facturacion = await db.getFacturacion(); // no depende del curso: se carga una vez
  let lineas = ctx.state.facturacion;
  const curso = ctx.cursoActual();
  const f = { q: '', desde: curso.fecha_inicio || '', hasta: curso.fecha_fin || '', metodo: '', tipo: '', comp: '' };
  let limite = POR_PAGINA;

  const re = () => { limite = POR_PAGINA; pintar(); };
  const fQ = h('input', { type: 'search', placeholder: 'Buscar alumno, recibo, factura, descripción…', 'aria-label': 'Buscar', oninput: () => { f.q = fQ.value; re(); } });
  const fDesde = h('input', { type: 'date', value: f.desde, 'aria-label': 'Desde', onchange: () => { f.desde = fDesde.value; re(); } });
  const fHasta = h('input', { type: 'date', value: f.hasta, 'aria-label': 'Hasta', onchange: () => { f.hasta = fHasta.value; re(); } });
  const opciones = (campo) => [...new Set(lineas.map((l) => l[campo]).filter(Boolean))].sort();
  const fMet = h('select', { 'aria-label': 'Método de pago', onchange: () => { f.metodo = fMet.value; re(); } },
    h('option', { value: '' }, 'Todos los métodos'), opciones('metodo_pago').map((m) => h('option', { value: m }, m)));
  const fTipo = h('select', { 'aria-label': 'Tipo de operación', onchange: () => { f.tipo = fTipo.value; re(); } },
    h('option', { value: '' }, 'Todas las operaciones'), opciones('tipo_operacion').map((m) => h('option', { value: m }, m)));
  const fComp = h('select', { 'aria-label': 'Comprobación', onchange: () => { f.comp = fComp.value; re(); } },
    h('option', { value: '' }, 'Cualquier comprobación'), h('option', { value: 'sin_mimag' }, 'Sin comprobar MIMAG'),
    h('option', { value: 'sin_fiscontal' }, 'Sin contabilizar FISCONTAL'), h('option', { value: 'hueco' }, 'Recibos tras un hueco'));

  const contador = h('div', { class: 'count' });
  const kpis = h('div', { class: 'kpi-row kpi-4' });
  const resumenEl = h('div');
  const huecosEl = h('div');
  const tbody = h('tbody');
  const pie = h('div', { class: 'table-foot' });
  let huecos = huecosRecibos(lineas);
  let recibosTrasHueco = new Set(huecos.huecos.map((x) => x.prefijo + x.antes));

  function filtradas() {
    const q = normalizar(f.q.trim());
    return lineas.filter((l) => {
      if (f.desde && (!l.fecha_pago || l.fecha_pago < f.desde)) return false;
      if (f.hasta && (!l.fecha_pago || l.fecha_pago > f.hasta)) return false;
      if (f.metodo && l.metodo_pago !== f.metodo) return false;
      if (f.tipo && l.tipo_operacion !== f.tipo) return false;
      if (f.comp === 'sin_mimag' && esVerdadero(l.mimag_comprobacion)) return false;
      if (f.comp === 'sin_fiscontal' && esVerdadero(l.fiscontal_comprobacion)) return false;
      if (f.comp === 'hueco' && !recibosTrasHueco.has(String(l.num_recibo || '').replace(/^(.*?)0*(\d+)$/, (m, p, n) => p + Number(n)))) return false;
      if (q && !normalizar(`${l.alumno} ${l.num_recibo} ${l.num_factura} ${l.descripcion} ${l.id_crm}`).includes(q)) return false;
      return true;
    });
  }

  async function marcar(l, campo, input) {
    const valor = input.checked ? 'True' : 'False';
    input.disabled = true;
    try { Object.assign(l, await db.actualizarFacturacion(l.id, { [campo]: valor })); pintarResumen(filtradas()); }
    catch (ex) { input.checked = !input.checked; toast('No se ha guardado: ' + ex.message, 'error'); }
    finally { input.disabled = false; }
  }
  const casilla = (l, campo, label) => h('input', { type: 'checkbox', checked: esVerdadero(l[campo]), 'aria-label': `${label} · ${l.num_recibo || ''} ${l.alumno || ''}`, onchange: (e) => marcar(l, campo, e.target) });

  function fila(l) {
    return h('tr', {},
      h('td', { class: 'mono' }, fmtFecha(l.fecha_pago)),
      h('td', {}, l.alumno || '—', h('span', { class: 'line2' }, [l.id_crm ? `ID ${l.id_crm}` : null, l.tipo_operacion !== 'CREACION' ? l.tipo_operacion : null].filter(Boolean).join(' · '))),
      h('td', { class: 'mono' }, l.num_recibo || '—', h('span', { class: 'line2' }, l.num_factura && l.num_factura !== 'n/a' ? `Fact. ${l.num_factura}` : '')),
      h('td', {}, l.descripcion || '—', h('span', { class: 'line2' }, [l.modalidad_pago, num(l.qty) !== 1 ? `${num(l.qty)} uds` : null].filter(Boolean).join(' · '))),
      h('td', {}, l.metodo_pago || '—'),
      h('td', { class: 'num' }, fmtEUR2(num(l.cantidad))),
      h('td', { class: 'center' }, casilla(l, 'mimag_comprobacion', 'MIMAG')),
      h('td', { class: 'center' }, casilla(l, 'fiscontal_comprobacion', 'FISCONTAL')));
  }

  function pintarResumen(lista) {
    const total = lista.reduce((s, l) => s + num(l.cantidad), 0);
    const recibos = new Set(lista.map((l) => l.num_recibo).filter(Boolean)).size;
    const sinMimag = lista.filter((l) => !esVerdadero(l.mimag_comprobacion)).length;
    clear(kpis, [['Facturado', fmtEUR2(total)], ['Líneas', String(lista.length)], ['Recibos', String(recibos)], ['Sin comprobar MIMAG', String(sinMimag)]]
      .map(([k, v]) => h('div', { class: 'card kpi' }, h('div', { class: 'label' }, k), h('div', { class: 'value' }, v))));
    const tri = resumenTrimestral(lista);
    clear(resumenEl, h('div', { class: 'table-wrap' }, h('table', { class: 'data resumen-trimestral' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Trimestre'), h('th', { scope: 'col', class: 'num' }, 'Facturado'),
        METODOS_FACT.map((m) => h('th', { scope: 'col', class: 'num' }, m)), h('th', { scope: 'col', class: 'num' }, 'Otros'), h('th', { scope: 'col', class: 'num' }, 'Líneas'))),
      h('tbody', {}, tri.length ? tri.map((t) => h('tr', {}, h('th', { scope: 'row' }, t.trimestre), h('td', { class: 'num' }, fmtEUR2(t.total)),
        METODOS_FACT.map((m) => h('td', { class: 'num' }, fmtEUR2(t.metodos[m]))), h('td', { class: 'num' }, t.otros ? fmtEUR2(t.otros) : '—'), h('td', { class: 'num' }, String(t.lineas))))
        : h('tr', {}, h('td', { colspan: 8, class: 'empty' }, 'Sin líneas en el periodo.'))))));
  }

  function pintarHuecos() {
    const n = huecos.huecos.length;
    clear(huecosEl, h('details', { class: 'card huecos' },
      h('summary', {}, h('strong', {}, n ? `${n} saltos en la numeración de recibos` : 'Numeración de recibos correlativa'),
        h('span', { class: 'muted' }, ` · series: ${huecos.series.map((s) => `${s.prefijo}${s.min}–${s.max} (${s.n})`).join(', ')}`)),
      n ? h('ul', { class: 'lista-huecos' }, huecos.huecos.map((x) => h('li', {}, `${x.prefijo}: falta${x.faltan > 1 ? 'n' : ''} ${x.faltan > 1 ? `${x.prefijo}${x.despues + 1} a ${x.prefijo}${x.antes - 1} (${x.faltan})` : `${x.prefijo}${x.despues + 1}`}`))) : null));
  }

  function pintar() {
    const lista = filtradas();
    const orden = [...lista].sort((a, b) => (b.fecha_pago || '').localeCompare(a.fecha_pago || '') || String(b.num_recibo).localeCompare(String(a.num_recibo), 'es', { numeric: true }));
    contador.textContent = `${lista.length} de ${lineas.length} líneas`;
    pintarResumen(lista);
    clear(tbody, orden.length ? orden.slice(0, limite).map(fila) : h('tr', {}, h('td', { colspan: 8, class: 'empty' }, 'Ninguna línea coincide con los filtros.')));
    clear(pie, h('span', {}, lista.length > limite ? `Mostrando ${limite} de ${lista.length}` : `${lista.length} líneas`),
      lista.length > limite ? h('button', { class: 'btn', onclick: () => { limite += POR_PAGINA * 3; pintar(); } }, 'Mostrar más') : null);
  }

  function exportar() {
    const cols = ['fecha_pago', 'alumno', 'id_crm', 'tipo_operacion', 'num_factura', 'num_recibo', 'metodo_pago', 'modalidad_pago', 'descripcion', 'qty', 'cantidad', 'iva', 'importe', 'total', 'mimag_comprobacion', 'fiscontal_comprobacion'];
    descargarCSV('facturacion.csv', [cols, ...filtradas().map((l) => cols.map((c) => {
      if (['qty', 'cantidad', 'iva', 'importe', 'total'].includes(c)) return l[c] == null ? '' : num(l[c]).toFixed(2).replace('.', ',');
      if (c === 'fecha_pago') return fmtFecha(l[c]);
      if (c.endsWith('comprobacion')) return esVerdadero(l[c]) ? 'Sí' : 'No';
      return l[c] ?? '';
    }))]);
  }

  const archivo = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', hidden: true, 'aria-label': 'Archivo del CRM', onchange: () => importar(archivo.files[0]) });
  async function importar(file) {
    archivo.value = '';
    if (!file) return;
    let filas;
    try { filas = await leerHojaArchivo(file); } catch (ex) { toast('No se ha podido leer el archivo: ' + ex.message, 'error'); return; }
    const cab = (filas[0] || []).map((c) => normalizar(String(c ?? '')));
    if (!cab.some((c) => c.includes('recibo')) || filas.length < 2) { toast('El archivo no parece una exportación del CRM (falta la columna del número de recibo).', 'error'); return; }
    const { registros, errores } = filasCRMaRegistros(filas.slice(1));
    const { nuevas, duplicadas } = separarNuevas(registros, lineas);
    const total = nuevas.reduce((s, r) => s + num(r.cantidad), 0);
    if (!nuevas.length) { toast(`No hay líneas nuevas: las ${duplicadas} del archivo ya estaban importadas.`); return; }
    const ok = await confirmar({
      titulo: 'Importar facturación del CRM',
      texto: h('div', {}, h('p', {}, `${file.name}: ${registros.length} líneas leídas.`),
        h('ul', {}, h('li', {}, h('strong', {}, `${nuevas.length} nuevas`), ` (${fmtEUR2(total)})`), h('li', {}, `${duplicadas} ya importadas: se omiten`),
          errores.length ? h('li', { class: 'critical' }, `${errores.length} con fecha no reconocida: ${errores.slice(0, 3).join('; ')}${errores.length > 3 ? '…' : ''}`) : null)),
      ok: `Importar ${nuevas.length} líneas`,
    });
    if (!ok) return;
    try {
      const insertadas = await db.insertarFacturacion(nuevas);
      ctx.state.facturacion = lineas = [...insertadas, ...lineas];
      huecos = huecosRecibos(lineas); recibosTrasHueco = new Set(huecos.huecos.map((x) => x.prefijo + x.antes));
      pintarHuecos(); pintar();
      toast(`Importadas ${insertadas.length} líneas nuevas. Saltos en la numeración: ${huecos.huecos.length}.`);
    } catch (ex) { toast('Error al importar: ' + ex.message, 'error'); }
  }

  clear(view,
    h('div', { class: 'section-head' },
      h('div', {}, h('h2', {}, 'Facturación'), contador),
      h('div', { class: 'section-actions' }, archivo,
        h('button', { class: 'btn', onclick: exportar }, 'Exportar CSV'),
        h('button', { class: 'btn primary', onclick: () => archivo.click() }, 'Importar CRM'))),
    kpis,
    h('div', { class: 'filters filters-fact' }, h('div', { class: 'search' }, fQ), fDesde, fHasta, fMet, fTipo, fComp),
    h('h3', { class: 'sub-titulo' }, 'Resumen por trimestre (fecha de pago)'), resumenEl,
    huecosEl,
    h('div', { class: 'table-wrap' }, h('table', { class: 'data tabla-fact' },
      h('thead', {}, h('tr', {}, ['Fecha pago', 'Alumno', 'Recibo', 'Descripción', 'Método'].map((t) => h('th', { scope: 'col' }, t)),
        h('th', { scope: 'col', class: 'num' }, 'Cantidad'), h('th', { scope: 'col', class: 'center', title: 'Comprobada' }, 'MIMAG'), h('th', { scope: 'col', class: 'center', title: 'Contabilizada' }, 'FISCONTAL'))),
      tbody)),
    pie);
  pintarHuecos();
  pintar();
}
