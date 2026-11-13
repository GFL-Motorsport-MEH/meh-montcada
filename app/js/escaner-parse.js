// Lectura de datos de una factura a partir de su texto (PDF digital u OCR). Sin DOM: se prueba con node.
// Devuelve lo que encuentra con una "confianza" sencilla por campo; lo que no está claro se deja vacío para revisarlo.

const MESES_ES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dic: 12 };
export const normalizar = (s) => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------- importes ----------
const RE_IMPORTE = /(?<![\d.,])(-?\d{1,3}(?:[.\s]\d{3})+,\d{2}|-?\d+,\d{2}|-?\d{1,3}(?:,\d{3})+\.\d{2}|-?\d+\.\d{2})(?![\d])\s*(€|eur\b|euros?)?/gi;
export function leerImporte(txt) {
  const s = String(txt).replace(/\s/g, '');
  let n;
  if (/,\d{2}$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.'));
  else n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
export function importesEn(linea) {
  const out = [];
  for (const m of linea.matchAll(RE_IMPORTE)) {
    const v = leerImporte(m[1]);
    if (v !== null) out.push({ v, euro: !!m[2], pos: m.index });
  }
  return out;
}

// ---------- fechas ----------
const pad = (n) => String(n).padStart(2, '0');
function fechaValida(y, m, d) {
  if (y < 100) y += 2000;
  if (y < 2015 || y > 2040 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const f = new Date(Date.UTC(y, m - 1, d));
  return f.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}
export function fechasEn(linea) {
  const out = [];
  const l = normalizar(linea);
  for (const m of l.matchAll(/(?<!\d)(\d{1,2})\s?[/.-]\s?(\d{1,2})\s?[/.-]\s?(\d{4}|\d{2})(?!\d)/g)) { const f = fechaValida(+m[3], +m[2], +m[1]); if (f) out.push({ f, pos: m.index }); }
  for (const m of l.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) { const f = fechaValida(+m[1], +m[2], +m[3]); if (f) out.push({ f, pos: m.index }); }
  for (const m of l.matchAll(/(?<!\d)(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})\.?\s*(?:de\s+|del?\s+)?(\d{4})(?!\d)/g)) {
    const mes = MESES_ES[m[2]]; if (mes) { const f = fechaValida(+m[3], mes, +m[1]); if (f) out.push({ f, pos: m.index }); }
  }
  return out.sort((a, b) => a.pos - b.pos);
}

// ---------- NIF / CIF ----------
const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';
export function nifValido(raw) {
  const s = raw.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^ES(?=[0-9A-Z]{9}$)/, '');
  if (/^\d{8}[A-Z]$/.test(s)) return LETRAS_DNI[Number(s.slice(0, 8)) % 23] === s[8] ? s : null;
  if (/^[XYZ]\d{7}[A-Z]$/.test(s)) return LETRAS_DNI[Number('XYZ'.indexOf(s[0]) + s.slice(1, 8)) % 23] === s[8] ? s : null;
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(s)) {
    const d = s.slice(1, 8).split('').map(Number);
    let sum = 0;
    d.forEach((n, i) => { if (i % 2 === 0) { const x = n * 2; sum += Math.floor(x / 10) + (x % 10); } else sum += n; });
    const ctrl = (10 - (sum % 10)) % 10;
    const c = s[8];
    return c === String(ctrl) || c === 'JABCDEFGHI'[ctrl] ? s : null;
  }
  return null;
}
export function nifsEn(texto) {
  const out = [];
  const re = /(?<![A-Z0-9])(?:ES[\s-]?)?([A-Z][\s-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s-]?[0-9A-J]|\d{8}[\s-]?[A-Z]|[XYZ][\s-]?\d{7}[\s-]?[A-Z])(?![A-Z0-9])/gi;
  for (const m of texto.toUpperCase().matchAll(re)) {
    const v = nifValido(m[1]);
    if (v && !out.some((x) => x.nif === v)) out.push({ nif: v, pos: m.index });
  }
  return out;
}

