-- Orden de las tablas compartido: una sola vista posible por tabla (la última que alguien eligió), igual para todo el equipo.
create table if not exists public.ui_orden_tablas (
  clave text primary key,
  orden jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.ui_orden_tablas enable row level security;
create policy "orden tablas lectura" on public.ui_orden_tablas for select using (public.usuario_activo());
create policy "orden tablas alta" on public.ui_orden_tablas for insert with check (public.usuario_activo());
create policy "orden tablas cambio" on public.ui_orden_tablas for update using (public.usuario_activo()) with check (public.usuario_activo());
grant select, insert, update on public.ui_orden_tablas to authenticated;
