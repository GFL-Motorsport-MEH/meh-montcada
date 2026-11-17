// ZIP (sin compresión) y hojas Excel (.xlsx) sencillas, sin librerías externas.
const enc = new TextEncoder();
let TABLA = null;
function crc32(bytes) {
  if (!TABLA) {
    TABLA = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TABLA[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const aBytes = (d) => (d instanceof Uint8Array ? d : typeof d === 'string' ? enc.encode(d) : new Uint8Array(d));

// archivos: [{ nombre: 'carpeta/archivo.pdf', datos: Uint8Array | ArrayBuffer | string, fecha?: Date }]
export function crearZip(archivos) {
  const partes = [], central = [];
  let offset = 0;
  const usados = new Set();
  for (const a of archivos) {
    let nombre = a.nombre.replace(/\\/g, '/');
    // nombres repetidos -> "archivo (2).pdf"
    for (let i = 2; usados.has(nombre.toLowerCase()); i++) nombre = a.nombre.replace(/(\.[^./]+)?$/, ` (${i})$1`);
    usados.add(nombre.toLowerCase());
    const datos = aBytes(a.datos), nom = enc.encode(nombre), crc = crc32(datos);
    const f = a.fecha || new Date();
    const hora = (f.getHours() << 11) | (f.getMinutes() << 5) | (f.getSeconds() >> 1);
    const dia = ((f.getFullYear() - 1980) << 9) | ((f.getMonth() + 1) << 5) | f.getDate();
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true); loc.setUint16(8, 0, true);
    loc.setUint16(10, hora, true); loc.setUint16(12, dia, true); loc.setUint32(14, crc, true);
    loc.setUint32(18, datos.length, true); loc.setUint32(22, datos.length, true); loc.setUint16(26, nom.length, true); loc.setUint16(28, 0, true);
    partes.push(new Uint8Array(loc.buffer), nom, datos);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
    cen.setUint16(12, hora, true); cen.setUint16(14, dia, true); cen.setUint32(16, crc, true); cen.setUint32(20, datos.length, true); cen.setUint32(24, datos.length, true);
    cen.setUint16(28, nom.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nom);
    offset += 30 + nom.length + datos.length;
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true);
  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)], { type: 'application/zip' });
}

// ---------- XLSX ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const col = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
function serialFecha(iso) { const [y, m, d] = iso.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5; }

// hojas: [{ nombre, filas: [[...], ...] }] — la primera fila es la cabecera (en negrita).
// Números -> número con 2 decimales si los tienen; 'YYYY-MM-DD' -> fecha; el resto, texto.
export function crearXlsx(hojas) {
  const archivos = [];
  const sheets = hojas.map((hj, n) => {
    const filas = hj.filas.map((fila, r) => `<row r="${r + 1}">${fila.map((v, c) => {
      const ref = `${col(c)}${r + 1}`;
      if (v === null || v === undefined || v === '') return '';
      if (r === 0) return `<c r="${ref}" t="inlineStr" s="1"><is><t>${esc(v)}</t></is></c>`;
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${Number.isInteger(v) ? 0 : 2}"><v>${v}</v></c>`;
      if (typeof v === 'boolean') return `<c r="${ref}" t="inlineStr"><is><t>${v ? 'Sí' : 'No'}</t></is></c>`;
      if (typeof v === 'string' && ISO.test(v)) return `<c r="${ref}" s="3"><v>${serialFecha(v)}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const anchos = (hj.filas[0] || []).map((_, c) => Math.min(60, Math.max(8, ...hj.filas.slice(0, 300).map((f) => String(f[c] ?? '').length + 2))));
    archivos.push({ nombre: `xl/worksheets/sheet${n + 1}.xml`, datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${anchos.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${filas}</sheetData>${hj.filas.length > 1 ? `<autoFilter ref="A1:${col(Math.max(0, (hj.filas[0] || []).length - 1))}${hj.filas.length}"/>` : ''}</worksheet>` });
    return `<sheet name="${esc(String(hj.nombre).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))}" sheetId="${n + 1}" r:id="rId${n + 1}"/>`;
  });
  archivos.unshift(
    { nombre: '[Content_Types].xml', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, n) => `<Override PartName="/xl/worksheets/sheet${n + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { nombre: '_rels/.rels', datos: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { nombre: 'xl/workbook.xml', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.join('')}</sheets></workbook>` },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, n) => `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n + 1}.xml"/>`).join('')}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { nombre: 'xl/styles.xml', datos: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
  );
  return crearZip(archivos);
}

export function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
