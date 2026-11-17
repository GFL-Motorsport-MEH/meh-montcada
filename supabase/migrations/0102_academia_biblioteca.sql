-- Biblioteca: préstamos de libros y de «mascotas viajeras» (Excel BIBLIOTECA-MASCOTAS).
create table if not exists public.ac_prestamos (
    id uuid primary key default gen_random_uuid(),
    tipo text not null default 'libro' check (tipo in ('libro', 'mascota')),
    alumno_id uuid references public.ac_alumnos(id) on delete set null,
    alumno_texto text,            -- nombre tal cual venía en el Excel si no se pudo enlazar con un alumno
    adulto text,                  -- adulto que recoge / se responsabiliza
    libro text,                   -- título (libros)
    nivel text,                   -- nivel (mascotas viajeras)
    fecha_salida date,
    fecha_devolucion date,
    condiciones text,
    notas text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists ac_prestamos_alumno_idx on public.ac_prestamos (alumno_id);
create index if not exists ac_prestamos_pend_idx on public.ac_prestamos (tipo, fecha_salida) where fecha_devolucion is null;

create trigger ac_prestamos_set_updated before update on public.ac_prestamos for each row execute procedure public.set_updated_audit();

alter table public.ac_prestamos enable row level security;
create policy leer on public.ac_prestamos for select to authenticated using (public.usuario_activo());
create policy insertar on public.ac_prestamos for insert to authenticated with check (public.puede_editar());
create policy modificar on public.ac_prestamos for update to authenticated using (public.puede_editar()) with check (public.puede_editar());
create policy borrar on public.ac_prestamos for delete to authenticated using (public.puede_editar());
