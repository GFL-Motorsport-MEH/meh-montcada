// Constantes y piezas comunes del módulo ALUMNOS.
import { h, fmtFecha } from '../ui.js';
import { leerV, guardarV } from '../vista.js';
import { pill, buscadorAlumno, nombreAlumno } from '../academia/kit.js';

export { fmtFecha };
export const PERIODOS = ['1T', '2T', '3T', 'Final', 'Test de nivel', 'Otro'].map((x) => [x, x]);
export const AREAS = ['Global', 'Speaking', 'Listening', 'Reading', 'Writing', 'Grammar', 'Vocabulary', 'Participación', 'Examen', 'Otro'].map((x) => [x, x]);
export const TIPOS_DOC = [['dni_responsable', 'DNI de padre / madre / tutor'], ['autorizacion_recogida', 'Autorización de recogida'], ['dni_autorizado', 'DNI de persona autorizada'], ['libro_familia', 'Libro de familia'],
  ['tarjeta_sanitaria', 'Tarjeta sanitaria'], ['autorizacion_imagen', 'Autorización de imagen'], ['otro', 'Otro']];
export const NOM_DOC = Object.fromEntries(TIPOS_DOC);
export const OBLIGATORIOS = ['dni_responsable', 'autorizacion_recogida', 'autorizacion_imagen']; // lo que debería tener cada alumno
export const ESTADOS_TAREA = [['pendiente', 'Pendiente'], ['entregada', 'Entregada'], ['revisada', 'Revisada']];
export const CANALES = [['portal', 'Portal'], ['email', 'Correo'], ['telefono', 'Teléfono'], ['whatsapp', 'WhatsApp'], ['presencial', 'En persona'], ['otro', 'Otro']];
export const TIPOS_NOTA = ['nota', 'llamada', 'familia', 'incidencia', 'progreso', 'tutoría'];
export const ESTADOS_DOC = [['revisado', 'Revisado'], ['pendiente', 'Pendiente de revisar'], ['rechazado', 'Rechazado']];

export const esActivo = (a) => a && (a.estado === 'inscrito' || a.estado === 'prematricula');
export const familiaPill = (v) => (v ? pill('visible para la familia', 'ok') : pill('interno', 'off'));
export const nota = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
export const media = (lista) => { const v = lista.map((x) => x.nota).filter((n) => n !== null && n !== undefined && n !== '').map(Number); return v.length ? v.reduce((s, n) => s + n, 0) / v.length : null; };
export const diasDesde = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

// ir a la ficha (o a otra pestaña) con un alumno ya elegido; todas las pantallas comparten esta elección
export const CLAVE_ALUMNO = 'al.alumno';
export function irA(ruta, alumnoId) { if (alumnoId) guardarV(CLAVE_ALUMNO, alumnoId); location.hash = `#/${ruta}`; }

// filtro «un alumno / todos» con buscador; se recuerda entre pantallas. Devuelve { el, get() }.
export function filtroAlumno(alumnos, alCambiar, { placeholder = 'Todos los alumnos (escribe para elegir uno)' } = {}) {
  let actual = leerV(CLAVE_ALUMNO, '');
  if (!alumnos.some((a) => a.id === actual)) actual = '';
  const b = buscadorAlumno(alumnos, { valorId: actual, placeholder });
  const aplicar = () => {
    const a = b.getAlumno();
    const v = a ? a.id : b.input.value.trim() === '' ? '' : actual;
    if (v === actual) return;
    actual = v; guardarV(CLAVE_ALUMNO, v); alCambiar(v);
  };
  b.input.addEventListener('change', aplicar);
  b.input.addEventListener('input', () => { if (!b.input.value) aplicar(); });
  const quitar = h('button', { class: 'btn small ghost', type: 'button', title: 'Ver todos los alumnos', onclick: () => { b.input.value = ''; aplicar(); } }, 'Todos');
  return { el: h('span', { class: 'al-filtro' }, b, quitar), get: () => actual };
}

export const nombreDe = (alumnos) => { const m = new Map(alumnos.map((a) => [a.id, a])); return (id) => nombreAlumno(m.get(id)); };

// casilla «visible para la familia»
export function casillaFamilia(valor, texto = 'Visible para la familia en el portal') {
  const i = h('input', { type: 'checkbox', checked: !!valor });
  const el = h('label', { class: 'al-check' }, i, ' ', texto);
  el.input = i;
  return el;
}
export const PERMISOS_ALUMNOS = ['al_ficha', 'al_notas', 'al_tareas', 'al_informes', 'al_comunicaciones', 'al_documentos', 'al_actividades'];
