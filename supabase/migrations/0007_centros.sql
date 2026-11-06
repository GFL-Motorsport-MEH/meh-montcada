-- Centros (ListasNuevas > CENTROS). Cada gasto pertenece a un centro; los existentes van a MONTCADA (principal).
-- Los ingresos aun no llevan centro: cuentan como del centro principal.
create table if not exists public.centros (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    principal boolean not null default false,
    activo boolean not null default true,
    orden integer not null default 0,
    created_at timestamptz not null default now()
);
create unique index if not exists centros_nombre_idx on public.centros (lower(nombre));
create unique index if not exists centros_principal_idx on public.centros (principal) where principal;

alter table public.centros enable row level security;
create policy "empleados leen centros" on public.centros for select to authenticated using (public.usuario_activo());
create policy "admin gestiona centros" on public.centros for all to authenticated using (public.es_admin()) with check (public.es_admin());

insert into public.centros (nombre, principal, orden) values ('MONTCADA', true, 0), ('ALCANTARILLA', false, 1)
on conflict do nothing;

create or replace function public.centro_principal()
returns uuid language sql stable set search_path = public as $$
    select id from public.centros where principal limit 1
$$;

alter table public.gastos add column if not exists centro_id uuid references public.centros(id) default public.centro_principal();
update public.gastos set centro_id = public.centro_principal() where centro_id is null;
create index if not exists gastos_centro_idx on public.gastos (centro_id);
