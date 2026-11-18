// Módulo ACADEMIA. Todo su código vive en esta carpeta; main.js solo importa RUTAS_ACADEMIA, TABS_ACADEMIA y TABS_COBROS.
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
import { renderImportarPagos } from './importar_pagos.js';
import { renderRecogidas, renderImportarRecogidas } from './recogidas.js';
import { renderImportarHorarios } from './importar_horarios.js';
import { renderBiblioteca, renderImportarBiblioteca } from './biblioteca.js';
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

const R = (titulo, render, modulo = 'academia') => ({ titulo, render: estilos(render), modulo });
// Resumen, Pagos y Remesas (y el importador de pagos) viven en el módulo de Facturación; su código sigue aquí porque usa las tablas ac_*.
// El Resumen debería desaparecer cuando Ingresos cubra lo mismo.
const F = (titulo, render) => R(titulo, render, 'facturacion');
export const RUTAS_ACADEMIA = {
  ac_resumen: F('Resumen', renderResumen),
  ac_pagos: F('Pagos', renderPagos),
  ac_remesas: F('Remesas', renderRemesas),
  ac_pagos_importar: F('Importar pagos', renderImportarPagos),
  ac_alumnos: R('Alumnos', renderAlumnos),
  ac_seguimiento: R('Seguimiento', renderSeguimiento),
  ac_tutorias: R('Tutorías', renderTutorias),
  ac_bajas: R('Bajas', renderBajas),
  ac_grupos: R('Grupos y horarios', renderHorarios),
  ac_calendario: R('Calendario', renderCalendario),
  ac_horarios_importar: R('Importar horarios', renderImportarHorarios),
  ac_tareas: R('Tareas', renderTareas),
  ac_recogidas: R('Recogidas', renderRecogidas),
  ac_recogidas_importar: R('Importar recogidas', renderImportarRecogidas),
  ac_biblioteca: R('Biblioteca', renderBiblioteca),
  ac_biblioteca_importar: R('Importar biblioteca', renderImportarBiblioteca),
  ac_documentos: R('Protocolos', renderDocumentos),
  ac_importar: R('Importar del Excel', renderImportar),
};
// pestañas visibles (ac_importar se abre desde el botón de Alumnos)
export const TABS_ACADEMIA = [
  ['ac_alumnos', 'Alumnos'], ['ac_seguimiento', 'Seguimiento'], ['ac_tutorias', 'Tutorías'],
  ['ac_bajas', 'Bajas'], ['ac_grupos', 'Grupos y horarios'], ['ac_calendario', 'Calendario'], ['ac_recogidas', 'Recogidas'], ['ac_tareas', 'Tareas'], ['ac_biblioteca', 'Biblioteca'], ['ac_documentos', 'Protocolos'],
];
// pestañas de Academia que se muestran dentro de Facturación
export const TABS_COBROS = [['ac_resumen', 'Resumen'], ['ac_pagos', 'Pagos'], ['ac_remesas', 'Remesas']];
