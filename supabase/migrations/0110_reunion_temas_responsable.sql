-- Temas de reunión asignables a una persona (usuario de la app).
-- Sin clave foránea, igual que tarea_id: si el usuario desaparece, el tema queda sin responsable visible.
alter table public.ac_reunion_temas add column if not exists asignado_a uuid;
