-- 0122: Seguimiento (contactos): Nivel como desplegable que se rellena por la edad, columnas Cursos intensivos y Mañanas (SÍ/NO)
-- y alumno relacionado obligatorio cuando se conoce a través de un alumno. Idempotente.

-- ---------- ac_listas: nueva lista «nivel_contacto» + columnas de apoyo ----------
alter table public.ac_listas drop constraint if exists ac_listas_lista_check;
alter table public.ac_listas add constraint ac_listas_lista_check check (lista in
    ('modalidad', 'nivel', 'colegio', 'como_conocio', 'metodo_pago', 'motivo_baja', 'tipo_anotacion', 'situacion_contacto',
     'categoria_documento', 'descuento', 'nivel_contacto'));
alter table public.ac_listas add column if not exists edad_min integer;      -- nivel_contacto: edad (años) desde la que se propone solo
alter table public.ac_listas add column if not exists edad_max integer;      -- nivel_contacto: edad hasta la que se propone solo
alter table public.ac_listas add column if not exists pide_alumno boolean not null default false;  -- como_conocio: obliga a enlazar un alumno

insert into public.ac_listas (lista, valor, orden, color, edad_min, edad_max) values
    ('nivel_contacto', 'BABIES', 1, '#db2777', 0, 3),
    ('nivel_contacto', 'KIDS', 2, '#d9b72e', 4, 11),
    ('nivel_contacto', 'TEENS', 3, '#ea580c', 12, 17),
    ('nivel_contacto', 'ADULTS', 4, '#2563eb', 18, 120),
    ('nivel_contacto', 'ADULTS A2', 5, '#0891b2', null, null),
    ('nivel_contacto', 'ADULTS B1', 6, '#0f766e', null, null),
    ('nivel_contacto', 'ADULTS B2', 7, '#16a34a', null, null),
    ('nivel_contacto', 'ADULTS C1', 8, '#7c3aed', null, null),
    ('nivel_contacto', 'LEVEL 1', 9, '#f2c94c', null, null),
    ('nivel_contacto', 'LEVEL 2', 10, '#3b82f6', null, null),
    ('nivel_contacto', 'LEVEL 3', 11, '#f28b82', null, null),
    ('nivel_contacto', 'LEVEL 4', 12, '#43a85b', null, null),
    ('nivel_contacto', 'LEVEL 5', 13, '#1d1d1f', null, null),
    ('nivel_contacto', 'SPEAKING', 14, '#6b7280', null, null)
on conflict (lista, lower(valor)) do nothing;

update public.ac_listas set pide_alumno = true where lista = 'como_conocio' and valor in ('Familia de un alumno', 'Recomendación');

-- ---------- ac_contactos ----------
alter table public.ac_contactos add column if not exists fecha_nacimiento date;
alter table public.ac_contactos add column if not exists cursos_intensivos boolean not null default false;
alter table public.ac_contactos add column if not exists mananas boolean not null default false;
alter table public.ac_contactos add column if not exists alumno_referente_id uuid references public.ac_alumnos(id) on delete set null;
create index if not exists ac_contactos_referente_idx on public.ac_contactos (alumno_referente_id);

-- ---------- ordena lo que ya había ----------
-- Nivel con la letra de grupo del Excel («B KIDS», «D ADULTS A2») → sin la letra
update public.ac_contactos set nivel = regexp_replace(upper(nivel), '^[A-H] ', '')
    where upper(nivel) ~ '^[A-H] (BABIES|KIDS|TEENS|ADULTS)( (A2|B1|B2|C1))?$';
-- «H INTENSIVOS» era un curso intensivo, no un nivel
update public.ac_contactos set cursos_intensivos = true, nivel = null where upper(nivel) = 'H INTENSIVOS';
-- «MAÑANAS» estaba escrito en Situación: pasa a la columna Mañanas
update public.ac_contactos set mananas = true, situacion = 'POSIBLE ALUMNO', comentarios = trim(both ' ' from coalesce(comentarios || ' · ', '') || 'Mañanas')
    where upper(situacion) = 'MAÑANAS';
