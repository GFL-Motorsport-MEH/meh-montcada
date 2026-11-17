-- 0014: área temporal para traer datos externos (p.ej. la hoja de Google) y compararlos con SQL. Solo admin.
create table if not exists public.importaciones (
  id bigserial primary key,
  nombre text not null,
  contenido text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.importaciones enable row level security;
create policy importaciones_admin on public.importaciones for all to authenticated
  using (public.es_admin()) with check (public.es_admin());