// ---------- número de factura ----------
const RE_NUM = [
  /(?:n[ºo°.]?\s*(?:de\s*)?factura|factura\s*(?:n[ºo°.]?|num(?:ero)?\.?|n[uú]mero)|n[uú]mero\s*(?:de\s*)?(?:la\s*)?factura|num\.?\s*factura|invoice\s*(?:number|no\.?|#|n[ºo°]))\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-/._]{2,24})/i,
  /\bfactura\s*[:#]\s*([A-Z0-9][A-Z0-9\-/._]{2,24})/i,
  /\b(?:fra|fact)\.?\s*n?[ºo°.]?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/._]{2,24})/i,
];
function limpiarNumero(n) {
  return n.replace(/[._/-]+$/, '').trim();
}
function pareceNumero(n) {
  return /\d/.test(n) && !/^(19|20)\d{2}$/.test(n) && !fechasEn(n).length && n.length >= 3;
}

// ---------- empresa ----------
const VACIAS = new Set(['sl', 'slu', 'sa', 'sau', 'scp', 'sll', 'cb', 'de', 'del', 'la', 'las', 'los', 'el', 'y', 'i', 'com', 'www', 'es', 'net', 'org', 'grupo', 'group',
  'servicios', 'seguros', 'gestoria', 'sociedad', 'limitada', 'anonima', 'espana', 'spain', 'iberia', 'europe', 'factura', 'academia', 'english', 'house',
  'ayuntamiento', 'ajuntament', 'registro', 'mercantil', 'normal', 'montcada', 'reixac', 'barcelona', 'murcia', 'alcantarilla', 'valencia', 'madrid', 'catalunya', 'cataluna', 'mollet', 'valles', 'castello', 'clientes', 'cliente']);
const tokens = (s) => normalizar(s).replace(/[^a-z0-9ñ]+/g, ' ').split(' ').filter((t) => t.length >= 3 && !VACIAS.has(t));
function dist1(a, b) { // ¿distancia de edición <= 1?
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++dif > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return dif + (a.length - i) + (b.length - j) <= 1;
}
// puntuación 0..1 de un nombre conocido dentro de un conjunto de palabras del texto
function puntuarNombre(nombre, palabras, porInicio) {
  const tk = tokens(nombre);
  if (!tk.length) return 0;
  let ok = 0, largo = false;
  for (const t of tk) {
    const hit = palabras.has(t) || (t.length >= 5 && (porInicio.get(t.slice(0, 2)) || []).some((w) => w.length >= 5 && dist1(w, t)));
    if (hit) { ok++; if (t.length >= 5) largo = true; }
  }
  return largo ? ok / tk.length : 0;
}
function indexar(texto) {
  const palabras = new Set(normalizar(texto).replace(/[^a-z0-9ñ]+/g, ' ').split(' ').filter((t) => t.length >= 3));
  const porInicio = new Map();
  for (const w of palabras) { const k = w.slice(0, 2); if (!porInicio.has(k)) porInicio.set(k, []); porInicio.get(k).push(w); }
  return { palabras, porInicio };
}
function mejorNombre(texto, conocidas) {
  const { palabras, porInicio } = indexar(texto);
  let mejor = null;
  for (const e of conocidas) {
    const sc = puntuarNombre(e.nombre, palabras, porInicio);
    if (sc >= 0.5 && (!mejor || sc > mejor.sc || (sc === mejor.sc && e.nombre.length > mejor.nombre.length))) mejor = { nombre: e.nombre, sc };
  }
  return mejor;
}
// Línea con forma de razón social (S.L., S.A., …) junto al NIF del proveedor
const RE_SOCIEDAD = /\b(s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?c\.?\s?p\.?|s\.?\s?l\.?\s?l\.?)\s*$/i;
function razonSocialCerca(lineas, nif) {
  const i = lineas.findIndex((l) => l.toUpperCase().replace(/[^0-9A-Z]/g, '').includes(nif));
  const rango = i >= 0 ? [...lineas.slice(Math.max(0, i - 4), i + 3)] : lineas.slice(0, 6);
  const l = rango.map((x) => x.replace(/\s+(mimag|my english house).*$/i, '')).find((x) => RE_SOCIEDAD.test(x.replace(/[,.]+$/, '.')) && x.length < 60);
  return l ? l.replace(/[,]?\s*(s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?c\.?\s?p\.?|s\.?\s?l\.?\s?l\.?)\s*$/i, '').replace(/^(raz[oó]n social|emisor|proveedor)\s*:?\s*/i, '').trim() : null;
}
const titulo = (s) => s.toLowerCase().replace(/(^|[\s(-])\S/g, (c) => c.toUpperCase());

// ---------- principal ----------
export function analizarFactura(texto, { conocidas = [], propios = [], nombreArchivo = '' } = {}) {
  const lineas = texto.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const nl = lineas.map(normalizar);
  const res = { empresa: null, nif: null, fecha: null, numero: null, total: null, base: null, iva: null, nifs: [], confianza: {} };

  // NIF del proveedor: cualquiera que no sea uno de los nuestros (propios: NIF o nombres del titular)
  const propiosNif = propios.map((p) => nifValido(p)).filter(Boolean);
  const propiosTxt = propios.filter((p) => !nifValido(p)).map((p) => normalizar(p)).filter((p) => p.length > 3);
  const todos = nifsEn(texto);
  res.nifs = todos.map((x) => x.nif);
  const ajenos = todos.filter((x) => !propiosNif.includes(x.nif));
  // quitar nuestro nombre del texto para no confundirlo con el proveedor
  let sinPropios = normalizar(texto);
  for (const p of propiosTxt) sinPropios = sinPropios.split(p).join(' ');
  const porNif = ajenos.map((x) => conocidas.find((e) => e.nif && nifValido(e.nif) === x.nif)).find(Boolean);
  const porArchivo = nombreArchivo ? mejorNombre(nombreArchivo.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '), conocidas) : null;
  const porTexto = mejorNombre(sinPropios, conocidas);
  if (porNif) { res.empresa = porNif.nombre; res.confianza.empresa = 'alta'; }
  else if (porArchivo && porArchivo.sc >= 0.5) { res.empresa = porArchivo.nombre; res.confianza.empresa = 'media'; }
  else if (porTexto && porTexto.sc >= 0.99) { res.empresa = porTexto.nombre; res.confianza.empresa = 'media'; }
  else {
    const rs = ajenos.length ? razonSocialCerca(lineas, ajenos[0].nif) : null;
    const deArchivo = (nombreArchivo.replace(/\.[a-z0-9]+$/i, '').split(/\s+-\s+|_/)[0] || '').trim();
    const archivoUtil = deArchivo.length >= 3 && /[a-z]{3}/i.test(deArchivo) && !/^(factura|fra|invoice|doc|documento|scan|escaneo|img|image|imagen|whatsapp|foto|photo|pdf|download|descarga)\b/i.test(deArchivo);
    if (rs) { res.empresa = titulo(rs); res.confianza.empresa = 'baja'; res.empresaNueva = true; }
    else if (archivoUtil) { res.empresa = deArchivo.replace(/-.*$/, '').trim(); res.confianza.empresa = 'baja'; res.empresaNueva = true; }
    else if (porTexto) { res.empresa = porTexto.nombre; res.confianza.empresa = 'baja'; }
  }
  if (ajenos.length) { res.nif = ajenos[0].nif; res.confianza.nif = porNif ? 'alta' : 'media'; }

  // fecha de factura
  for (let i = 0; i < nl.length && !res.fecha; i++) {
    if (/fecha\s*(de\s*)?(la\s*)?(factura|emision|expedicion)|fecha\s*fra|invoice\s*date|data\s*(de\s*)?(la\s*)?factura/.test(nl[i])) {
      const f = fechasEn(lineas[i].slice(nl[i].search(/fecha|invoice|data/))).concat(fechasEn(lineas[i + 1] || ''));
      if (f.length) { res.fecha = f[0].f; res.confianza.fecha = 'alta'; }
    }
  }
  if (!res.fecha) {
    for (let i = 0; i < nl.length && !res.fecha; i++) {
      if (/vencimiento|periodo|desde|hasta|consumo|lectura|pedido/.test(nl[i])) continue;
      const f = fechasEn(lineas[i]);
      if (f.length) { res.fecha = f[0].f; res.confianza.fecha = 'baja'; }
    }
  }

  // número de factura
  for (let i = 0; i < lineas.length && !res.numero; i++) {
    for (const re of RE_NUM) {
      let m = lineas[i].match(re);
      if (!m && re === RE_NUM[0] && /factura$|n[ºo°]\.?$/i.test(lineas[i]) && lineas[i + 1]) m = (lineas[i] + ' ' + lineas[i + 1]).match(re);
      if (m && pareceNumero(limpiarNumero(m[1]))) { res.numero = limpiarNumero(m[1]); res.confianza.numero = 'alta'; break; }
    }
  }
  if (!res.numero && nombreArchivo) {
    const base = nombreArchivo.replace(/\.[a-z0-9]+$/i, '');
    const m = base.match(/(?:factura|fra|invoice|n[º°])[\s_-]*([A-Z0-9][A-Z0-9-/]{3,})/i) || base.match(/([A-Z]{1,4}[-_]?\d{2,4}[-_]\d{3,}|[A-Z]{1,3}\d{5,}|\d{6,})/);
    if (m) { res.numero = m[1]; res.confianza.numero = 'baja'; }
  }

  // importes: total (puntuación por palabra clave), base imponible e IVA
  let mejor = null;
  const puntuar = (l) => {
    if (/concepto|cantidad|unitario|descripcion|precio/.test(l)) return 0; // cabecera de tabla
    if (/total\s*(de\s*la\s*)?(importe\s*)?(factura|a\s*pagar|iva\s*incl|inc\.?\s*iva|con\s*iva|pendiente|recibo)|importe\s*total\s*(de\s*la\s*)?factura|total\s*a\s*abonar|importe\s*a\s*pagar|a\s*pagar\b|liquido\s*a\s*percibir/.test(l)) return 4;
    if (/importe\s*total|total\s*general|total\s*(eur|€)/.test(l)) return 3;
    if (/\btotal\b/.test(l) && !/subtotal|total\s*(base|iva|impuesto|neto|bruto|descuento|cuota)|base\s*imponible/.test(l)) return 2;
    return 0;
  };
  for (let i = 0; i < lineas.length; i++) {
    const p = puntuar(nl[i]);
    if (p) {
      let imps = importesEn(lineas[i].slice(nl[i].search(/total|importe|pagar|abonar|liquido/)));
      if (!imps.length && lineas[i + 1]) imps = importesEn(lineas[i + 1]);
      for (const x of imps) {
        if (x.v <= 0) continue;
        const score = p * 10 + (x.euro ? 1 : 0);
        // con palabra clave fuerte gana la primera (en PDFs con varias facturas, la primera); con «Total» a secas, la mayor
        if (!mejor || score > mejor.score || (score === mejor.score && score < 40 && x.v > mejor.v)) mejor = { v: x.v, score };
      }
    }
    if (/base\s*imp(onible|osable)|^base\b|importe\s*neto|subtotal|total\s*neto/.test(nl[i]) && res.base === null) {
      const imps = importesEn(lineas[i]).concat(importesEn(lineas[i + 1] || '')).filter((x) => x.v > 0);
      if (imps.length) res.base = imps[0].v;
    }
    if (/\b(iva|i\.v\.a)\b/.test(nl[i]) && !/base|incl|sin iva|exento/.test(nl[i]) && res.iva === null) {
      const imps = importesEn(lineas[i]).filter((x) => x.v > 0 && !(x.v === 21 || x.v === 10 || x.v === 4));
      if (imps.length) res.iva = imps[imps.length - 1].v;
    }
  }
  if (mejor) { res.total = mejor.v; res.confianza.total = mejor.score >= 40 ? 'alta' : 'media'; }
  else {
    const todosImp = lineas.flatMap(importesEn).filter((x) => x.v > 0);
    const conEuro = todosImp.filter((x) => x.euro);
    const lista = conEuro.length ? conEuro : todosImp;
    if (lista.length) { res.total = Math.max(...lista.map((x) => x.v)); res.confianza.total = 'baja'; }
  }
  // si lo que parece el total es en realidad la base, y en el documento está la base con IVA (21/10/4 %), se usa esa
  if (res.total) {
    const todos = lineas.flatMap(importesEn).map((x) => x.v);
    const conIva = [1.21, 1.1, 1.04].map((r) => Math.round(res.total * r * 100) / 100).find((v) => todos.some((x) => Math.abs(x - v) < 0.015));
    if (conIva && (res.base === null || Math.abs(res.base - res.total) < 0.01)) { res.base = res.total; res.total = conIva; }
  }
  // comprobación base + IVA = total
  if (res.total && res.base && res.iva && Math.abs(res.base + res.iva - res.total) < 0.02) res.confianza.total = 'alta';
  return res;
}

// Carpeta y nombre sugeridos, como en OneDrive: "Facturas & Nominas\2026 4T\Gastos MIMAG\Empresa_Numero.pdf"
export function rutaSugerida({ fecha, empresa, numero, extension = 'pdf', carpetaEntidad = 'Gastos MIMAG' }) {
  const f = fecha || new Date().toISOString().slice(0, 10);
  const trimestre = `${f.slice(0, 4)} ${Math.floor((Number(f.slice(5, 7)) - 1) / 3) + 1}T`;
  const limpio = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '');
  const nombre = [limpio(empresa) || 'Factura', limpio(numero) || f].join('_') + '.' + extension.toLowerCase();
  return { trimestre, carpeta: `${trimestre}/${carpetaEntidad}`, nombre };
}
