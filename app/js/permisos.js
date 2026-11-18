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
    { k: 'ac_biblioteca', t: 'Biblioteca', tipo: 'todo' },
    { k: 'ac_documentos', t: 'Protocolos', tipo: 'todo' },
  ] },
  { grupo: 'Facturación y contabilidad', items: [
    { k: 'fact', t: 'Contabilidad: Panel, Gastos, Ingresos, Balance, Facturación, Control y Configuración', tipo: 'todo', dinero: true },
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
const ACADEMIA = ['ac_alumnos', 'ac_pagos', 'ac_remesas', 'ac_seguimiento', 'ac_tutorias', 'ac_bajas', 'ac_grupos', 'ac_calendario', 'ac_recogidas', 'ac_tareas', 'ac_biblioteca', 'ac_documentos'];
const todoEdita = (ks) => Object.fromEntries(ks.map((k) => [k, 'todo:1']));
export const RECOMENDADOS = {
  direccion: { ac_resumen: 'todo:0', ...todoEdita(ACADEMIA), escaner: 'todo:1' },
  coordinacion: { ac_resumen: 'todo:0', ...todoEdita(ACADEMIA.filter((k) => !['ac_pagos', 'ac_remesas'].includes(k))) },
  profesora: { ac_grupos: 'propio:0', ac_calendario: 'todo:0', ac_tutorias: 'propio:1', ac_seguimiento: 'propio:1', ac_biblioteca: 'todo:1', ac_documentos: 'todo:0' },
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
    algunoAcademia: () => admin || [...mapa.keys()].some((k) => k.startsWith('ac_')),
  };
}
