// Módulo TRABAJADORES. Todo su código vive en esta carpeta; main.js solo importa RUTAS_TRABAJADORES y TABS_TRABAJADORES.
// Portal de cada trabajador (lo suyo: contrato, horario, bolsa de horas, nóminas y documentos) y su gestión por quien tenga permiso.
import { renderPortal } from './resumen.js';
import { renderDocumentos } from './documentos.js';
import { renderHoras } from './horas.js';
import { renderContrato } from './contrato.js';
import { renderEquipo } from './equipo.js';

// reutiliza las hojas de estilo de Academia (tablas, formularios) y añade la suya; se cargan solo al entrar
const CSS = ['/css/academia.css', '/css/trabajadores.css'];
function estilos(render) {
  return (view, ctx) => {
    for (const href of CSS) if (!document.querySelector(`link[href="${href}"]`)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.append(l); }
    return render(view, ctx);
  };
}
// alguno = basta con tener algún acceso (lo suyo o todo) a uno de estos permisos · todo = hace falta ver lo de todos en uno de ellos
const T = (titulo, render, regla) => ({ titulo, render: estilos(render), modulo: 'trabajadores', ...regla });
export const PERMISOS_TRABAJADORES = ['ac_portal', 'tr_horas', 'tr_contrato'];
export const RUTAS_TRABAJADORES = {
  tr_portal: T('Mi portal', renderPortal, { alguno: PERMISOS_TRABAJADORES }),
  tr_contrato: T('Contrato y horario', renderContrato, { alguno: ['tr_contrato'] }),
  tr_horas: T('Bolsa de horas', renderHoras, { alguno: ['tr_horas'] }),
  tr_documentos: T('Documentos', renderDocumentos, { alguno: ['ac_portal'] }),
  tr_equipo: T('Equipo', renderEquipo, { todo: PERMISOS_TRABAJADORES }),
};
export const TABS_TRABAJADORES = [['tr_portal', 'Mi portal'], ['tr_contrato', 'Contrato y horario'], ['tr_horas', 'Bolsa de horas'], ['tr_documentos', 'Documentos'], ['tr_equipo', 'Equipo']];
