-- Cada línea de un envío guarda su propia copia (nombre, responsable, IBAN, mandato, comentario),
-- para que un mes pasado se pueda ver y editar sin tocar nada del resto de la app.
alter table public.ac_remesa_envio_lineas
  add column if not exists alumno_nombre text,
  add column if not exists responsable_nombre text,
  add column if not exists iban text,
  add column if not exists ref_mandato text,
  add column if not exists comentario text;
