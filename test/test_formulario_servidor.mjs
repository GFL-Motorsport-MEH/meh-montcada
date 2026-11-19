// Prueba de la validación y corrección de la función pública «formulario» (la parte pura, extraída del index.ts).
// Uso: node --experimental-strip-types test/test_formulario_servidor.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../supabase/functions/formulario/index.ts', import.meta.url), 'utf8');
const trozo = src.slice(src.indexOf('const limpia'), src.indexOf('Deno.serve')).replace('function validar', 'export function validar');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'val-')); const f = path.join(dir, 'validar.ts'); fs.writeFileSync(f, trozo);
const { validar } = await import(f);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok:', m); };

const campos = [
  { id: 'email', tipo: 'email', etiqueta: 'Correo', requerido: true },
  { id: 'curso', tipo: 'radio', etiqueta: 'Curso', requerido: true, opciones: ['KIDS', 'TEENS'] },
  { id: 'sec_k', tipo: 'seccion', etiqueta: 'Kids', si: { campo: 'curso', op: 'es', valor: 'KIDS' } },
  { id: 'dias', tipo: 'casillas', etiqueta: 'Días', requerido: true, opciones: ['L', 'M', 'X'] },
  { id: 'sec_t', tipo: 'seccion', etiqueta: 'Teens', si: { campo: 'curso', op: 'es', valor: 'TEENS' } },
  { id: 'nivel', tipo: 'select', etiqueta: 'Nivel', requerido: true, opciones: ['B1', 'B2'] },
  { id: 'ayuda', tipo: 'info', etiqueta: 'x', ayuda: 'y' },
  { id: 'gusta', tipo: 'escala', etiqueta: 'Valora', min: 1, max: 5, requerido: true },
  { id: 'otro', tipo: 'texto', etiqueta: 'Otro', si: { campo: 'gusta', op: 'es', valor: '1|2' }, requerido: true },
];
let r = validar(campos, { email: 'A@b.es', curso: 'KIDS', dias: ['L'], nivel: 'B1', gusta: 5 });
ok(!r.error && r.datos.dias[0] === 'L' && r.datos.email === 'a@b.es', 'página condicional visible: se pide y guarda');
ok(!('nivel' in r.datos), 'página oculta: no se guarda lo que llegue de ella');
r = validar(campos, { email: 'a@b.es', curso: 'TEENS', nivel: 'B2', gusta: 3 });
ok(!r.error && r.datos.nivel === 'B2' && !('dias' in r.datos), 'otra rama: no pide los campos obligatorios de la página oculta');
ok(validar(campos, { email: 'a@b.es', curso: 'KIDS', gusta: 3 }).error?.includes('Días'), 'obligatorio de la página visible: se exige');
ok(validar(campos, { email: 'a@b.es', curso: 'TEENS', nivel: 'B2', gusta: 2 }).error?.includes('Otro'), 'condición por valor: «Otro» se exige si la valoración es 1 o 2');
ok(!validar(campos, { email: 'a@b.es', curso: 'TEENS', nivel: 'B2', gusta: 5, otro: 'x' }).datos.otro, 'condición no cumplida: «Otro» se descarta');
ok(validar(campos, { email: 'a@b.es', curso: 'TEENS', nivel: 'B2', gusta: 9 }).error, 'escala fuera de rango rechazada');
ok(validar(campos, { email: 'a@b.es', curso: 'MEDIANOCHE', nivel: 'B2', gusta: 3 }).error, 'opción inventada rechazada');
ok(validar(campos, { email: 'no-es-correo', curso: 'TEENS', gusta: 3 }).error?.includes('correo'), 'correo no válido rechazado');

const test = [
  { id: 'q1', tipo: 'radio', etiqueta: 'Q1', opciones: ['a', 'b'], correcta: 'b', puntos: 2 },
  { id: 'q2', tipo: 'select', etiqueta: 'Q2', opciones: ['x', 'y'], correcta: 'x' },
  { id: 'q3', tipo: 'casillas', etiqueta: 'Q3', opciones: ['1', '2', '3'], correcta: ['1', '3'] },
  { id: 'q4', tipo: 'texto', etiqueta: 'Q4', correcta: 'Barcelona|BCN' },
  { id: 'libre', tipo: 'texto', etiqueta: 'Libre' },
];
r = validar(test, { q1: 'b', q2: 'y', q3: ['3', '1'], q4: 'bcn', libre: 'hola' });
ok(r.puntos === 4 && r.max === 5, `puntuación: 2 + 0 + 1 + 1 = 4 de 5 (salió ${r.puntos}/${r.max})`);
r = validar(test, { q1: 'a', q3: ['1'], q4: ' barcelóna ' });
ok(r.puntos === 1 && r.max === 5, 'sin tildes ni mayúsculas en texto libre; casillas exige el conjunto exacto; en blanco = 0');
ok(validar([{ id: 'a', tipo: 'texto', etiqueta: 'A' }], { a: 'x' }).max === undefined, 'sin respuestas correctas no hay nota');
console.log(`${n} comprobaciones OK`);
