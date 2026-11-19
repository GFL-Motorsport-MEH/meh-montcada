-- Solicitudes de tutoría que llegan de las familias (formulario público de la web o importadas del formulario de Google).
-- Las familias NO tocan la tabla: escriben a través de la función «solicitar-tutoria» (service role).
-- El personal las ve con el permiso de Tutorías («todo») y las convierte en tutorías.
create table if not exists public.ac_tutorias_solicitudes (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    email text,
    alumno_texto text not null,
    adulto_texto text,
    tema text,
    asiste_profesora boolean,
    disponibilidad jsonb not null default '[]'::jsonb,   -- [{"dia":"Lunes","hora":"12:30"}]
    estado text not null default 'nueva' check (estado in ('nueva', 'procesada', 'descartada')),
    alumno_id uuid references public.ac_alumnos(id) on delete set null,
    tutoria_id uuid references public.ac_tutorias(id) on delete set null,
    origen text not null default 'web' check (origen in ('web', 'google')),
    origen_ref text,                                      -- clave para no duplicar importaciones
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create unique index if not exists ac_tutorias_solicitudes_ref_uq on public.ac_tutorias_solicitudes (origen_ref) where origen_ref is not null;
create index if not exists ac_tutorias_solicitudes_estado_idx on public.ac_tutorias_solicitudes (estado, created_at desc);

create trigger ac_tutorias_solicitudes_set_updated before update on public.ac_tutorias_solicitudes for each row execute procedure public.set_updated_audit();

alter table public.ac_tutorias_solicitudes enable row level security;
create policy leer on public.ac_tutorias_solicitudes for select to authenticated using (public.perm_ve('ac_tutorias'));
create policy insertar on public.ac_tutorias_solicitudes for insert to authenticated with check (public.perm_edita_todo('ac_tutorias'));
create policy modificar on public.ac_tutorias_solicitudes for update to authenticated using (public.perm_edita_todo('ac_tutorias')) with check (public.perm_edita_todo('ac_tutorias'));
create policy borrar on public.ac_tutorias_solicitudes for delete to authenticated using (public.perm_edita_todo('ac_tutorias'));
