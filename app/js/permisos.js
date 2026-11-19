// Catálogo de permisos que se pueden dar a cada rol (la matriz se edita en Usuarios > Permisos de los roles).
// Cada permiso se guarda en la tabla rol_permisos como (rol, permiso, alcance, editar). La base de datos aplica los
// mismos permisos en sus políticas de seguridad: aquí solo se decide qué pestañas y botones se enseñan.
//
// tipo del permiso (qué niveles se pueden elegir):
//   'propio' -> sin acceso · ver lo suyo · editar lo suyo · ver todo · editar todo   («lo suyo» = lo asignado a su ficha de profesora)
//   'todo'   -> sin acceso · ver · editar
//   'ver'    -> sin acceso · ver
//   'si'     -> no · sí
export const GRUPOS_PERMISOS = [
  { grupo: 'Academia', items: [
    { k: 'ac_resumen', t: 'Resumen', tipo: 'ver' },
    { k: 'ac_alumnos', t: 'Alumnos (fichas e importar)', tipo: 'todo' },
    { k: 'ac_pagos', t: 'Pagos (cuotas, DNI e IBAN de las familias)', tipo: 'todo', dinero: true },
    { k: 'ac_remesas', t: 'Remesas', tipo: 'todo', dinero: true },
    { k: 'ac_seguimiento', t: 'Seguimiento (captación y anotaciones de alumnos)', tipo: 'propio' },
    { k: 'ac_tutorias', t: 'Tutorías', tipo: 'propio' },
    { k: 'ac_bajas', t: 'Bajas', tipo: 'todo' },
    { k: 'ac_grupos', t: 'Grupos (y sus alumnos)', tipo: 'propio' },
    { k: 'ac_calendario', t: 'Horarios (franjas, parrilla, profesoras y aulas) y Calendario anual', tipo: 'propio' },
    { k: 'ac_recogidas', t: 'Recogidas', tipo: 'todo' },
    { k: 'ac_tareas', t: 'Tareas (las de dinero solo con permiso de Pagos)', tipo: 'todo' },
    { k: 'ac_biblioteca', t: 'Biblioteca y Mascotas', tipo: 'todo' },
    { k: 'ac_documentos', t: 'Protocolos', tipo: 'todo' },
    { k: 'ac_programaciones', t: 'Programaciones (talleres, intensivos y cursos)', tipo: 'todo' },
    { k: 'ac_formularios', t: 'Formularios (respuestas de las familias y su procesado)', tipo: 'todo' },
  ] },
  { grupo: 'Trabajadores (portal del trabajador)', items: [
    { k: 'ac_portal', t: 'Documentos (nóminas, contratos y certificados: «lo suyo» = los suyos; «todo» = los de todos)', tipo: 'propio', dinero: true },
    { k: 'tr_contrato', t: 'Contrato y horario de contrato', tipo: 'propio' },
    { k: 'tr_horas', t: 'Bolsa de horas', tipo: 'propio' },
  ] },
  { grupo: 'Alumnos (ficha y portal de familias)', items: [
    { k: 'al_ficha', t: 'Ficha del alumno (vista completa: «lo suyo» = sus alumnos, los de sus grupos y tutorías)', tipo: 'propio' },
    { k: 'al_notas', t: 'Notas (evaluaciones)', tipo: 'propio' },
    { k: 'al_tareas', t: 'Tareas extra y material didáctico', tipo: 'propio' },
    { k: 'al_informes', t: 'Informes y notas de las profesoras', tipo: 'propio' },
    { k: 'al_comunicaciones', t: 'Comunicaciones con las familias', tipo: 'propio' },
    { k: 'al_documentos', t: 'Documentación de las familias (DNI, autorizaciones…)', tipo: 'propio' },
    { k: 'al_actividades', t: 'Actividades y apuntados', tipo: 'todo' },
  ] },
  { grupo: 'Facturación y contabilidad', items: [
    { k: 'fact', t: 'Contabilidad: Panel, Gastos, Ingresos, Balance, Facturación, Control y Listados y datos', tipo: 'todo', dinero: true },
    { k: 'escaner', t: 'Escáner de gastos (solo añade gastos, que quedan pendientes de revisar)', tipo: 'si' },
  ] },
];
export const TODOS_PERMISOS = GRUPOS_PERMISOS.flatMap((g) => g.items);
export const PERMISO = Object.fromEntries(TODOS_PERMISOS.map((p) => [p.k, p]));

