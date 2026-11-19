-- Mejoras software (Academia > Tareas): comentarios del equipo sobre cosas a mejorar de la app.
-- Cada una indica el módulo (facturación, academia o trabajadores) y la pestaña. Mismo permiso que Tareas (ac_tareas).
create table if not exists public.ac_mejoras_software (
    id uuid primary key default gen_random_uuid(),
    comentario text not null check (length(btrim(comentario)) > 0),
    modulo text not null check (modulo in ('facturacion', 'academia', 'trabajadores')),
    pestana text,
    estado text not null default 'pend' check (estado in ('pend', 'hecha')),
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id) on delete set null,
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id) on delete set null
);
create index if not exists ac_mejoras_software_modulo_idx on public.ac_mejoras_software (modulo, estado);

alter table public.ac_mejoras_software enable row level security;
create policy "leer" on public.ac_mejoras_software for select using (public.perm_ve('ac_tareas'));
create policy "insertar" on public.ac_mejoras_software for insert with check (public.perm_edita_todo('ac_tareas'));
create policy "modificar" on public.ac_mejoras_software for update using (public.perm_edita_todo('ac_tareas')) with check (public.perm_edita_todo('ac_tareas'));
-- borra quien la escribió o el administrador
create policy "borrar" on public.ac_mejoras_software for delete using (public.perm_edita_todo('ac_tareas') and (created_by = auth.uid() or public.rol_actual() = 'admin'));
grant select, insert, update, delete on public.ac_mejoras_software to authenticated;
create trigger ac_mejoras_software_set_updated before update on public.ac_mejoras_software for each row execute procedure public.set_updated_audit();
