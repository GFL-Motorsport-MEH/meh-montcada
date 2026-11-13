// Sustituto de pdf.js para las pruebas: devuelve como texto del PDF lo que haya en window.__textoFactura.
export const GlobalWorkerOptions = { set workerPort(w) { try { w.terminate(); } catch { /* */ } }, workerSrc: '' };
export function getDocument() {
  const lineas = String(window.__textoFactura || '').split('\n');
  const page = {
    getTextContent: async () => ({ items: lineas.map((s, i) => ({ str: s, transform: [1, 0, 0, 1, 20, 800 - i * 14], height: 10 })) }),
    getViewport: () => ({ width: 120, height: 160 }),
    render: () => ({ promise: Promise.resolve() }),
  };
  return { promise: Promise.resolve({ numPages: 1, getPage: async () => page }) };
}
