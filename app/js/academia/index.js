// Módulo ACADEMIA. Todo su código vive en esta carpeta; main.js solo importa RUTAS_ACADEMIA y TABS_ACADEMIA.
import { renderResumen } from './resumen.js';
import { renderAlumnos } from './alumnos.js';
import { renderPagos } from './pagos.js';
import { renderRemesas } from './remesas.js';
import { renderSeguimiento } from './seguimiento.js';
import { renderTutorias } from './tutorias.js';
import { renderBajas } from './bajas.js';
import { renderHorarios } from './horarios.js';
import { renderCalendario } from './calendario.js';
import { renderTareas } from './tareas.js';
import { renderBiblioteca } from './biblioteca.js';
import { renderDocumentos } from './documentos.js';
import { renderImportar } from './importar.js';

// la hoja de estilos se carga solo al entrar en Academia (así no hay que tocar index.html)
let cssPuesto = false;
function estilos(render) {
  return (view, ctx) => {
    if (!cssPuesto) {
      cssPuesto = true;
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/academia.css'; document.head.append(l);
    }
    return render(view, ctx);
  };
}

const R = (titulo, render) => ({ titulo, render: estilos(render), modulo: 'academia' });
export const RUTAS_ACADEMIA = {
  academia: R('Academia', renderResumen),
  ac_alumnos: R('Alumnos', renderAlumnos),
  ac_pagos: R('Pagos', renderPagos),
  ac_remesas: R('Remesas', renderRemesas),
  ac_seguimiento: R('Seguimiento', renderSeguimiento),
  ac_tutorias: R('Tutorías', renderTutorias),
  ac_bajas: R('Bajas', renderBajas),
  ac_grupos: R('Grupos y horarios', renderHorarios),
  ac_calendario: R('Calendario', renderCalendario),
  ac_tareas: R('Tareas', renderTareas),
  ac_biblioteca: R('Biblioteca', renderBiblioteca),
  ac_documentos: R('Protocolos', renderDocumentos),
  ac_importar: R('Importar del Excel', renderImportar),
};
// pestañas visibles (ac_importar se abre desde el botón de Alumnos)
export const TABS_ACADEMIA = [
  ['academia', 'Resumen'], ['ac_alumnos', 'Alumnos'], ['ac_pagos', 'Pagos'], ['ac_remesas', 'Remesas'], ['ac_seguimiento', 'Seguimiento'], ['ac_tutorias', 'Tutorías'],
  ['ac_bajas', 'Bajas'], ['ac_grupos', 'Grupos y horarios'], ['ac_calendario', 'Calendario'], ['ac_tareas', 'Tareas'], ['ac_biblioteca', 'Biblioteca'], ['ac_documentos', 'Protocolos'],
];
