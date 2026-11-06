-- Listado de empresas / proveedores (hoja Empresas del Excel).
-- nombre_comercial = el nombre que se usa en los gastos (columna Empresa); razon_social = nombre fiscal.
-- fecha_registro: se rellena sola para las empresas nuevas; las importadas del Excel quedan sin fecha.
create table if not exists public.empresas (
    id uuid primary key default gen_random_uuid(),
    nombre_comercial text not null,
    razon_social text,
    cif text,
    iban text,
    fecha_registro date default current_date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid references public.profiles(id) default auth.uid(),
    updated_by uuid references public.profiles(id)
);
create unique index if not exists empresas_nombre_idx on public.empresas (lower(nombre_comercial));

alter table public.empresas enable row level security;
create policy "empleados leen empresas" on public.empresas for select to authenticated using (public.usuario_activo());
create policy "empleados escriben empresas" on public.empresas for insert to authenticated with check (public.usuario_activo());
create policy "empleados editan empresas" on public.empresas for update to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy "admin borra empresas" on public.empresas for delete to authenticated using (public.es_admin());
create trigger empresas_set_updated before update on public.empresas for each row execute procedure public.set_updated_audit();

-- Carga inicial: todas las empresas usadas en los gastos, con el NIF/IBAN mas repetido en sus gastos.
insert into public.empresas (nombre_comercial, cif, iban, fecha_registro)
select e.empresa,
       (select g.nif from public.gastos g where g.empresa = e.empresa and coalesce(trim(g.nif), '') not in ('', '0')
         group by g.nif order by count(*) desc limit 1),
       (select g.iban from public.gastos g where g.empresa = e.empresa and coalesce(trim(g.iban), '') not in ('', '0')
         group by g.iban order by count(*) desc limit 1),
       null
from (select distinct trim(empresa) as empresa from public.gastos where coalesce(trim(empresa), '') <> '') e
on conflict do nothing;
