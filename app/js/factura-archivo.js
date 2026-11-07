// Subir y abrir los PDFs de facturas guardados en Storage.
import { h, toast } from './ui.js';
import { subirFactura, urlFactura } from './db.js';

export const esArchivoSubido = (link) => String(link || '').startsWith('storage:');

// Abre la factura en otra pestaña (la ventana se abre antes de pedir el enlace firmado para que el navegador no la bloquee)
export async function abrirFactura(link) {
  const w = window.open('', '_blank');
  try {
    const url = await urlFactura(link);
    if (!url) { w?.close(); toast('Esta factura no tiene un enlace que se pueda abrir.', 'error'); return; }
    if (w) { w.opener = null; w.location.href = url; } else window.location.href = url;
  } catch (ex) { w?.close(); toast('No se ha podido abrir la factura: ' + ex.message, 'error'); }
}

// Botón "Subir PDF": elige archivo, lo sube y llama a onSubido(link)
export function botonSubirFactura({ carpeta, onSubido, etiqueta = 'Subir PDF', clase = 'btn small' }) {
  const input = h('input', { type: 'file', accept: 'application/pdf,image/*', hidden: true, 'aria-label': 'Archivo de la factura' });
  const btn = h('button', { type: 'button', class: clase, onclick: () => input.click() }, etiqueta);
  input.addEventListener('change', async () => {
    const file = input.files[0]; input.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { toast('El archivo pasa de 20 MB.', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Subiendo…';
    try { const link = await subirFactura(file, carpeta()); await onSubido(link, file); }
    catch (ex) { toast('No se ha subido: ' + ex.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = etiqueta; }
  });
  return h('span', { class: 'subir-factura' }, input, btn);
}
