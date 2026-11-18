// Espacio de PROGRAMACIONES: dos bloques vacíos que se irán llenando (programaciones de talleres, y de intensivos y cursos de Teens y Adultos).
// Por ahora solo existe el espacio; la información de Paula se volcará aquí y entonces se le dará forma.
import { h, clear } from '../ui.js';
import { cabecera } from './kit.js';

const BLOQUES = [
  ['Talleres', 'Programaciones de los talleres.'],
  ['Intensivos y cursos de Teens y Adultos', 'Programaciones de los intensivos y de los cursos de Teens y de Adultos.'],
];

export async function renderProgramaciones(view, ctx) {
  const curso = ctx.cursoActual();
  clear(view, cabecera(`Programaciones · ${curso.nombre}`, 'Espacio de trabajo de la coordinación académica'),
    h('div', { class: 'banner' }, h('strong', {}, 'Espacio preparado. '), 'Aquí se añadirán las programaciones; falta volcar la información de Paula y decidir cómo se organizan.'),
    h('div', { class: 'ac-dos-col' }, BLOQUES.map(([t, d]) => h('div', { class: 'card', 'data-bloque': t }, h('h3', { class: 'sub-titulo' }, t), h('p', { class: 'small muted' }, d), h('div', { class: 'card empty' }, 'Todavía no hay programaciones.')))));
}
