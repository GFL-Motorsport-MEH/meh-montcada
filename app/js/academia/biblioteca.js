// Biblioteca de libros: de momento solo un recordatorio. Falta el Excel actual para diseñar las tablas.
import { h, clear } from '../ui.js';
import { cabecera } from './kit.js';

const PLAN = [
  ['Catálogo', 'Cada libro con título, nivel, editorial, código/etiqueta y número de ejemplares.'],
  ['Préstamos', 'Quién se lleva cada libro (alumno), fecha de salida y fecha prevista de devolución.'],
  ['Devoluciones y estado', 'Quién lo trae de vuelta, en qué estado vuelve (nuevo, bueno, desgastado, perdido) y anotaciones.'],
  ['Avisos', 'Libros pendientes de devolver o fuera de plazo, por alumno y por grupo.'],
];

export async function renderBiblioteca(view) {
  clear(view,
    cabecera('Biblioteca', 'Gestión de los libros que se prestan a los alumnos'),
    h('div', { class: 'banner warn' }, h('strong', {}, 'Pendiente de hacer. '), 'Falta pasar el Excel de la biblioteca para diseñar la estructura con las columnas reales. Esta pestaña queda aquí para que no se olvide.'),
    h('div', { class: 'plan-academia' }, PLAN.map(([t, d]) => h('div', { class: 'card plan-item' }, h('h3', {}, t), h('p', { class: 'small muted' }, d)))),
    h('div', { class: 'small muted' }, 'Los préstamos se enlazarán con la ficha de cada alumno (igual que cuotas, bajas y tutorías), para que el nombre sea siempre el mismo.'));
}
