-- Formularios públicos genéricos (sustituyen a los de Google): la definición vive en la base de datos,
-- la web pública (carpeta forms/, sitio aparte) los pinta y la función «formulario» valida y guarda las respuestas.
-- El personal las ve en Academia > Formularios y las procesa (una tutoría, una nota, etc.).
create table if not exists public.ac_formularios (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),   -- va en la dirección pública: /<slug>
    titulo text not null,
    descripcion text,
    mensaje_final text,                                              -- texto al enviar
    tipo text not null default 'generico' check (tipo in ('generico', 'tutoria')),   -- cómo se procesan las respuestas en la web
    campos jsonb not null default '[]'::jsonb,
    activo boolean not null default true,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create trigger ac_formularios_set_updated before update on public.ac_formularios for each row execute procedure public.set_updated_audit();

create table if not exists public.ac_formulario_respuestas (
    id uuid primary key default gen_random_uuid(),
    formulario_id uuid not null references public.ac_formularios(id) on delete cascade,
    created_at timestamptz not null default now(),
    datos jsonb not null,                       -- {id_del_campo: valor}
    estado text not null default 'nueva' check (estado in ('nueva', 'procesada', 'descartada')),
    alumno_id uuid references public.ac_alumnos(id) on delete set null,
    ref_tabla text,                             -- qué se creó al procesarla (p. ej. ac_tutorias)
    ref_id uuid,
    notas text,
    origen text not null default 'web' check (origen in ('web', 'google')),
    origen_ref text,
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create unique index if not exists ac_formulario_respuestas_ref_uq on public.ac_formulario_respuestas (formulario_id, origen_ref) where origen_ref is not null;
create index if not exists ac_formulario_respuestas_idx on public.ac_formulario_respuestas (formulario_id, estado, created_at desc);
create trigger ac_formulario_respuestas_set_updated before update on public.ac_formulario_respuestas for each row execute procedure public.set_updated_audit();

alter table public.ac_formularios enable row level security;
alter table public.ac_formulario_respuestas enable row level security;
create policy leer on public.ac_formularios for select to authenticated using (public.perm_ve('ac_formularios'));
create policy insertar on public.ac_formularios for insert to authenticated with check (public.perm_edita_todo('ac_formularios'));
create policy modificar on public.ac_formularios for update to authenticated using (public.perm_edita_todo('ac_formularios')) with check (public.perm_edita_todo('ac_formularios'));
create policy borrar on public.ac_formularios for delete to authenticated using (public.perm_edita_todo('ac_formularios'));
create policy leer on public.ac_formulario_respuestas for select to authenticated using (public.perm_ve('ac_formularios'));
create policy insertar on public.ac_formulario_respuestas for insert to authenticated with check (public.perm_edita_todo('ac_formularios'));
create policy modificar on public.ac_formulario_respuestas for update to authenticated using (public.perm_edita_todo('ac_formularios')) with check (public.perm_edita_todo('ac_formularios'));
create policy borrar on public.ac_formulario_respuestas for delete to authenticated using (public.perm_edita_todo('ac_formularios'));

insert into public.rol_permisos (rol, permiso, alcance, editar) values
    ('direccion', 'ac_formularios', 'todo', true), ('coordinacion', 'ac_formularios', 'todo', true)
on conflict (rol, permiso) do nothing;

-- Formulario de tutorías (mismos campos que el de Google «TUTORÍA PRESENCIAL»).
-- Tipos de campo: texto, email, telefono, textarea, numero, fecha, radio, select, casillas, rejilla, acepto.
-- «google» = trozos del encabezado del Excel de Google, para importar respuestas antiguas.
insert into public.ac_formularios (slug, titulo, descripcion, mensaje_final, tipo, campos) values (
    'tutoria', 'Solicitud de tutoría',
    'Cuéntanos qué te gustaría tratar y cuándo te viene bien. Nos pondremos en contacto contigo para confirmar el día y la hora.',
    'Hemos recibido tu solicitud. Nos pondremos en contacto contigo para confirmar la tutoría.', 'tutoria',
    $json$[
      {"id":"email","tipo":"email","etiqueta":"Correo electrónico","requerido":true,"google":["direccion de correo"]},
      {"id":"alumno","tipo":"texto","etiqueta":"Nombre completo del alumno","requerido":true,"google":["nombre alumno"]},
      {"id":"adulto","tipo":"texto","etiqueta":"Nombre completo del adulto","requerido":true,"google":["nombre adulto"]},
      {"id":"tema","tipo":"textarea","etiqueta":"Tema a tratar","requerido":true,"google":["tema a tratar"]},
      {"id":"asiste","tipo":"radio","etiqueta":"¿Necesitas que asista la profesora del alumno?","requerido":true,"opciones":["Sí","No"],"google":["asista la profesora"]},
      {"id":"disponibilidad","tipo":"rejilla","etiqueta":"Día y hora","requerido":true,
       "ayuda":"Es obligatorio elegir al menos un día y hora. Si te van bien varias opciones, marca todas las que puedas para ayudarnos a organizar la tutoría.",
       "filas":["12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","19:00","19:30","20:00"],
       "columnas":["Lunes","Martes","Miércoles","Jueves","Viernes"],"google":["dia y hora"]}
    ]$json$::jsonb
) on conflict (slug) do nothing;

-- Pasa a las respuestas genéricas lo que ya había en ac_tutorias_solicitudes (la tabla antigua se deja sin usar; se borrará más adelante).
insert into public.ac_formulario_respuestas (formulario_id, created_at, datos, estado, alumno_id, ref_tabla, ref_id, origen, origen_ref)
select f.id, s.created_at,
       jsonb_strip_nulls(jsonb_build_object('email', s.email, 'alumno', s.alumno_texto, 'adulto', s.adulto_texto, 'tema', s.tema,
           'asiste', case s.asiste_profesora when true then 'Sí' when false then 'No' end,
           'disponibilidad', coalesce((select jsonb_agg(jsonb_build_object('c', d->>'dia', 'f', d->>'hora')) from jsonb_array_elements(s.disponibilidad) d), '[]'::jsonb))),
       s.estado, s.alumno_id, case when s.tutoria_id is not null then 'ac_tutorias' end, s.tutoria_id, s.origen, coalesce(s.origen_ref, 'sol:' || s.id::text)
from public.ac_tutorias_solicitudes s cross join public.ac_formularios f
where f.slug = 'tutoria'
on conflict do nothing;
comment on table public.ac_tutorias_solicitudes is 'OBSOLETA: sustituida por ac_formulario_respuestas (migración 0123). Borrar cuando se compruebe la copia.';
