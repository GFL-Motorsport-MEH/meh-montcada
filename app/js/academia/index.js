// Módulo ACADEMIA. Todo su código vive en esta carpeta; main.js solo importa RUTAS_ACADEMIA y TABS_ACADEMIA.
import { renderResumen } from './resumen.js';
import { renderAlumnos } from './alumnos.js';
import { renderPagos } from './pagos.js';
import { renderRemesas } from './remesas.js';
import { renderRemesasMensuales } from './remesas_mensuales.js';
import { renderSeguimiento } from './seguimiento.js';
import { renderTutorias } from './tutorias.js';
import { renderBajas } from './bajas.js';
import { renderGrupos } from './grupos.js';
import { renderHorarios } from './horarios.js';
import { renderCalendario } from './calendario.js';
import { renderTareas } from './tareas.js';
import { renderImportarPagos } from './importar_pagos.js';
import { renderRecogidas, renderImportarRecogidas } from './recogidas.js';
import { renderImportarHorarios } from './importar_horarios.js';
import { renderBiblioteca, renderImportarBiblioteca } from './biblioteca.js';
import { renderDocumentos } from './documentos.js';
import { renderImportar } from './importar.js';
import { renderProgramaciones } from './programaciones.js';
import { renderCambioCurso } from './cambio_curso.js';

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

// perm = permiso (ver permisos.js) que da acceso a la pantalla; edita = además hace falta poder editar (pantallas de importar)
const R = (titulo, render, perm, edita = false, modulo = 'academia') => ({ titulo, render: estilos(render), modulo, perm, edita });
// Resumen, Pagos y Remesas (y el importador de pagos) viven en el módulo de Facturación; su código sigue aquí porque usa las tablas ac_*.
// El Resumen de Pagos ya no tiene pestaña: #/ac_resumen abre el Resumen de Ingresos (main.js). Pagos, Remesas y Facturación son sub-pestañas de Ingresos.
const F = (titulo, render, perm, edita = false) => R(titulo, render, perm, edita, 'facturacion');
export const RUTAS_ACADEMIA = {
  ac_resumen: F('Resumen', renderResumen, 'ac_resumen'),
  ac_pagos: F('Pagos', renderPagos, 'ac_pagos'),
  ac_remesas: F('Remesas', renderRemesas, 'ac_remesas'),
  ac_remesas_mensuales: F('Remesas mensuales', renderRemesasMensuales, 'ac_remesas'),
  ac_pagos_importar: F('Importar pagos', renderImportarPagos, 'ac_pagos', true),
  ac_alumnos: R('Alumnos', renderAlumnos, 'ac_alumnos'),
  ac_seguimiento: R('Seguimiento', renderSeguimiento, 'ac_seguimiento'),
  ac_tutorias: R('Tutorías', renderTutorias, 'ac_tutorias'),
  ac_bajas: R('Bajas', renderBajas, 'ac_bajas'),
  ac_grupos: R('Grupos', renderGrupos, 'ac_grupos'),
  ac_horarios: R('Horarios', renderHorarios, 'ac_calendario'),
  ac_calendario: R('Calendario', renderCalendario, 'ac_calendario'),
  ac_horarios_importar: R('Importar horarios', renderImportarHorarios, 'ac_grupos', true),
  ac_tareas: R('Tareas', renderTareas, 'ac_tareas'),
  ac_recogidas: R('Recogidas', renderRecogidas, 'ac_recogidas'),
  ac_recogidas_importar: R('Importar recogidas', renderImportarRecogidas, 'ac_recogidas', true),
  ac_biblioteca: R('Biblioteca y Mascotas', renderBiblioteca, 'ac_biblioteca'),
  ac_biblioteca_importar: R('Importar biblioteca y mascotas', renderImportarBiblioteca, 'ac_biblioteca', true),
  ac_documentos: R('Protocolos', renderDocumentos, 'ac_documentos'),
  ac_importar: R('Importar del Excel', renderImportar, 'ac_alumnos', true),
  ac_cambio_curso: R('Cambio de curso', renderCambioCurso, 'ac_alumnos', true),
  ac_programaciones: R('Programaciones', renderProgramaciones, 'ac_programaciones'),
};
// pestañas visibles (ac_importar se abre desde el botón de Alumnos)
export const TABS_ACADEMIA = [
  ['ac_alumnos', 'Alumnos'], ['ac_seguimiento', 'Seguimiento'], ['ac_tutorias', 'Tutorías'],
  ['ac_bajas', 'Bajas'], ['ac_grupos', 'Grupos'], ['ac_horarios', 'Horarios'], ['ac_calendario', 'Calendario'], ['ac_recogidas', 'Recogidas'], ['ac_tareas', 'Tareas'], ['ac_biblioteca', 'Biblioteca y Mascotas'], ['ac_documentos', 'Protocolos'], ['ac_programaciones', 'Programaciones'],
];
