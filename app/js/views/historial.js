// Configuración > Historial y copias (solo admin): todos los cambios de datos con su valor anterior,
// botón para restaurar un cambio y descarga de una copia de seguridad completa.
import { h, clear, cargando, toast, confirmar, normalizar, hoyISO } from '../ui.js';
import * as db from '../db.js';
import { vista, filtroFecha, rangoFecha, describirFecha, crearAviso, vincular, FECHA_VACIA } from '../vista.js';
import { registrarSeccionConfig } from './config.js';
import { crearZip, crearXlsx, descargarBlob } from '../zip.js';

const TABLAS = [['gastos', 'Gastos'], ['facturacion', 'Facturación'], ['ingresos', 'Ingresos'], ['ingresos_metodo', 'Ingresos por método'], ['alumnos_mes', 'Alumnos por mes'],
  ['empresas', 'Empresas'], ['plantillas_gasto', 'Plantillas'], ['movimientos_banco', 'Movimientos banco'], ['cuentas_bancarias', 'Cuentas'], ['extractos', 'Extractos'],
  ['gestoria_envios', 'Envíos gestoría'], ['gestoria_notas', 'Notas gestoría'], ['notas', 'Notas'], ['factcheck_manual', 'FactCheck'], ['categorias', 'Categorías'],
  ['subcategorias', 'Subcategorías'], ['listas', 'Listas'], ['parametros', 'Parámetros'], ['tarifas', 'Tarifas'], ['centros', 'Centros'], ['cursos', 'Cursos'], ['profiles', 'Usuarios']];
const ACCION = { INSERT: 'Alta', UPDATE: 'Cambio', DELETE: 'Borrado' };
const OCULTOS = new Set(['id', 'created_at', 'created_by', 'updated_at', 'updated_by']);
const corto = (v) => { if (v === null || v === undefined || v === '') return '—'; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return s.length > 60 ? s.slice(0, 57) + '…' : s; };
// Qué registro es, en palabras (empresa + concepto para un gasto, etc.)
function describir(r) {
  const x = { ...(r.antes || {}), ...(r.despues || {}) };
  return [x.empresa, x.concepto, x.alumno, x.num_factura, x.nombre, x.nombre_comercial, x.valor, x.texto, x.mes, x.periodo, x.fecha_factura || x.fecha].filter(Boolean).slice(0, 3).join(' · ') || r.registro_id || '';
}

