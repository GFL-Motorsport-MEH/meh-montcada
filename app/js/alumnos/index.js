// Módulo ALUMNOS. Todo su código vive en esta carpeta; main.js solo importa RUTAS_ALUMNOS y TABS_ALUMNOS.
// Ficha 360º de cada alumno + notas, tareas y material, informes, comunicaciones, documentación y actividades de las familias.
// Está pensado como la parte «de gestión» del futuro portal de familias: lo que se marca como visible es lo que verán los padres.
// Las profesoras ven y editan a SUS alumnos (los de sus grupos y tutorías); coordinación y dirección, a todos (permisos al_*, ver permisos.js).
import { renderFicha } from './ficha.js';
import { renderNotas } from './notas.js';
import { renderTareas } from './tareas.js';
import { renderInformes } from './informes.js';
import { renderComunicaciones } from './comunicaciones.js';
import { renderDocumentosFamilia } from './documentos.js';
import { renderActividades } from './actividades.js';
import { renderStudyClub } from './studyclub.js';

// reutiliza las hojas de estilo de Academia (tablas, formularios) y añade la suya; se cargan solo al entrar
const CSS = ['/css/academia.css', '/css/alumnos.css'];
function estilos(render) {
  return (view, ctx) => {
    for (const href of CSS) if (!document.querySelector(`link[href="${href}"]`)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.append(l); }
    return render(view, ctx);
  };
}
const A = (titulo, render, perm) => ({ titulo, render: estilos(render), modulo: 'alumnos', alguno: [perm] });
export const RUTAS_ALUMNOS = {
  al_ficha: A('Ficha del alumno', renderFicha, 'al_ficha'),
  al_notas: A('Notas', renderNotas, 'al_notas'),
  al_tareas: A('Tareas y material', renderTareas, 'al_tareas'),
  al_informes: A('Informes y notas', renderInformes, 'al_informes'),
  al_comunicaciones: A('Comunicaciones', renderComunicaciones, 'al_comunicaciones'),
  al_documentos: A('Documentación', renderDocumentosFamilia, 'al_documentos'),
  al_actividades: A('Actividades', renderActividades, 'al_actividades'),
  al_studyclub: A('Study Club', renderStudyClub, 'al_studyclub'),
};
export const TABS_ALUMNOS = [['al_ficha', 'Ficha'], ['al_notas', 'Notas'], ['al_tareas', 'Tareas y material'], ['al_informes', 'Informes y notas'], ['al_comunicaciones', 'Comunicaciones'], ['al_documentos', 'Documentación'], ['al_actividades', 'Actividades'], ['al_studyclub', 'Study Club']];
