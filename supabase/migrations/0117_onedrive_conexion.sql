-- Conexión con OneDrive: token de renovación guardado solo para la función del servidor (RLS sin políticas).
create table if not exists public.onedrive_conexion (
  id int primary key default 1 check (id = 1),
  refresh_token text not null,
  cuenta text,
  updated_at timestamptz not null default now()
);
alter table public.onedrive_conexion enable row level security;
revoke all on public.onedrive_conexion from anon, authenticated;
