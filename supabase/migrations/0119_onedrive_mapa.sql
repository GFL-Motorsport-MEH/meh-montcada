-- Mapa de solo lectura de OneDrive (nombres, tamaños y fechas; nunca el contenido) para diseñar la estructura de carpetas.
create table if not exists public.onedrive_mapa (
  id text primary key,
  parent_id text,
  nombre text not null,
  carpeta boolean not null default false,
  tamano bigint,
  modificado timestamptz,
  mime text
);
create index if not exists onedrive_mapa_parent on public.onedrive_mapa(parent_id);
alter table public.onedrive_mapa enable row level security;
create policy "admin lee mapa onedrive" on public.onedrive_mapa for select using (es_admin());
grant select on public.onedrive_mapa to authenticated;
alter table public.onedrive_ajustes add column if not exists mapa_next text;
alter table public.onedrive_ajustes add column if not exists mapa_listo boolean not null default false;
