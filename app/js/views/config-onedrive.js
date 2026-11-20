// Configuración > OneDrive (solo administradores): conectar la cuenta, ver el estado y anotar cuándo caduca el secreto de la app de Microsoft.
import { h, clear, cargando, toast, fmtFecha } from '../ui.js';
import * as od from '../onedrive.js';
import { registrarSeccionConfig } from './config.js';

async function renderOneDrive(cont, ctx) {
  clear(cont, cargando());
  const [est, cad] = await Promise.all([od.estado(true), od.caducidad().catch(() => null)]);
  if (/onedrive=ok/.test(location.hash)) { toast('OneDrive conectado'); history.replaceState(null, '', '#/config'); }
  const dias = od.diasHasta(cad);
  const aviso = dias !== null && dias <= 30
    ? h('div', { class: 'banner error', role: 'alert' }, dias < 0 ? 'El secreto de la app de Microsoft ha caducado: crea uno nuevo en Azure y cámbialo en Supabase (MS_CLIENT_SECRET).' : `El secreto de la app de Microsoft caduca en ${dias} días (${fmtFecha(cad)}). Crea uno nuevo en Azure, cámbialo en Supabase (MS_CLIENT_SECRET) y anota aquí la nueva fecha.`)
    : null;
  const mapa = () => {
    const estadoMapa = h('span', { class: 'small muted' }, '');
    const b = h('button', { class: 'btn', type: 'button', onclick: async () => {
      b.disabled = true; estadoMapa.textContent = ' Recorriendo tu OneDrive…';
      try { const n = await od.mapear(true, (t) => { estadoMapa.textContent = ` ${t} elementos leídos…`; }); estadoMapa.textContent = ` Listo: ${n} elementos.`; toast('Mapa de OneDrive terminado'); } catch (ex) { estadoMapa.textContent = ''; toast(ex.message, 'error'); }
      b.disabled = false;
    } }, 'Mapear mi OneDrive');
    return h('div', { class: 'filters' }, b, estadoMapa, h('span', { class: 'small muted' }, 'Solo lee nombres, tamaños y fechas de tus carpetas y archivos, no su contenido, para proponer una estructura ordenada.'));
  };
  const fecha = h('input', { type: 'date', class: 'cell', value: cad || '', 'aria-label': 'Caducidad del secreto' });
  clear(cont, h('div', { class: 'card' },
    h('h3', { class: 'sub-titulo' }, 'OneDrive'),
    aviso,
    h('p', {}, est.conectado ? `Conectado${est.cuenta ? ' con ' + est.cuenta : ''}. Los documentos del Portal del trabajador se guardan en la carpeta «${est.carpeta || 'MEH Web'}» de ese OneDrive.` : 'Sin conectar. Mientras no lo esté, los documentos se guardan en Supabase.'),
    ctx.esAdmin() ? h('div', { class: 'filters' }, h('button', { class: 'btn primary', type: 'button', onclick: async (e) => { e.target.disabled = true; try { await od.conectar(); } catch (ex) { toast(ex.message, 'error'); e.target.disabled = false; } } }, est.conectado ? 'Volver a conectar' : 'Conectar OneDrive')) : null,
    h('label', { class: 'field' }, h('span', {}, 'El secreto de la app de Microsoft caduca el'), fecha,
      h('span', { class: 'small muted' }, 'Es la fecha que muestra Azure junto al secreto. Avisaremos a los administradores 30 días antes.')),
    est.conectado && ctx.esAdmin() ? mapa() : null,
    h('button', { class: 'btn small', type: 'button', onclick: async () => { try { await od.guardarCaducidad(fecha.value); toast('Guardado'); renderOneDrive(cont, ctx); } catch (ex) { toast(ex.message, 'error'); } } }, 'Guardar fecha')));
}
registrarSeccionConfig('onedrive', renderOneDrive);
