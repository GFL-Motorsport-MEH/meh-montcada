-- Reuniones (Coordinación los lunes, Profesoras los martes, otras) con temas a tratar enlazables a tareas.
-- Las reuniones fijas se generan en pantalla; la fila se crea al apuntar el primer tema o las notas.
create table if not exists public.ac_reuniones (
    id uuid primary key default gen_random_uuid(),
    tipo text not null check (tipo in ('coordinacion', 'profesoras', 'otra')),
    fecha date not null,
    titulo text,
    notas text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create unique index if not exists ac_reuniones_tipo_fecha on public.ac_reuniones (tipo, fecha) where tipo <> 'otra';
create table if not exists public.ac_reunion_temas (
    id uuid primary key default gen_random_uuid(),
    reunion_id uuid not null references public.ac_reuniones(id),
    texto text not null,
    notas text,
    tratado boolean not null default false,
    tarea_id uuid,                       -- tarea enlazada (sin clave foránea: si se borra la tarea el enlace queda vacío)
    orden int not null default 0,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists ac_reunion_temas_reunion on public.ac_reunion_temas (reunion_id);
alter table public.ac_reuniones enable row level security;
alter table public.ac_reunion_temas enable row level security;
create policy "leer" on public.ac_reuniones for select using (public.perm_ve('ac_tareas'));
create policy "insertar" on public.ac_reuniones for insert with check (public.perm_edita_todo('ac_tareas'));
create policy "modificar" on public.ac_reuniones for update using (public.perm_edita_todo('ac_tareas')) with check (public.perm_edita_todo('ac_tareas'));
create policy "borrar" on public.ac_reuniones for delete using (public.perm_edita_todo('ac_tareas'));
create policy "leer" on public.ac_reunion_temas for select using (public.perm_ve('ac_tareas'));
create policy "insertar" on public.ac_reunion_temas for insert with check (public.perm_edita_todo('ac_tareas'));
create policy "modificar" on public.ac_reunion_temas for update using (public.perm_edita_todo('ac_tareas')) with check (public.perm_edita_todo('ac_tareas'));
create policy "borrar" on public.ac_reunion_temas for delete using (public.perm_edita_todo('ac_tareas'));
grant select, insert, update, delete on public.ac_reuniones, public.ac_reunion_temas to authenticated;
create trigger ac_reuniones_set_updated before update on public.ac_reuniones for each row execute procedure public.set_updated_audit();
create trigger ac_reunion_temas_set_updated before update on public.ac_reunion_temas for each row execute procedure public.set_updated_audit();