// valor de cada celda de la matriz: '' = sin acceso, 'propio:0' = ver lo suyo, 'propio:1' = editar lo suyo, 'todo:0' = ver todo, 'todo:1' = editar todo
export const OPCIONES = {
  propio: [['', 'Sin acceso'], ['propio:0', 'Ver lo suyo'], ['propio:1', 'Editar lo suyo'], ['todo:0', 'Ver todo'], ['todo:1', 'Editar todo']],
  todo: [['', 'Sin acceso'], ['todo:0', 'Ver'], ['todo:1', 'Editar']],
  ver: [['', 'Sin acceso'], ['todo:0', 'Ver']],
  si: [['', 'No'], ['todo:1', 'Sí']],
};
export const celda = (fila) => (fila ? `${fila.alcance}:${fila.editar ? 1 : 0}` : '');
export const aFila = (valor) => { const [alcance, e] = valor.split(':'); return { alcance, editar: e === '1' }; };

// Valores recomendados de cada rol (los mismos que siembra la migración 0105). El administrador no se guarda: siempre tiene todo.
const ACADEMIA = ['ac_alumnos', 'ac_pagos', 'ac_remesas', 'ac_seguimiento', 'ac_tutorias', 'ac_bajas', 'ac_grupos', 'ac_calendario', 'ac_recogidas', 'ac_tareas', 'ac_biblioteca', 'ac_documentos', 'ac_programaciones', 'ac_formularios'];
const todoEdita = (ks) => Object.fromEntries(ks.map((k) => [k, 'todo:1']));
const ALUMNOS = ['al_ficha', 'al_notas', 'al_tareas', 'al_informes', 'al_comunicaciones', 'al_documentos', 'al_actividades'];
export const RECOMENDADOS = {
  direccion: { ac_resumen: 'todo:0', ...todoEdita(ACADEMIA), ...todoEdita(ALUMNOS), ac_portal: 'todo:1', tr_contrato: 'todo:1', tr_horas: 'todo:1', escaner: 'todo:1' },
  coordinacion: { ac_resumen: 'todo:0', ...todoEdita(ACADEMIA.filter((k) => !['ac_pagos', 'ac_remesas'].includes(k))), ...todoEdita(ALUMNOS), ac_portal: 'propio:0', tr_contrato: 'propio:0', tr_horas: 'propio:0' },
  // profesora: lo de sus alumnos (sin la documentación de las familias, que lleva DNI)
  profesora: { ac_grupos: 'propio:0', ac_calendario: 'todo:0', ac_tutorias: 'propio:1', ac_seguimiento: 'propio:1', ac_biblioteca: 'todo:1', ac_documentos: 'todo:0', ac_programaciones: 'todo:0', ac_portal: 'propio:0', tr_contrato: 'propio:0', tr_horas: 'propio:0',
    al_ficha: 'propio:0', al_notas: 'propio:1', al_tareas: 'propio:1', al_informes: 'propio:1', al_comunicaciones: 'propio:1', al_actividades: 'todo:0' },
  escaner: { escaner: 'todo:1' },
};

// Construye la función de permisos del usuario actual a partir de su rol y de las filas de rol_permisos.
export function crearPermisos(rol, filas) {
  const admin = rol === 'admin';
  const mapa = new Map((filas || []).filter((f) => f.rol === rol).map((f) => [f.permiso, f]));
  const alcance = (k) => (admin ? 'todo' : mapa.get(k)?.alcance || null);
  return {
    alcance,
    ve: (k) => alcance(k) === 'todo',          // ve todo
    propio: (k) => alcance(k) === 'propio',    // solo lo suyo
    veAlgo: (k) => alcance(k) !== null,        // algo de acceso (lo suyo o todo)
    edita: (k) => admin || !!mapa.get(k)?.editar,
    algunoAcademia: () => admin || [...mapa.keys()].some((k) => k.startsWith('ac_') || k.startsWith('tr_') || k.startsWith('al_')), // Academia, Trabajadores o Alumnos (para saber si es un usuario «solo escáner»)
  };
}
