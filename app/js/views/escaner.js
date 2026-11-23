// Escáner de facturas: lee un PDF o una foto, saca proveedor, NIF, fecha, nº e importe, y propone el gasto
// completando la clasificación con la del último gasto de ese proveedor. Todo se hace en el navegador.
import { h, clear, toast, fmtEUR2, fmtFecha, mesDeFecha, normalizar, num, tituloCategoria, capitalizar } from '../ui.js';
import { subirFactura, escanerProveedores, escanerEmpresas, escanerSugerencia, escanerDuplicado, gastosDeEmpresaMes, getPlantillas } from '../db.js';
import { analizarFactura, rutaSugerida, idPedido, tipoAbono, mejorNombre } from '../escaner-parse.js';
import { esNomina, analizarNomina } from '../escaner-nomina.js';
import { segmentar } from '../escaner-docs.js';
import { comboEmpresa } from '../combo-empresa.js';

// Renombrado al formato estándar «AAMMDD - Empresa - Nº - Concepto»: preparado pero DESACTIVADO por ahora (20-nov-2026).
// Con false se sigue subiendo con el nombre original del archivo y el botón «Renombrar» no hace nada.
// Se activa poniéndolo en true cuando la conexión con OneDrive pueda renombrar de verdad.
const RENOMBRAR_ACTIVO = false;

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';
// el titular de las facturas (no es el proveedor): NIF de MIMAG y nombres con los que aparece
export const PROPIOS = ['B22652960', 'MIMAG ENGLISH', 'MY ENGLISH HOUSE MONTCADA', 'MONTCADA - MEH', 'Maria Gomez Peñafiel'];

let pdfjsLib = null;
async function cargarPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(PDFJS);
  try {
    // worker de módulo desde un blob (un Worker no se puede crear directamente desde otro dominio)
    const url = URL.createObjectURL(new Blob([`import "${PDFJS_WORKER}";`], { type: 'text/javascript' }));
    pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(url, { type: 'module' });
  } catch { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; }
  return pdfjsLib;
}

// Texto de cada página de un PDF digital, reconstruyendo las líneas por la posición vertical de cada trozo
async function textosPdf(pdf, maxPaginas = 3) {
  const paginas = [];
  for (let p = 1; p <= Math.min(pdf.numPages, maxPaginas); p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const filas = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5], x = it.transform[4];
      let f = filas.find((r) => Math.abs(r.y - y) < Math.max(2, (it.height || 8) * 0.45));
      if (!f) { f = { y, trozos: [] }; filas.push(f); }
      f.trozos.push({ x, s: it.str });
    }
    filas.sort((a, b) => b.y - a.y);
    paginas.push(filas.map((f) => f.trozos.sort((a, b) => a.x - b.x).map((t) => t.s).join(' ')).join('\n'));
  }
  return paginas;
}
const textoPdf = async (pdf, maxPaginas = 3) => (await textosPdf(pdf, maxPaginas)).join('\n');

// Un PDF nuevo solo con las páginas indicadas (0, 1, …); si no se puede, devuelve el original
async function recortarPdf(file, paginas, nombre) {
  try {
    const { PDFDocument } = await import(PDFLIB);
    const origen = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
    const nuevo = await PDFDocument.create();
    (await nuevo.copyPages(origen, paginas)).forEach((p) => nuevo.addPage(p));
    return new File([await nuevo.save()], nombre, { type: 'application/pdf' });
  } catch { return file; }
}

async function canvasDePdf(pdf, escala = 2, pagina = 1) {
  const page = await pdf.getPage(pagina);
  const vp = page.getViewport({ scale: escala });
  const c = document.createElement('canvas');
  c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  return c;
}
async function canvasDeImagen(file) {
  const bmp = await createImageBitmap(file);
  const max = 2400, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}
function rotar(c, grados) {
  const r = document.createElement('canvas');
  const giro = grados % 180 !== 0;
  r.width = giro ? c.height : c.width; r.height = giro ? c.width : c.height;
  const x = r.getContext('2d');
  x.translate(r.width / 2, r.height / 2); x.rotate((grados * Math.PI) / 180); x.drawImage(c, -c.width / 2, -c.height / 2);
  return r;
}

// OCR (Tesseract, en español). Si la confianza es baja prueba la página girada (fotos o escaneos del revés).
async function ocr(canvas, progreso) {
  const T = await import(TESSERACT);
  const createWorker = T.createWorker || T.default?.createWorker;
  const worker = await createWorker('spa', 1, { logger: (m) => { if (m.status === 'recognizing text') progreso(Math.round(m.progress * 100)); } });
  try {
    let mejor = null;
    for (const g of [0, 180, 90, 270]) {
      const { data } = await worker.recognize(g ? rotar(canvas, g) : canvas);
      if (!mejor || data.confidence > mejor.confidence) mejor = { text: data.text, confidence: data.confidence };
      if (data.confidence >= 70) break;
    }
    return mejor;
  } finally { await worker.terminate(); }
}

