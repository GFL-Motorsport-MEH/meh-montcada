// Escáner de facturas: lee un PDF o una foto, saca proveedor, NIF, fecha, nº e importe, y propone el gasto
// completando la clasificación con la del último gasto de ese proveedor. Todo se hace en el navegador.
import { h, clear, toast, fmtEUR2, fmtFecha, mesDeFecha, normalizar, num } from '../ui.js';
import { subirFactura } from '../db.js';
import { analizarFactura, rutaSugerida } from '../escaner-parse.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
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

// Texto de un PDF digital, reconstruyendo las líneas por la posición vertical de cada trozo
async function textoPdf(pdf, maxPaginas = 3) {
  const out = [];
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
    for (const f of filas) out.push(f.trozos.sort((a, b) => a.x - b.x).map((t) => t.s).join(' '));
  }
  return out.join('\n');
}

async function canvasDePdf(pdf, escala = 2) {
  const page = await pdf.getPage(1);
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

// Proveedores conocidos (de los gastos de todos los cursos y de Configuración > Empresas) con su NIF si se sabe
function conocidasDe(gastos, empresas) {
  const m = new Map();
  for (const e of empresas || []) m.set(normalizar(e.nombre_comercial), { nombre: e.nombre_comercial, nif: e.cif || null });
  for (const g of gastos) {
    if (!g.empresa) continue;
    const k = normalizar(g.empresa.trim());
    const x = m.get(k) || { nombre: g.empresa.trim(), nif: null };
    if (!x.nif && g.nif && String(g.nif).length > 6) x.nif = g.nif;
    m.set(k, x);
  }
  return [...m.values()];
}

const CONF = { alta: ['ok', 'Seguro'], media: ['warn', 'Revisar'], baja: ['bad', 'Dudoso'] };

export async function abrirEscaner(ctx, { gastos: gastosCurso, onDatos }) {
  const { state } = ctx;
  let cerrado = false;
  const cuerpo = h('div', { class: 'escaner-cuerpo' });
  const overlay = h('div', { class: 'overlay modal-center', onmousedown: (e) => { if (e.target === overlay) cerrar(); } },
    h('div', { class: 'dialog escaner', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'esc-t' },
      h('div', { class: 'escaner-cab' }, h('h3', { id: 'esc-t' }, 'Escanear factura'), h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Cerrar', onclick: () => cerrar() }, '✕')),
      cuerpo));
  const onKey = (e) => { if (e.key === 'Escape') cerrar(); };
  function cerrar() { cerrado = true; document.removeEventListener('keydown', onKey); overlay.remove(); }
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);

  // historial de todos los cursos (para reconocer al proveedor y copiar su clasificación)
  let historial = gastosCurso;
  Promise.all(state.cursosVisibles.map((c) => ctx.gastos(c.id).catch(() => []))).then((ls) => { historial = ls.flat(); }).catch(() => {});

  const inputArchivo = h('input', { type: 'file', accept: 'application/pdf,image/*', hidden: true, 'aria-label': 'Archivo de la factura', onchange: () => procesar(inputArchivo.files[0]) });
  const inputFoto = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, 'aria-label': 'Foto de la factura', onchange: () => procesar(inputFoto.files[0]) });
  const zona = h('div', { class: 'zona-escaner', tabindex: '0', role: 'button', 'aria-label': 'Elegir o arrastrar la factura', onclick: () => inputArchivo.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputArchivo.click(); } },
    ondragover: (e) => { e.preventDefault(); zona.classList.add('encima'); }, ondragleave: () => zona.classList.remove('encima'),
    ondrop: (e) => { e.preventDefault(); zona.classList.remove('encima'); procesar(e.dataTransfer.files[0]); } },
  h('strong', {}, 'Arrastra aquí la factura (PDF o foto)'), h('span', { class: 'muted small' }, 'o haz clic para elegirla. Se leen el proveedor, el NIF, la fecha, el número y el importe.'));
  clear(cuerpo, zona, h('div', { class: 'escaner-acciones' }, inputArchivo, inputFoto,
    h('button', { class: 'btn', type: 'button', onclick: () => inputArchivo.click() }, 'Elegir archivo'),
    h('button', { class: 'btn solo-movil', type: 'button', onclick: () => inputFoto.click() }, 'Hacer foto')));

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
    } catch (ex) {
      if (cerrado) return;
      clear(cuerpo, h('div', { class: 'banner error' }, 'No se ha podido leer la factura: ', ex.message),
        h('div', { class: 'escaner-acciones' }, h('button', { class: 'btn', onclick: () => abrirDeNuevo() }, 'Probar con otro archivo'),
          h('button', { class: 'btn', onclick: () => { cerrar(); onDatos({ }); } }, 'Crear el gasto a mano')));
      return;
    }
    if (cerrado) return;
    mostrar(file, texto, canvas, origen, confOcr);
  }
  function abrirDeNuevo() { cerrar(); abrirEscaner(ctx, { gastos: gastosCurso, onDatos }); }

  function mostrar(file, texto, canvas, origen, confOcr) {
    const conocidas = conocidasDe(historial, state.empresas);
    const r = analizarFactura(texto, { conocidas, propios: PROPIOS, nombreArchivo: file.name });
    const hoy = new Date().toISOString().slice(0, 10);
    if (r.fecha && r.fecha > hoy && r.confianza.fecha === 'alta') r.confianza.fecha = 'media';

    // último gasto de ese proveedor: de ahí salen categoría, método, periodicidad, tipo, centro…
    const prov = normalizar(r.empresa || '');
    const previos = prov ? historial.filter((g) => normalizar(g.empresa || '') === prov || (r.nif && g.nif === r.nif)) : [];
    const ultimo = [...previos].sort((a, b) => (b.fecha_factura || '').localeCompare(a.fecha_factura || ''))[0];
    const mes = mesDeFecha(r.fecha) || null;
    const cursoFecha = r.fecha ? state.cursosVisibles.find((c) => c.fecha_inicio <= r.fecha && r.fecha <= c.fecha_fin) : null;
    const centroId = ultimo?.centro_id || ctx.centroActual()?.id || ctx.centroPrincipal()?.id || null;
    const centro = state.centros.find((c) => c.id === centroId);
    const tn = normalizar(texto);
    const entidad = /alcantarilla/.test(normalizar(centro?.nombre)) ? 'Gastos MIMAG Alcantarilla' : (!/mimag/.test(tn) && /maria gomez/.test(tn) ? 'Gastos Maria' : 'Gastos MIMAG');
    const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, 'pdf'])[1];
    const ruta = rutaSugerida({ fecha: r.fecha, empresa: r.empresa, numero: r.numero, extension: ext, carpetaEntidad: entidad });
    const cat = state.taxonomia.find((c) => c.id === ultimo?.categoria_id);
    const sub = cat?.subcategorias.find((s) => s.id === ultimo?.subcategoria_id);
    const concepto = ultimo?.concepto ? ultimo.concepto.replace(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i, (m) => (mes ? mes.charAt(0).toUpperCase() + mes.slice(1) : m)) : '';
    const duplicado = r.empresa && historial.find((g) => normalizar(g.empresa || '') === prov && ((r.numero && g.factura_nr && normalizar(g.factura_nr) === normalizar(r.numero)) || (r.total && r.fecha && Math.abs(num(g.cantidad) - r.total) < 0.01 && g.fecha_factura === r.fecha)));

    const fila = (label, valor, conf, extra) => {
      const [cls, txt] = CONF[conf] || ['bad', 'No encontrado'];
      return h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, valor ?? h('span', { class: 'muted' }, '—'), extra ? h('span', { class: 'muted small' }, ` ${extra}`) : null),
        h('td', {}, h('span', { class: `conf ${valor == null || valor === '' ? 'bad' : cls}` }, valor == null || valor === '' ? 'No encontrado' : txt)));
    };
    const inpRuta = h('input', { type: 'text', value: `${ruta.carpeta}/${ruta.nombre}`, 'aria-label': 'Carpeta y nombre en OneDrive', class: 'input-ruta' });
    const nombreFinal = () => inpRuta.value.split('/').pop().trim() || ruta.nombre;
    const vista = canvas ? (() => { canvas.classList.add('escaner-preview'); return canvas; })() : null;
    const verTexto = h('details', { class: 'escaner-texto' }, h('summary', {}, `Texto leído (${origen === 'ocr' ? `OCR, confianza ${Math.round(confOcr || 0)}%` : 'PDF'})`), h('pre', {}, texto.slice(0, 6000)));

    const btnCrear = h('button', { class: 'btn primary', type: 'button', onclick: crear }, 'Revisar y crear el gasto');
    async function crear() {
      btnCrear.disabled = true; btnCrear.textContent = 'Subiendo la factura…';
      let link = null;
      try {
        const renombrado = new File([file], nombreFinal(), { type: file.type || 'application/pdf' });
        link = await subirFactura(renombrado, ruta.carpeta);
      } catch (ex) { toast('No se ha podido subir la factura (se crea el gasto sin adjunto): ' + ex.message, 'error'); }
      cerrar();
      onDatos({
        fecha_factura: r.fecha || hoy, empresa: r.empresa || '', factura_nr: r.numero || '', cantidad: r.total ?? '', nif: r.nif || ultimo?.nif || '',
        iban: ultimo?.iban || '', swift: ultimo?.swift || '', concepto,
        tipo: ultimo?.tipo || 'Factura', periodicidad: ultimo?.periodicidad || '', metodo_pago: ultimo?.metodo_pago || '',
        categoria_id: ultimo?.categoria_id || null, subcategoria_id: ultimo?.subcategoria_id || null,
        centro_id: centroId, mes: mes || undefined, curso_id: (cursoFecha || ctx.cursoActual()).id,
        link_factura: link, sin_factura: false,
        comentarios: `Escaneada${duplicado ? ' · OJO: posible duplicado' : ''}. OneDrive: Facturas & Nominas/${inpRuta.value}`,
      });
    }
    function descargar() {
      const url = URL.createObjectURL(file);
      const a = h('a', { href: url, download: nombreFinal() });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    clear(cuerpo,
      duplicado ? h('div', { class: 'banner warn' }, h('span', {}, h('strong', {}, 'Posible duplicado: '), `ya hay un gasto de ${duplicado.empresa} del ${fmtFecha(duplicado.fecha_factura)} por ${fmtEUR2(num(duplicado.cantidad))}${duplicado.factura_nr ? ` (nº ${duplicado.factura_nr})` : ''}.`)) : null,
      h('div', { class: 'escaner-res' },
        vista ? h('div', { class: 'escaner-vista' }, vista) : null,
        h('div', { class: 'escaner-datos' },
          h('table', { class: 'data escaner-tabla' }, h('tbody', {},
            fila('Proveedor', r.empresa, r.confianza.empresa, r.empresaNueva ? '(nuevo)' : null),
            fila('NIF', r.nif, r.confianza.nif),
            fila('Fecha factura', r.fecha ? fmtFecha(r.fecha) : null, r.confianza.fecha),
            fila('Nº factura', r.numero, r.confianza.numero),
            fila('Importe total', r.total != null ? fmtEUR2(r.total) : null, r.confianza.total, r.base != null && r.base !== r.total ? `(base ${fmtEUR2(r.base)})` : null),
            h('tr', {}, h('th', { scope: 'row' }, 'Clasificación'), h('td', { colspan: 2 }, ultimo
              ? [cat ? `${cat.nombre.charAt(0) + cat.nombre.slice(1).toLowerCase()} › ${sub?.nombre || '—'}` : '—', h('span', { class: 'muted small' }, ` · ${[ultimo.metodo_pago, ultimo.periodicidad].filter(Boolean).join(' · ')} · como el gasto del ${fmtFecha(ultimo.fecha_factura)}`)]
              : h('span', { class: 'muted' }, 'Proveedor sin gastos anteriores: elige la categoría en la ficha.'))))),
          h('label', { class: 'field' }, h('span', {}, 'Guardar en OneDrive como'), h('div', { class: 'ruta-onedrive' }, h('span', { class: 'muted small' }, 'Facturas & Nominas/'), inpRuta),
            h('span', { class: 'small muted', style: 'font-weight:400' }, 'Misma estructura que tu carpeta de la gestoría (trimestre y titular). La factura se adjunta al gasto con este nombre.')),
          h('div', { class: 'escaner-acciones' },
            h('button', { class: 'btn', type: 'button', onclick: abrirDeNuevo }, 'Otra factura'),
            h('button', { class: 'btn', type: 'button', onclick: descargar, title: 'Descarga el archivo con el nombre sugerido para guardarlo en la carpeta de OneDrive' }, 'Descargar renombrada'),
            btnCrear),
          verTexto)));
  }
}
