-- El escáner (también el rol «escaner», que no lee la tabla empresas) necesita el listado de empresas
-- para vincular el proveedor por nombre comercial, razón social o CIF.
create or replace function public.escaner_empresas()
returns table (id uuid, nombre_comercial text, razon_social text, cif text, iban text)
language sql stable security definer set search_path = public as $$
  select e.id, e.nombre_comercial, nullif(trim(e.razon_social), ''), nullif(trim(e.cif), ''), nullif(trim(e.iban), '')
  from public.empresas e
  where public.usuario_habilitado() and e.nombre_comercial is not null and trim(e.nombre_comercial) <> ''
  order by lower(e.nombre_comercial)
$$;
revoke execute on function public.escaner_empresas() from public, anon;
grant execute on function public.escaner_empresas() to authenticated;
