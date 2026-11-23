// Sustituto de pdf.js para las pruebas: devuelve como texto del PDF lo que haya en window.__textoFactura
// (o, si hay varias páginas, una página por elemento de window.__paginasPdf).
export const GlobalWorkerOptions = { set workerPort(w) { try { w.terminate(); } catch { /* */ } }, workerSrc: '' };
const pagina = (texto) => {
  const lineas = String(texto || '').split('\n');
  return {
    getTextContent: async () => ({ items: lineas.map((s, i) => ({ str: s, transform: [1, 0, 0, 1, 20, 800 - i * 14], height: 10 })) }),
    getViewport: () => ({ width: 120, height: 160 }),
    render: () => ({ promise: Promise.resolve() }),
  };
};
export function getDocument() {
  const pags = Array.isArray(window.__paginasPdf) && window.__paginasPdf.length ? window.__paginasPdf : [window.__textoFactura];
  return { promise: Promise.resolve({ numPages: pags.length, getPage: async (n) => pagina(pags[n - 1]) }) };
}