async function renderHistorial(cont, ctx) {
  if (!ctx.esAdmin()) { clear(cont, h('div', { class: 'card empty' }, 'Solo para administradores.')); return; }
  clear(cont, cargando());
  const perfiles = await db.getPerfiles().catch(() => []);
  const nombreUsuario = (id) => (id ? perfiles.find((p) => p.id === id)?.nombre || perfiles.find((p) => p.id === id)?.email || 'usuario' : 'sistema / importación');
  const f = vista('historial.f', { tabla: '', fecha: { ...FECHA_VACIA }, q: '' });
  let filas = [];
  const fTabla = h('select', { 'aria-label': 'Tabla', onchange: () => { f.tabla = fTabla.value; cargar(); } }, h('option', { value: '' }, 'Todo'), TABLAS.map(([t, n]) => h('option', { value: t }, n)));
  const fFecha = filtroFecha(f.fecha, (d) => { f.fecha = d; cargar(); }, { etiqueta: 'Fecha del cambio' });
  const fQ = h('input', { type: 'search', placeholder: 'Buscar (empresa, importe, usuario…)', 'aria-label': 'Buscar en el historial', oninput: () => { f.q = fQ.value; pintar(); } });
  const tbody = h('tbody');
  vincular(f, 'tabla', fTabla); vincular(f, 'q', fQ); vincular(f, 'fecha', fFecha);
  const aviso = crearAviso({
    obtener: () => [['Tabla', f.tabla ? TABLAS.find(([t]) => t === f.tabla)?.[1] || f.tabla : ''], ['Fecha', describirFecha(f.fecha)], ['Búsqueda', f.q.trim() ? `«${f.q.trim()}»` : '']],
    limpiar: () => { f.tabla = ''; f.fecha = { ...FECHA_VACIA }; f.q = ''; cargar(); },
  });
  const contador = h('div', { class: 'count' });

  async function cargar() {
    clear(tbody, h('tr', {}, h('td', { colspan: 6 }, cargando())));
    try { filas = await db.getAuditoria({ tabla: f.tabla, desde: rangoFecha(f.fecha).desde, hasta: rangoFecha(f.fecha).hasta ? `${rangoFecha(f.fecha).hasta}T23:59:59` : '' }); }
    catch (ex) { clear(tbody, h('tr', {}, h('td', { colspan: 6, class: 'empty' }, 'No se ha podido cargar el historial: ' + ex.message))); return; }
    pintar();
  }
  function pintar() {
    aviso.actualizar();
    const q = normalizar(f.q.trim());
    const vis = filas.filter((r) => !q || normalizar(`${describir(r)} ${nombreUsuario(r.usuario)} ${JSON.stringify(r.antes || '')} ${JSON.stringify(r.despues || '')}`).includes(q));
    contador.textContent = `${vis.length} cambios${filas.length >= 500 ? ' (los 500 más recientes: filtra por fechas o tabla para ver más antiguos)' : ''}`;
    clear(tbody, vis.length ? vis.map((r) => {
      const campos = r.accion === 'UPDATE' ? Object.keys(r.despues || {}).filter((k) => !OCULTOS.has(k)) : [];
      return h('tr', {},
        h('td', { class: 'mono' }, new Date(r.at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })),
        h('td', {}, nombreUsuario(r.usuario)),
        h('td', {}, TABLAS.find(([t]) => t === r.tabla)?.[1] || r.tabla, h('span', { class: 'line2' }, ACCION[r.accion] + (r.restaurado_de ? ` (restauración del cambio ${r.restaurado_de})` : ''))),
        h('td', {}, describir(r)),
        h('td', {}, r.accion === 'UPDATE'
          ? h('div', { class: 'cambio' }, campos.map((k) => h('div', {}, h('strong', {}, k), ': ', h('span', { class: 'antes' }, corto(r.antes?.[k])), ' → ', h('span', { class: 'despues' }, corto(r.despues?.[k])))))
          : h('span', { class: 'muted small' }, r.accion === 'DELETE' ? 'Registro borrado (se puede recuperar)' : 'Registro creado')),
        h('td', {}, r.accion === 'INSERT' ? null : h('button', { class: 'btn small', onclick: () => restaurar(r) }, r.accion === 'DELETE' ? 'Recuperar' : 'Restaurar')));
    }) : h('tr', {}, h('td', { colspan: 6, class: 'empty' }, 'Sin cambios con estos filtros.')));
  }
  async function restaurar(r) {
    const ok = await confirmar({ titulo: r.accion === 'DELETE' ? 'Recuperar registro borrado' : 'Restaurar valores anteriores', ok: r.accion === 'DELETE' ? 'Recuperar' : 'Restaurar',
      texto: h('div', {}, h('p', {}, `${TABLAS.find(([t]) => t === r.tabla)?.[1] || r.tabla}: ${describir(r)}`),
        r.accion === 'UPDATE' ? h('p', { class: 'muted small' }, 'Se vuelven a poner los valores en rojo. El cambio también queda en el historial, así que se puede volver a deshacer.') : h('p', { class: 'muted small' }, 'Se vuelve a crear el registro tal como estaba.')) });
    if (!ok) return;
    try { toast(await db.restaurarAuditoria(r.id)); ctx.limpiarCache?.(); await cargar(); }
    catch (ex) { toast('No se ha podido restaurar: ' + ex.message, 'error'); }
  }

  async function copiaSeguridad() {
    toast('Preparando la copia de seguridad…');
    const fecha = hoyISO();
    const archivos = [], resumen = [];
    for (const [t, n] of TABLAS) {
      try {
        const datos = await db.exportarTabla(t);
        archivos.push({ nombre: `MEH copia ${fecha}/datos/${t}.json`, datos: JSON.stringify(datos, null, 1) });
        resumen.push([n, t, datos.length]);
        if (t === 'gastos' || t === 'facturacion') {
          const cols = Object.keys(datos[0] || {});
          archivos.push({ nombre: `MEH copia ${fecha}/${n}.xlsx`, datos: await crearXlsx([{ nombre: n, filas: [cols, ...datos.map((d) => cols.map((c) => (d[c] !== null && typeof d[c] === 'object' ? JSON.stringify(d[c]) : d[c])))] }]).arrayBuffer() });
        }
      } catch (ex) { resumen.push([n, t, 'error: ' + ex.message]); }
    }
    archivos.push({ nombre: `MEH copia ${fecha}/LEEME.txt`, datos: [`Copia de seguridad de MEH Montcada · ${fecha}`, '', 'datos/*.json: cada tabla completa (sirve para restaurarla).', 'Gastos.xlsx y Facturación.xlsx: para consultarlas en Excel.', 'Las facturas y extractos en PDF no van aquí: siguen en el almacenamiento de la app.', '',
      ...resumen.map(([n, t, c]) => `${n} (${t}): ${c}`)].join('\r\n') });
    descargarBlob(crearZip(archivos), `MEH copia ${fecha}.zip`);
    toast('Copia descargada');
  }

  clear(cont,
    h('section', { class: 'card' },
      h('div', { class: 'section-head' }, h('div', {}, h('h3', {}, 'Copia de seguridad'),
        h('div', { class: 'count' }, 'Descarga todos los datos (gastos, facturación, ingresos, configuración…) en un ZIP. Guárdalo en OneDrive de vez en cuando, por ejemplo cada mes al enviar a la gestoría.')),
        h('button', { class: 'btn primary', onclick: copiaSeguridad }, 'Descargar copia de seguridad'))),
    h('section', { class: 'card lista-card' },
      h('div', { class: 'section-head' }, h('div', {}, h('h3', {}, 'Historial de cambios'),
        h('div', { class: 'count' }, 'Cada alta, cambio o borrado queda guardado para siempre con quién lo hizo y el valor anterior. Desde aquí puedes restaurar un valor o recuperar un registro borrado.')), contador),
      h('div', { class: 'filtros' }, fTabla, fFecha, fQ),
      aviso,
      h('div', { class: 'table-wrap' }, h('table', { class: 'data tabla-historial' },
        h('thead', {}, h('tr', {}, ['Cuándo', 'Quién', 'Qué', 'Registro', 'Cambio', ''].map((t) => h('th', { scope: 'col' }, t)))), tbody))));
  await cargar();
}
registrarSeccionConfig('historial', renderHistorial);
