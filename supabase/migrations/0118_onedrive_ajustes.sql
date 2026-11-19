-- Ajustes visibles solo para administradores: fecha de caducidad del secreto de la app de Microsoft (para avisar con tiempo).
create table if not exists public.onedrive_ajustes (
  id int primary key default 1 check (id = 1),
  secreto_caduca date,
  updated_at timestamptz not null default now()
);
alter table public.onedrive_ajustes enable row level security;
create policy "admin gestiona ajustes onedrive" on public.onedrive_ajustes for all using (es_admin()) with check (es_admin());
grant select, insert, update on public.onedrive_ajustes to authenticated;
