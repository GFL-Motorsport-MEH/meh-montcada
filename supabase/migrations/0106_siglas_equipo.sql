-- siglas de cada persona (GF, MG, ML, PA) y responsables de tareas ligados a usuarios reales
alter table profiles add column if not exists siglas text;
update profiles set siglas='GF' where id='41afa3bf-ee03-4ea6-b43f-be15525e2476';
update profiles set siglas='MG', nombre='María Gómez Peñafiel' where id='1f7401c8-bacb-49f1-9a62-06d443f34efa';
update profiles set siglas='ML', nombre='María López' where id='0d697be8-1f3b-4d4d-b9ac-1472bf1fcdb7';
update profiles set siglas='PA' where id='fe286713-9024-41d0-aca1-874c8ecb646e';
update ac_tareas set asignado_a='fe286713-9024-41d0-aca1-874c8ecb646e', responsable=null where asignado_a is null and responsable='Paula';
update ac_tareas set asignado_a='0d697be8-1f3b-4d4d-b9ac-1472bf1fcdb7', responsable=null where asignado_a is null and responsable='María López';
update ac_tareas set responsable=null where asignado_a is not null and responsable is not null;

create or replace function public.equipo_tareas()
returns table (id uuid, nombre text, email text, activo boolean, rol text, sin_dinero boolean, siglas text)
language sql stable security definer set search_path = public as $$
    select p.id, p.nombre, p.email, p.activo, p.rol, p.sin_dinero, p.siglas from public.profiles p where p.activo and public.ac_acceso();
$$;
revoke execute on function public.equipo_tareas() from public, anon;
grant execute on function public.equipo_tareas() to authenticated;