// importe escrito a mano: "44,20", "1.234,56" o "44.20" -> número (null si está vacío, NaN si no vale)
const leerImporte = (t) => {
  const x = String(t ?? '').replace(/\s|€/g, '');
  if (!x) return null;
  const n = Number(/,\d{1,2}$/.test(x) ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
// miniatura ligera (JPEG) de la primera página, para enseñarla en el paso siguiente
function miniaturaDe(canvas, ancho = 420) {
  if (!canvas) return null;
  try {
    const k = Math.min(1, ancho / canvas.width), c = document.createElement('canvas');
    c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  } catch { return null; }
}

const CONF = { alta: ['ok', 'Seguro'], media: ['warn', 'Revisar'], baja: ['bad', 'Dudoso'] };

// Monta el escáner dentro de un contenedor. Al terminar llama a onDatos(datos, info) con el gasto propuesto
// (los datos leídos + la clasificación del último gasto del proveedor) y el archivo ya subido.
export function montarEscaner(cuerpo, ctx, { onDatos, onVarios = null, onCerrar = () => {}, textoBoton = 'Revisar y crear el gasto' }) {
  const { state } = ctx;
  let cerrado = false;
  let cola = null; // PDF con varios documentos: { docs, idx, acum, file, pdf }
  // proveedores conocidos (de la BD, sin necesidad de ver los gastos)
  let conocidas = [];
  let listado = [];
  // además de los nombres de los gastos, las empresas del listado: el texto de la factura suele llevar la razón social
  // y el gasto se guarda con el nombre comercial (canon)
  const cargaConocidas = Promise.all([escanerProveedores().catch(() => []), escanerEmpresas().catch(() => [])]).then(([gs, es]) => {
    const vistos = new Set(), out = [];
    const add = (nombre, nif, canon) => { const k = `${normalizar(nombre)}|${normalizar(canon || '')}`; if (nombre && !vistos.has(k)) { vistos.add(k); out.push({ nombre, nif, canon }); } };
    for (const e of es) { add(e.nombre_comercial, e.cif); if (e.razon_social && normalizar(e.razon_social) !== normalizar(e.nombre_comercial)) add(e.razon_social, e.cif, e.nombre_comercial); }
    for (const x of gs) if (!es.some((e) => normalizar(e.nombre_comercial) === normalizar(x.nombre))) add(x.nombre, x.nif);
    conocidas = out;
    // listado para el desplegable del proveedor: empresas (nombre comercial) y los demás nombres usados en gastos
    listado = [...es.map((e) => ({ nombre_comercial: e.nombre_comercial, razon_social: e.razon_social, cif: e.cif })),
      ...gs.filter((x) => !es.some((e) => normalizar(e.nombre_comercial) === normalizar(x.nombre))).map((x) => ({ nombre_comercial: x.nombre, razon_social: null, cif: x.nif }))]
      .filter((e) => e.nombre_comercial).map((e) => ({ ...e, _k: normalizar(`${e.nombre_comercial} ${e.razon_social || ''} ${e.cif || ''}`) }));
  });

  function inicio() {
    cola = null;
    const inputArchivo = h('input', { type: 'file', accept: 'application/pdf,image/*', hidden: true, 'aria-label': 'Archivo de la factura', onchange: () => procesar(inputArchivo.files[0]) });
    const inputFoto = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, 'aria-label': 'Foto de la factura', onchange: () => procesar(inputFoto.files[0]) });
    const zona = h('div', { class: 'zona-escaner', tabindex: '0', role: 'button', 'aria-label': 'Elegir o arrastrar la factura', onclick: () => inputArchivo.click(),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputArchivo.click(); } },
      ondragover: (e) => { e.preventDefault(); zona.classList.add('encima'); }, ondragleave: () => zona.classList.remove('encima'),
      ondrop: (e) => { e.preventDefault(); zona.classList.remove('encima'); procesar(e.dataTransfer.files[0]); } },
    h('strong', {}, 'Arrastra aquí la factura o el ticket (PDF o foto)'), h('span', { class: 'muted small' }, 'o haz clic para elegirla. Se leen el proveedor, el NIF, la fecha, el número y el importe.'));
    clear(cuerpo, zona, h('div', { class: 'escaner-acciones' }, inputArchivo, inputFoto,
      h('button', { class: 'btn', type: 'button', onclick: () => inputArchivo.click() }, 'Elegir archivo'),
      h('button', { class: 'btn solo-movil primary', type: 'button', onclick: () => inputFoto.click() }, 'Hacer foto')));
  }

  async function procesar(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { toast('El archivo pasa de 20 MB.', 'error'); return; }
    const estado = h('div', { class: 'escaner-estado' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, 'Leyendo el archivo…'));
    const ponEstado = (t) => { estado.lastChild.textContent = t; };
    clear(cuerpo, estado);
    let texto = '', canvas = null, origen = 'pdf', confOcr = null;
    try {
      if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
        const lib = await cargarPdfjs();
        const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        texto = await textoPdf(pdf);
        // varios documentos en un mismo PDF (nóminas de toda la plantilla, facturas seguidas): se revisan uno a uno
        if (onVarios && pdf.numPages > 1 && texto.replace(/\s/g, '').length >= 60) {
          ponEstado(`Leyendo las ${pdf.numPages} páginas…`);
          const docs = segmentar(await textosPdf(pdf, 80), { analizarFactura, propios: PROPIOS });
          if (docs.length > 1) { await cargaConocidas; if (cerrado) return; cola = { docs, idx: 0, acum: [], file, pdf }; return mostrarDoc(); }
        }
        canvas = await canvasDePdf(pdf, texto.replace(/\s/g, '').length < 60 ? 2.2 : 1.2);
        if (texto.replace(/\s/g, '').length < 60) {
          origen = 'ocr'; ponEstado('PDF escaneado: reconociendo el texto (OCR)…');
          const r = await ocr(canvas, (p) => ponEstado(`PDF escaneado: reconociendo el texto (OCR) ${p}%…`));
          texto = r.text; confOcr = r.confidence;
        }
      } else if (/^image\//.test(file.type)) {
        origen = 'ocr';
        canvas = await canvasDeImagen(file);
        ponEstado('Reconociendo el texto de la foto (OCR)…');
        const r = await ocr(canvas, (p) => ponEstado(`Reconociendo el texto de la foto (OCR) ${p}%…`));
        texto = r.text; confOcr = r.confidence;
      } else throw new Error('Formato no admitido: usa un PDF o una imagen.');
      await cargaConocidas;
    } catch (ex) {
      if (cerrado) return;
      clear(cuerpo, h('div', { class: 'banner error' }, 'No se ha podido leer la factura: ', ex.message),
        h('div', { class: 'escaner-acciones' }, h('button', { class: 'btn', onclick: inicio }, 'Probar con otro archivo'),
          h('button', { class: 'btn', onclick: () => onDatos({}, { file, link: null }) }, 'Rellenar a mano')));
      return;
    }
    if (cerrado) return;
    await mostrar(file, texto, canvas, origen, confOcr);
  }

  // ---------- PDF con varios documentos ----------
  async function mostrarDoc() {
    const d = cola.docs[cola.idx];
    clear(cuerpo, h('div', { class: 'escaner-estado' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, `Preparando el documento ${cola.idx + 1} de ${cola.docs.length}…`)));
    const base = cola.file.name.replace(/\.pdf$/i, '');
    const canvas = await canvasDePdf(cola.pdf, 1.2, d.paginas[0] + 1);
    const parte = await recortarPdf(cola.file, d.paginas, `${base} - ${d.paginas.length > 1 ? `págs ${d.paginas[0] + 1}-${d.paginas[d.paginas.length - 1] + 1}` : `pág ${d.paginas[0] + 1}`}.pdf`);
    if (cerrado || !cola) return;
    await mostrar(parte, d.texto, canvas, 'pdf', null);
    if (cerrado || !cola) return;
    const n = cola.docs.length, ultimo = cola.idx + 1 >= n;
    cuerpo.prepend(h('div', { class: 'banner' },
      h('strong', {}, `Documento ${cola.idx + 1} de ${n}`), ` (${d.tipo === 'nomina' ? 'nómina' : 'factura'}, ${d.paginas.length > 1 ? 'págs' : 'pág'} ${d.paginas.map((p) => p + 1).join('-')}). `,
      cola.acum.length ? `Llevas ${cola.acum.length} ${cola.acum.length === 1 ? 'gasto preparado' : 'gastos preparados'}; se guardan todos al terminar. ` : 'Los gastos se guardan todos al terminar. ',
      h('button', { class: 'link-btn', type: 'button', onclick: () => avanzar() }, ultimo ? 'Saltar este y terminar' : 'Saltar este documento')));
  }
  async function avanzar() {
    cola.idx++;
    if (cola.idx < cola.docs.length) return mostrarDoc();
    const todo = cola.acum; cola = null;
    if (todo.length) onVarios(todo, { file: null, link: null }); else { toast('No se ha creado ningún gasto.'); inicio(); }
  }
  const entregar = (dato, info) => { if (!cola) { onDatos(dato, info); return; } cola.acum.push(dato); avanzar(); };
  const entregarVarios = (lista, info) => { if (!cola) { if (onVarios) onVarios(lista, info); else onDatos(lista[0], info); return; } cola.acum.push(...lista); avanzar(); };
  const textoCrear = (normal) => (cola ? (cola.idx + 1 >= cola.docs.length ? 'Añadir y terminar' : 'Añadir y pasar al siguiente') : normal);

  async function mostrar(file, texto, canvas, origen, confOcr) {
    if (esNomina(texto)) return mostrarNomina(file, texto, canvas, origen, confOcr);
    const r = analizarFactura(texto, { conocidas, propios: PROPIOS, nombreArchivo: file.name });
    const hoy = new Date().toISOString().slice(0, 10);
    if (r.fecha && r.fecha > hoy && r.confianza.fecha === 'alta') r.confianza.fecha = 'media';
    // último gasto de ese proveedor (categoría, método, periodicidad, tipo, centro…) y posible duplicado
    let ultimo = null, duplicado = null;
    try { if (r.empresa || r.nif) ultimo = await escanerSugerencia(r.empresa || '', r.nif); } catch { /* opcional */ }
    try { if (r.empresa) duplicado = await escanerDuplicado(r.empresa, r.numero, r.fecha, r.total); } catch { /* opcional */ }
    if (ultimo?.empresa && r.confianza.empresa !== 'alta') r.empresa = ultimo.empresa;
    const centroId = ultimo?.centro_id || ctx.centroActual()?.id || ctx.centroPrincipal()?.id || null;
    const centro = state.centros.find((c) => c.id === centroId);
    const tn = normalizar(texto);
    const entidad = /alcantarilla/.test(normalizar(centro?.nombre)) ? 'Gastos MIMAG Alcantarilla' : (!/mimag/.test(tn) && /maria gomez/.test(tn) ? 'Gastos Maria' : 'Gastos MIMAG');
    const miniatura = miniaturaDe(canvas);

    // Datos leídos, todos editables: se corrige lo que haya leído mal antes de pasar al gasto
    const importeIni = r.total != null ? r.total.toFixed(2).replace('.', ',') : '';
    const iEmp = h('input', { type: 'text', value: r.empresa || '', autocomplete: 'off', placeholder: 'Elige de tu listado o escribe uno nuevo', 'aria-label': 'Proveedor' });
    const cbEmp = comboEmpresa(iEmp, () => listado, (e) => { if (!iNif.value.trim() && e.cif && e.cif.length <= 12) iNif.value = e.cif; ponerRuta(); });
    const iNif = h('input', { type: 'text', value: r.nif || '', autocomplete: 'off', 'aria-label': 'NIF' });
    const iFecha = h('input', { type: 'date', value: r.fecha || '', 'aria-label': 'Fecha factura' });
    const iNum = h('input', { type: 'text', value: r.numero || '', autocomplete: 'off', 'aria-label': 'Nº factura' });
    const iConcepto = h('input', { type: 'text', value: '', autocomplete: 'off', placeholder: 'Ej. Material oficina', 'aria-label': 'Concepto' });
    const iTotal = h('input', { type: 'text', inputmode: 'decimal', value: importeIni, placeholder: '0,00', autocomplete: 'off', 'aria-label': 'Importe total' });
    const iCat = h('select', { 'aria-label': 'Categoría' }, h('option', { value: '' }, '— Sin clasificar —'),
      state.taxonomia.map((c) => h('option', { value: c.id, selected: c.id === ultimo?.categoria_id }, tituloCategoria(c.nombre))));
    const iSub = h('select', { 'aria-label': 'Subcategoría' });
    const pintarSub = () => {
      const c = state.taxonomia.find((x) => x.id === iCat.value);
      iSub.replaceChildren(h('option', { value: '' }, c ? 'Elige…' : '—'), ...(c ? c.subcategorias.map((s) => h('option', { value: s.id, selected: s.id === ultimo?.subcategoria_id && c.id === ultimo?.categoria_id }, s.nombre)) : []));
      iSub.disabled = !c;
    };
    iCat.addEventListener('change', pintarSub); pintarSub();

    const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, 'pdf'])[1];
    let rutaTocada = false, conceptoTocado = false;
    const pedido = idPedido(texto);
    // concepto propuesto: el del último gasto de ese proveedor (si no cambia la categoría) con el mes de esta factura
    const conceptoPropuesto = () => {
      const c = state.taxonomia.find((x) => x.id === iCat.value);
      if (!(ultimo && c?.id === ultimo.categoria_id && ultimo.concepto)) return '';
      const mes = mesDeFecha(iFecha.value || hoy);
      return ultimo.concepto.replace(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i, (m) => (mes ? mes.charAt(0).toUpperCase() + mes.slice(1) : m));
    };
    iConcepto.addEventListener('input', () => { conceptoTocado = true; });
    const ponerConcepto = () => { if (!conceptoTocado) iConcepto.value = conceptoPropuesto(); };
    iCat.addEventListener('change', () => { ponerConcepto(); ponerRuta(); });
    ponerConcepto();
    const rutaActual = () => rutaSugerida({ fecha: iFecha.value || null, empresa: iEmp.value, numero: iNum.value, pedido, concepto: iConcepto.value, abono: tipoAbono({ importe: Number.isNaN(leerImporte(iTotal.value)) ? null : leerImporte(iTotal.value), texto }), extension: ext, carpetaEntidad: entidad });
    // Aviso (no bloquea): el nombre escrito a mano no sigue el patrón YYMMDD - Empresa - Nº - Concepto
    const avisoRuta = h('div', { class: 'banner warn', role: 'status', hidden: true });
    const comprobarRuta = () => {
      const q = rutaActual();
      const nom = inpRuta.value.split('/').pop().trim(), car = inpRuta.value.split('/').slice(0, -1).join('/').trim();
      const dif = [];
      if (nom !== q.nombre) dif.push(`el nombre debería ser «${q.nombre}»`);
      if (car !== q.carpeta) dif.push(`la carpeta debería ser «${q.carpeta}»`);
      avisoRuta.hidden = !dif.length;
      avisoRuta.replaceChildren(h('strong', {}, 'No coincide con el formato estándar: '), dif.join(' y '), '. Puedes dejarlo así si no es una factura normal (recibo de préstamo, factura ilegible…). ',
        h('button', { class: 'btn small', type: 'button', onclick: () => { rutaTocada = false; ponerRuta(); } }, 'Usar el sugerido'));
    };
    const inpRuta = h('input', { type: 'text', value: '', 'aria-label': 'Carpeta y nombre en OneDrive', class: 'input-ruta', oninput: () => { rutaTocada = true; comprobarRuta(); } });
    const ponerRuta = () => { if (!rutaTocada) { const q = rutaActual(); inpRuta.value = `${q.carpeta}/${q.nombre}`; } comprobarRuta(); };
    ponerRuta();
    const nombreFinal = () => inpRuta.value.split('/').pop().trim() || rutaActual().nombre;
    const carpetaFinal = () => inpRuta.value.split('/').slice(0, -1).join('/').trim() || rutaActual().carpeta;

    // fila editable con su indicador: «Seguro / Revisar / Dudoso» según lo leído, y «Corregido» si se ha tocado
    const filaEd = (label, input, conf, inicial, extra, caja = null) => {
      const badge = h('span', {});
      const pintar = () => {
        const v = input.value.trim();
        const [cls, txt] = !v ? ['bad', 'No encontrado'] : v !== String(inicial).trim() ? ['ok', 'Corregido'] : (CONF[conf] || ['bad', 'No encontrado']);
        badge.className = `conf ${cls}`; badge.textContent = txt;
      };
      input.addEventListener('input', pintar); pintar();
      return h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, caja || input, extra ? h('span', { class: 'muted small' }, ` ${extra}`) : null), h('td', {}, badge));
    };
    for (const i of [iEmp, iNif, iFecha, iNum, iConcepto, iTotal]) i.addEventListener('input', () => { if (i === iFecha) ponerConcepto(); ponerRuta(); });
    const vista = canvas ? (() => { canvas.classList.add('escaner-preview'); return canvas; })() : null;
    const verTexto = h('details', { class: 'escaner-texto' }, h('summary', {}, `Texto leído (${origen === 'ocr' ? `OCR, confianza ${Math.round(confOcr || 0)}%` : 'PDF'})`), h('pre', {}, texto.slice(0, 6000)));

    const btnCrear = h('button', { class: 'btn primary', type: 'button', onclick: crear }, textoCrear(textoBoton));
    async function crear() {
      const importe = leerImporte(iTotal.value);
      if (Number.isNaN(importe)) { toast('El importe no es válido: escríbelo como 44,20.', 'error'); iTotal.focus(); return; }
      const fecha = iFecha.value || hoy;
      const mes = mesDeFecha(fecha) || null;
      const cursoFecha = state.cursos.find((c) => c.fecha_inicio <= fecha && fecha <= c.fecha_fin);
      const cat = state.taxonomia.find((c) => c.id === iCat.value);
      const sub = cat?.subcategorias.find((x) => x.id === iSub.value);
      const mismaClasif = !!ultimo && cat?.id === ultimo.categoria_id;   // método y periodicidad solo valen si no cambia la categoría
      const concepto = iConcepto.value.trim();
      btnCrear.disabled = true; btnCrear.textContent = 'Subiendo la factura…';
      let link = null;
      try {
        const aSubir = RENOMBRAR_ACTIVO ? new File([file], nombreFinal(), { type: file.type || 'application/pdf' }) : file;
        link = await subirFactura(aSubir, RENOMBRAR_ACTIVO ? carpetaFinal() : 'general');
      } catch (ex) { toast('No se ha podido subir la factura (se crea el gasto sin adjunto): ' + ex.message, 'error'); }
      const empresa = iEmp.value.trim();
      entregar({
        fecha_factura: fecha, empresa, factura_nr: iNum.value.trim(), cantidad: importe ?? '', nif: iNif.value.trim() || ultimo?.nif || '',
        iban: ultimo?.iban || '', swift: ultimo?.swift || '', concepto,
        tipo: ultimo?.tipo || 'Factura', periodicidad: mismaClasif ? ultimo?.periodicidad || '' : '', metodo_pago: ultimo?.metodo_pago || '',
        categoria_id: cat?.id || null, subcategoria_id: sub?.id || null,
        centro_id: centroId, mes: mes || undefined, curso_id: (cursoFecha || ctx.cursoActual()).id,
        link_factura: link, sin_factura: false,
        comentarios: `Escaneada${duplicado ? ' · OJO: posible duplicado' : ''}. OneDrive: Facturas & Nominas/${inpRuta.value}`,
      }, { file, link, duplicado, confianza: r.confianza, miniatura });
    }
    function descargar() {
      const url = URL.createObjectURL(file);
      const a = h('a', { href: url, download: nombreFinal() });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    clear(cuerpo,
      duplicado ? h('div', { class: 'banner warn' }, h('span', {}, h('strong', {}, 'Posible duplicado: '), `ya hay un gasto de ${r.empresa} del ${fmtFecha(duplicado.fecha_factura)} por ${fmtEUR2(num(duplicado.cantidad))}${duplicado.factura_nr ? ` (nº ${duplicado.factura_nr})` : ''}.`)) : null,
      h('div', { class: 'escaner-res' },
        vista ? h('div', { class: 'escaner-vista' }, vista) : null,
        h('div', { class: 'escaner-datos' },
          h('div', { class: 'small muted' }, 'Revisa lo leído y corrige lo que haga falta: puedes cambiar cualquier dato antes de continuar.'),
          h('table', { class: 'data escaner-tabla' }, h('tbody', {},
            filaEd('Proveedor', iEmp, r.confianza.empresa, r.empresa || '', r.empresaNueva && !ultimo ? '(nuevo)' : null, cbEmp),
            filaEd('NIF', iNif, r.confianza.nif, r.nif || ''),
            filaEd('Fecha factura', iFecha, r.confianza.fecha, r.fecha || ''),
            filaEd('Nº factura', iNum, r.confianza.numero, r.numero || '', !r.numero && pedido ? `(sin nº: se usa el pedido ${pedido})` : null),
            h('tr', {}, h('th', { scope: 'row' }, 'Concepto'), h('td', { colspan: 2 }, iConcepto)),
            filaEd('Importe total (€)', iTotal, r.confianza.total, importeIni, r.base != null && r.base !== r.total ? `(base ${fmtEUR2(r.base)})` : null),
            h('tr', {}, h('th', { scope: 'row' }, 'Clasificación'), h('td', { colspan: 2 }, h('div', { class: 'escaner-clasif' }, iCat, iSub),
              ultimo
                ? h('span', { class: 'muted small' }, `${[ultimo.metodo_pago, ultimo.periodicidad].filter(Boolean).join(' · ')}${ultimo.metodo_pago || ultimo.periodicidad ? ' · ' : ''}propuesta como el gasto del ${fmtFecha(ultimo.fecha_factura)}`)
                : h('span', { class: 'muted small' }, 'Proveedor sin gastos anteriores: elige la categoría.'))))),
          avisoRuta,
          h('label', { class: 'field' }, h('span', {}, RENOMBRAR_ACTIVO ? 'Guardar en OneDrive como' : 'Nombre propuesto en OneDrive (todavía no se aplica)'), h('div', { class: 'ruta-onedrive' }, h('span', { class: 'muted small' }, 'Facturas & Nominas/'), inpRuta),
            h('span', { class: 'small muted', style: 'font-weight:400' }, 'Formato: AAMMDD - Empresa - Nº factura - Concepto (con «Abono» o «Nota de Credito» si lo es). Se puede cambiar a mano; si no coincide, aparece un aviso.' + (RENOMBRAR_ACTIVO ? '' : ' Por ahora el archivo se guarda con su nombre original.'))),
          h('div', { class: 'escaner-acciones' },
            h('button', { class: 'btn', type: 'button', onclick: inicio }, 'Otra factura'),
            h('button', { class: 'btn', type: 'button', onclick: descargar, title: 'Descarga el archivo con el nombre sugerido para guardarlo en la carpeta de OneDrive' }, 'Descargar renombrada'),
            h('button', { class: 'btn', type: 'button', disabled: !RENOMBRAR_ACTIVO, title: RENOMBRAR_ACTIVO ? 'Renombra la factura con el nombre indicado' : 'Pendiente: todavía no se renombra en OneDrive' }, 'Renombrar'),
            btnCrear),
          verTexto)));
  }

  // ---------- nómina: un PDF por trabajador → hasta 3 gastos (Nómina = líquido, SS = trabajador + empresa, IRPF) ----------
  async function mostrarNomina(file, texto, canvas, origen, confOcr) {
    const n = analizarNomina(texto, { propios: PROPIOS });
    const trabajadores = conocidas.filter((e) => !e.canon);
    const hallado = (n.trabajador && mejorNombre(n.trabajador, conocidas)) || null;
    const miniatura = miniaturaDe(canvas);
    const hoy = new Date().toISOString().slice(0, 10);
    const iTrab = h('input', { type: 'text', value: hallado?.nombre || n.trabajador || '', autocomplete: 'off', 'aria-label': 'Trabajador' });
    const cbTrab = comboEmpresa(iTrab, () => listado, () => revisarExistentes());
    const dlTrab = h('datalist', { id: 'dl-nom-trab' }, [...new Set(trabajadores.map((e) => e.nombre))].map((v) => h('option', { value: v })));
    const iFecha = h('input', { type: 'date', value: n.fecha || '', 'aria-label': 'Fecha de la nómina (fin de mes)' });
    const impTxt = (v) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','));
    const cat = state.taxonomia.find((c) => normalizar(c.nombre) === 'trabajadores');
    const subDe = (nombre) => cat?.subcategorias.find((s) => normalizar(s.nombre) === nombre);
    // filas: nómina, SS, IRPF
    const defs = [
      { clave: 'nomina', etiqueta: 'Nómina (líquido)', concepto: 'Nomina mes', sub: subDe('nominas'), valor: n.liquido, conf: n.confianza.liquido, metodo: 'Transferencia', pago: false,
        detalle: null },
      { clave: 'ss', etiqueta: 'Seguridad Social', concepto: 'SS mes', sub: subDe('seguridad social'), valor: n.ss, conf: n.confianza.ss || 'baja', metodo: 'Domiciliacion', pago: false,
        detalle: n.ssTrabajador != null || n.ssEmpresa != null ? `trabajador ${n.ssTrabajador != null ? fmtEUR2(n.ssTrabajador) : '¿?'} + empresa ${n.ssEmpresa != null ? fmtEUR2(n.ssEmpresa) : '¿?'}` : null },
      { clave: 'irpf', etiqueta: 'IRPF', concepto: 'IRPF', sub: subDe('irpf trabajadores'), valor: n.irpf > 0 ? n.irpf : null, conf: n.irpf > 0 ? n.confianza.irpf : 'alta', metodo: 'Domiciliacion', pago: false,
        detalle: n.irpf > 0 ? null : 'sin retención de IRPF en esta nómina' },
    ];
    for (const d of defs) {
      d.chk = h('input', { type: 'checkbox', checked: d.valor != null && d.valor > 0, 'aria-label': `Crear gasto de ${d.etiqueta}` });
      d.inp = h('input', { type: 'text', inputmode: 'decimal', value: impTxt(d.valor), placeholder: '0,00', autocomplete: 'off', 'aria-label': `Importe ${d.etiqueta}` });
      d.nota = h('span', { class: 'muted small' });
      d.badge = h('span', {});
      const pintarBadge = () => {
        const v = d.inp.value.trim();
        const [cls, txt] = d.clave === 'irpf' && !v ? ['ok', 'Sin IRPF'] : !v ? ['bad', 'No encontrado'] : v !== impTxt(d.valor) ? ['ok', 'Corregido'] : (CONF[d.conf] || ['bad', 'Dudoso']);
        d.badge.className = `conf ${cls}`; d.badge.textContent = txt;
      };
      d.inp.addEventListener('input', () => { pintarBadge(); if (d.inp.value.trim()) d.chk.checked = true; });
      pintarBadge();
    }
    // ¿ya existen esos gastos (p. ej. generados desde las plantillas)? se avisa y la casilla queda sin marcar
    const existentes = [];
    const revisarExistentes = async () => {
      existentes.length = 0;
      const fecha = iFecha.value, emp = iTrab.value.trim();
      const curso = state.cursos.find((c) => c.fecha_inicio <= fecha && fecha <= c.fecha_fin);
      let lista = [];
      if (fecha && emp && curso) { try { lista = await gastosDeEmpresaMes(emp, curso.id, mesDeFecha(fecha)); } catch { /* opcional */ } }
      for (const d of defs) {
        const ya = lista.find((x) => (d.sub && x.subcategoria_id === d.sub.id) || normalizar(x.subcategoria_texto) === normalizar(d.sub?.nombre));
        d.nota.textContent = ya ? `Ya hay un gasto así en ${mesDeFecha(fecha)} (${fmtEUR2(num(ya.cantidad))}): se deja sin marcar para no duplicar.` : (d.detalle || '');
        if (ya) { d.chk.checked = false; existentes.push(d.clave); }
      }
    };
    iTrab.addEventListener('change', revisarExistentes); iFecha.addEventListener('change', revisarExistentes);
    revisarExistentes();

    // método, periodicidad y centro del trabajador: de las plantillas (si está) y, si no, del último gasto
    let plantillas = [], ultimo = null;
    try { plantillas = await getPlantillas(); } catch { /* opcional */ }
    try { if (iTrab.value.trim()) ultimo = await escanerSugerencia(iTrab.value.trim(), n.nif); } catch { /* opcional */ }

    const btnCrear = h('button', { class: 'btn primary', type: 'button', onclick: crear }, textoCrear('Crear los gastos marcados'));
    async function crear() {
      const emp = iTrab.value.trim(), fecha = iFecha.value;
      if (!emp) { toast('Falta el trabajador.', 'error'); iTrab.focus(); return; }
      if (!fecha) { toast('Falta la fecha (último día del mes de la nómina).', 'error'); iFecha.focus(); return; }
      const cursoFecha = state.cursos.find((c) => c.fecha_inicio <= fecha && fecha <= c.fecha_fin);
      if (!cursoFecha) { toast('No hay ningún curso para esa fecha.', 'error'); return; }
      const elegidos = [];
      for (const d of defs) {
        if (!d.chk.checked) continue;
        const v = leerImporte(d.inp.value);
        if (v == null || Number.isNaN(v) || !d.inp.value.trim()) { toast(`El importe de «${d.etiqueta}» no es válido: escríbelo como 1234,56.`, 'error'); d.inp.focus(); return; }
        elegidos.push([d, v]);
      }
      if (!elegidos.length) { toast('No hay ningún gasto marcado.', 'error'); return; }
      const mes = mesDeFecha(fecha);
      btnCrear.disabled = true; btnCrear.textContent = 'Subiendo la nómina…';
      let link = null;
      try { link = await subirFactura(file, 'general'); } catch (ex) { toast('No se ha podido subir la nómina (se crean los gastos sin adjunto): ' + ex.message, 'error'); }
      const nombreEmp = normalizar(emp);
      const lista = elegidos.map(([d, v]) => {
        const pl = plantillas.find((p) => normalizar(p.empresa) === nombreEmp && (d.sub && p.subcategoria_id === d.sub.id));
        const centroId = pl?.centro_id || ultimo?.centro_id || ctx.centroActual()?.id || ctx.centroPrincipal()?.id || null;
        return {
          fecha_factura: fecha, empresa: emp, factura_nr: `Sueldos ${capitalizar(mes)}`, cantidad: v, nif: n.nif || ultimo?.nif || '', iban: ultimo?.iban || '', swift: ultimo?.swift || '',
          concepto: d.concepto, tipo: 'Nomina', periodicidad: 'Mensual', metodo_pago: pl?.metodo_pago || d.metodo,
          categoria_id: cat?.id || null, subcategoria_id: d.sub?.id || null, categoria_texto: cat ? tituloCategoria(cat.nombre) : null, subcategoria_texto: d.sub?.nombre || null,
          pago: d.pago ? 'True' : 'False', fecha_pago: d.pago ? fecha : null, fiscontal: 'False', check_banca: false,
          centro_id: centroId, mes: mes || undefined, curso_id: cursoFecha.id, link_factura: link, sin_factura: !link,
          comentarios: `Escaneada (nómina de ${emp}).`,
        };
      });
      const info = { file, link, duplicado: null, confianza: n.confianza, miniatura };
      entregarVarios(lista, info);
    }

    const fila = (d) => h('tr', {}, h('th', { scope: 'row' }, h('label', { class: 'check' }, d.chk, d.etiqueta)),
      h('td', {}, d.inp, h('div', {}, d.nota)), h('td', {}, d.badge));
    clear(cuerpo,
      h('div', { class: 'escaner-res' },
        canvas ? h('div', { class: 'escaner-vista' }, (() => { canvas.classList.add('escaner-preview'); return canvas; })()) : null,
        h('div', { class: 'escaner-datos' },
          h('div', { class: 'banner' }, h('strong', {}, 'Es una nómina. '), 'Se crean hasta 3 gastos con este mismo PDF: nómina (líquido), Seguridad Social (cuota del trabajador + cuota de la empresa) e IRPF si hay retención. Revisa los importes.'),
          h('table', { class: 'data escaner-tabla' }, h('tbody', {},
            h('tr', {}, h('th', { scope: 'row' }, 'Trabajador'), h('td', { colspan: 2 }, cbTrab, hallado ? null : h('span', { class: 'muted small' }, ' no está en el listado: se creará con este nombre'))),
            h('tr', {}, h('th', { scope: 'row' }, 'Fecha (fin de mes)'), h('td', { colspan: 2 }, iFecha, !n.fecha ? h('span', { class: 'muted small' }, ' no se ha encontrado el periodo: ponlo a mano') : null)),
            defs.map(fila))),
          h('div', { class: 'escaner-acciones' },
            h('button', { class: 'btn', type: 'button', onclick: inicio }, 'Otro documento'),
            btnCrear),
          h('details', { class: 'escaner-texto' }, h('summary', {}, `Texto leído (${origen === 'ocr' ? `OCR, confianza ${Math.round(confOcr || 0)}%` : 'PDF'})`), h('pre', {}, texto.slice(0, 6000))))));
  }

  inicio();
  return { reiniciar: inicio, cerrar: () => { cerrado = true; onCerrar(); } };
}

// Versión en ventana (se usa desde la ficha de gasto u otras pantallas)
export function abrirEscaner(ctx, { onDatos, onVarios = null }) {
  const cuerpo = h('div', { class: 'escaner-cuerpo' });
  const overlay = h('div', { class: 'overlay modal-center', onmousedown: (e) => { if (e.target === overlay) cerrar(); } },
    h('div', { class: 'dialog escaner', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'esc-t' },
      h('div', { class: 'escaner-cab' }, h('h3', { id: 'esc-t' }, 'Escanear factura'), h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Cerrar', onclick: () => cerrar() }, '✕')),
      cuerpo));
  const onKey = (e) => { if (e.key === 'Escape') cerrar(); };
  let esc;
  function cerrar() { esc?.cerrar(); document.removeEventListener('keydown', onKey); overlay.remove(); }
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  esc = montarEscaner(cuerpo, ctx, { onDatos: (d, info) => { cerrar(); onDatos(d, info); }, onVarios: onVarios ? (l, info) => { cerrar(); onVarios(l, info); } : null });
}
