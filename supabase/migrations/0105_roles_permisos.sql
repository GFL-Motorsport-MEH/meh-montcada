-- =====================================================================
-- 0105: roles con permisos editables desde la web
--
-- Antes: 4 roles fijos (admin, empleado, consulta, escaner) con los permisos escritos en las políticas.
-- Ahora: cada rol tiene una lista de permisos en la tabla rol_permisos que el administrador cambia a mano
--        en la web (Usuarios > Permisos de los roles). Las políticas de seguridad (RLS) leen esa tabla,
--        así que lo que se marca en la web es lo que de verdad se aplica en la base de datos.
--
-- Roles: admin (siempre todo, no se puede limitar), direccion, coordinacion, profesora, escaner.
-- Cada permiso tiene un alcance: 'todo' o 'propio' (solo lo que tiene asignado la profesora) y si puede editar.
-- «Lo suyo» de una profesora se calcula con su ficha de profesora (ac_profesoras.profile_id):
--   · grupos y horarios: los grupos donde ella es la profesora (del grupo o de alguna sesión)
--   · tutorías: las que tienen su ficha como profesora
--   · seguimiento: los alumnos de sus grupos o con tutoría suya
--
-- Solo CREATE / ALTER (las políticas se cambian con ALTER POLICY).
-- =====================================================================

-- ---------- roles y permisos ----------
create table if not exists public.roles (
    rol text primary key,
    nombre text not null,
    descripcion text,
    orden integer not null default 0,
    created_at timestamptz not null default now()
);

create table if not exists public.rol_permisos (
    rol text not null references public.roles(rol) on update cascade on delete cascade,
    permiso text not null,
    alcance text not null default 'todo' check (alcance in ('propio', 'todo')),
    editar boolean not null default false,
    primary key (rol, permiso)
);

alter table public.roles enable row level security;
alter table public.rol_permisos enable row level security;

-- ---------- funciones de permisos ----------
create or replace function public.rol_actual()
returns text language sql stable security definer set search_path = public as $$
    select rol from public.profiles where id = auth.uid() and activo;
$$;

-- 'todo' | 'propio' | null (sin acceso). El administrador siempre tiene 'todo'.
create or replace function public.perm_alcance(p text)
returns text language sql stable security definer set search_path = public as $$
    select case when pr.rol = 'admin' then 'todo'
                else (select rp.alcance from public.rol_permisos rp where rp.rol = pr.rol and rp.permiso = p) end
    from public.profiles pr where pr.id = auth.uid() and pr.activo;
$$;

create or replace function public.perm_edita(p text)
returns boolean language sql stable security definer set search_path = public as $$
    select coalesce((select pr.rol = 'admin' or exists (select 1 from public.rol_permisos rp where rp.rol = pr.rol and rp.permiso = p and rp.editar)
                     from public.profiles pr where pr.id = auth.uid() and pr.activo), false);
$$;

create or replace function public.perm_ve(p text)
returns boolean language sql stable security definer set search_path = public as $$
    select coalesce(public.perm_alcance(p) = 'todo', false);
$$;

create or replace function public.perm_edita_todo(p text)
returns boolean language sql stable security definer set search_path = public as $$
    select coalesce(public.perm_alcance(p) = 'todo', false) and public.perm_edita(p);
$$;

-- alguno de los permisos con alcance «todo»
create or replace function public.perm_ve_alguno(variadic p text[])
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from unnest(p) x where public.perm_alcance(x) = 'todo');
$$;
-- alguno de los permisos con alcance «propio»
create or replace function public.perm_propio_alguno(variadic p text[])
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from unnest(p) x where public.perm_alcance(x) = 'propio');
$$;
-- alguno de los permisos con cualquier alcance
create or replace function public.perm_alguno(variadic p text[])
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from unnest(p) x where public.perm_alcance(x) is not null);
$$;

-- ¿tiene el usuario algún permiso de Academia?
create or replace function public.ac_acceso()
returns boolean language sql stable security definer set search_path = public as $$
    select coalesce((select pr.rol = 'admin' or exists (select 1 from public.rol_permisos rp where rp.rol = pr.rol and rp.permiso like 'ac\_%')
                     from public.profiles pr where pr.id = auth.uid() and pr.activo), false);
$$;

-- ---------- «lo suyo» de una profesora ----------
create or replace function public.mi_profesora()
returns uuid language sql stable security definer set search_path = public as $$
    select id from public.ac_profesoras where profile_id = auth.uid() limit 1;
$$;

create or replace function public.es_mi_grupo(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.ac_grupos x where x.id = g and x.profesora_id = public.mi_profesora())
        or exists (select 1 from public.ac_sesiones s where s.grupo_id = g and s.profesora_id = public.mi_profesora());
$$;

create or replace function public.es_mi_alumno(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.ac_alumno_grupo ag where ag.alumno_id = a and ag.fecha_baja is null and public.es_mi_grupo(ag.grupo_id))
        or exists (select 1 from public.ac_tutorias t where t.alumno_id = a and t.profesora_id = public.mi_profesora());
$$;

-- compañeros de equipo (para asignar tareas): solo para quien tiene algo de Academia
create or replace function public.usuarios_equipo()
returns table (id uuid, nombre text, email text, activo boolean, rol text, sin_dinero boolean)
language sql stable security definer set search_path = public as $$
    select p.id, p.nombre, p.email, p.activo, p.rol, p.sin_dinero from public.profiles p where p.activo and public.ac_acceso();
$$;

revoke execute on function public.rol_actual(), public.perm_alcance(text), public.perm_edita(text), public.perm_ve(text), public.perm_edita_todo(text),
    public.perm_ve_alguno(text[]), public.perm_propio_alguno(text[]), public.perm_alguno(text[]), public.ac_acceso(),
    public.mi_profesora(), public.es_mi_grupo(uuid), public.es_mi_alumno(uuid), public.usuarios_equipo() from public, anon;
grant execute on function public.rol_actual(), public.perm_alcance(text), public.perm_edita(text), public.perm_ve(text), public.perm_edita_todo(text),
    public.perm_ve_alguno(text[]), public.perm_propio_alguno(text[]), public.perm_alguno(text[]), public.ac_acceso(),
    public.mi_profesora(), public.es_mi_grupo(uuid), public.es_mi_alumno(uuid), public.usuarios_equipo() to authenticated;

-- ---------- quién puede leer y cambiar los permisos ----------
-- Todos ven la lista de roles; cada uno ve los permisos de su rol; solo el administrador los cambia (y nunca los del admin).
create policy "ver roles" on public.roles for select to authenticated using (public.usuario_habilitado());
create policy "admin gestiona roles" on public.roles for all to authenticated using (public.es_admin()) with check (public.es_admin());
create policy "ver mis permisos" on public.rol_permisos for select to authenticated using (public.es_admin() or rol = public.rol_actual());
create policy "admin gestiona permisos" on public.rol_permisos for all to authenticated
    using (public.es_admin() and rol <> 'admin') with check (public.es_admin() and rol <> 'admin');

-- ---------- roles iniciales ----------
insert into public.roles (rol, nombre, descripcion, orden) values
    ('admin', 'Administrador', 'Todo, incluidos usuarios y permisos. No se puede limitar.', 1),
    ('direccion', 'Dirección', 'Toda la parte de Academia, incluidos Pagos y Remesas, y el escáner de gastos.', 2),
    ('coordinacion', 'Coordinación', 'Toda la parte de Academia, menos Pagos y Remesas.', 3),
    ('profesora', 'Profesora', 'Solo lo suyo: sus grupos y horarios, sus tutorías y el seguimiento de sus alumnos; además Calendario, Biblioteca y Protocolos.', 4),
    ('escaner', 'Solo escáner', 'Solo la pantalla del escáner: añade gastos (quedan pendientes de revisar).', 5)
on conflict (rol) do nothing;

-- Valores recomendados (se pueden cambiar a mano en la web). Los mismos están en app/js/permisos.js.
insert into public.rol_permisos (rol, permiso, alcance, editar)
select r.rol, p.permiso, 'todo', p.editar
from (values ('direccion'), ('coordinacion')) r(rol)
cross join (values ('ac_resumen', false), ('ac_alumnos', true), ('ac_pagos', true), ('ac_remesas', true), ('ac_seguimiento', true), ('ac_tutorias', true),
                   ('ac_bajas', true), ('ac_grupos', true), ('ac_calendario', true), ('ac_recogidas', true), ('ac_tareas', true), ('ac_biblioteca', true),
                   ('ac_documentos', true)) p(permiso, editar)
where r.rol = 'direccion' or p.permiso not in ('ac_pagos', 'ac_remesas')
on conflict (rol, permiso) do nothing;

insert into public.rol_permisos (rol, permiso, alcance, editar) values
    ('direccion', 'escaner', 'todo', true),
    ('escaner', 'escaner', 'todo', true),
    ('profesora', 'ac_grupos', 'propio', false),
    ('profesora', 'ac_calendario', 'todo', false),
    ('profesora', 'ac_tutorias', 'propio', true),
    ('profesora', 'ac_seguimiento', 'propio', true),
    ('profesora', 'ac_biblioteca', 'todo', true),
    ('profesora', 'ac_documentos', 'todo', false)
on conflict (rol, permiso) do nothing;

-- ---------- profiles.rol: de una lista fija a la tabla de roles ----------
alter table public.profiles drop constraint if exists profiles_rol_check;
alter table public.profiles add constraint profiles_rol_fkey foreign key (rol) references public.roles(rol) on update cascade;

-- usuario nuevo sin activar: el rol de menos permisos (el administrador le pone el suyo al darle de alta)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    insert into public.profiles (id, nombre, rol, email, activo)
    values (new.id, coalesce(nullif(new.raw_user_meta_data->>'nombre', ''), split_part(new.email, '@', 1)), 'escaner', new.email, false);
    return new;
end;
$$;

-- ---------- Facturación: las funciones de siempre ahora leen la matriz de permisos ----------
-- usuario_activo(): ve la contabilidad;  puede_editar(): edita la contabilidad;  es_escaner(): tiene el escáner de gastos.
create or replace function public.usuario_activo()
returns boolean language sql stable security definer set search_path = public as $$
    select public.perm_ve('fact');
$$;
create or replace function public.puede_editar()
returns boolean language sql stable security definer set search_path = public as $$
    select public.perm_edita_todo('fact');
$$;
create or replace function public.es_escaner()
returns boolean language sql stable security definer set search_path = public as $$
    select public.perm_alcance('escaner') is not null;
$$;

-- ---------- Academia: tareas (áreas de dinero solo con permiso de Pagos) ----------
create or replace function public.ve_area_tarea(a text)
returns boolean language sql stable security definer set search_path to 'public' as $$
    select coalesce((select pr.rol = 'admin'
                            or (public.perm_ve('ac_tareas') and (a in ('aca', 'centro') or (public.perm_ve('ac_pagos') and not pr.sin_dinero)))
                     from public.profiles pr where pr.id = auth.uid() and pr.activo), false);
$$;

create or replace function public.ac_generar_cuotas(p_curso uuid, p_mes text)
returns integer language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
    if not public.perm_edita_todo('ac_pagos') then
        raise exception 'No tienes permiso para generar cuotas';
    end if;
    insert into public.ac_cuotas (alumno_id, curso_id, concepto, mes, importe, metodo_pago)
    select i.alumno_id, i.curso_id, 'mensualidad', p_mes, i.cuota_mensual, a.metodo_pago
    from public.ac_inscripciones i
    join public.ac_alumnos a on a.id = i.alumno_id
    where i.curso_id = p_curso and i.activa and i.cuota_mensual > 0 and a.estado = 'inscrito'
    on conflict (alumno_id, curso_id, concepto, mes) do nothing;
    get diagnostics n = row_count;
    return n;
end;
$$;

-- ---------- Academia: políticas por tabla ----------
-- (tabla, leer, crear, modificar, borrar). Un texto vacío = no se toca esa política.
-- Cuando «modificar» está vacío se usa la de «crear». Quien borra sigue siendo solo el administrador,
-- salvo en las tablas donde ya borraba quien edita (anotaciones, préstamos, recogidas, autorizados, tareas).
do $$
declare
    r record;
    -- grupos visibles de forma general (listados y fichas que muestran el nombre del grupo)
    ver_grupos text := $e$public.perm_ve_alguno('ac_grupos', 'ac_calendario', 'ac_alumnos', 'ac_resumen', 'ac_pagos', 'ac_remesas', 'ac_bajas', 'ac_recogidas')$e$;
    -- alumnos visibles de forma general
    ver_alumnos text := $e$public.perm_ve_alguno('ac_alumnos', 'ac_grupos', 'ac_tutorias', 'ac_seguimiento', 'ac_recogidas', 'ac_pagos', 'ac_remesas', 'ac_bajas')$e$;
begin
    for r in
        select * from (values
            ('ac_listas',
                $e$public.ac_acceso()$e$,
                $e$public.perm_edita_todo('ac_alumnos') or public.perm_edita_todo('ac_grupos')$e$, '', ''),
            ('ac_responsables',
                $e$public.perm_ve_alguno('ac_alumnos', 'ac_pagos', 'ac_remesas', 'ac_recogidas')$e$,
                $e$public.perm_edita_todo('ac_alumnos') or public.perm_edita_todo('ac_pagos')$e$, '', ''),
            ('ac_responsables_priv',
                $e$public.perm_ve('ac_pagos')$e$,
                $e$public.perm_edita_todo('ac_pagos')$e$, '', ''),
            ('ac_profesoras',
                $e$public.perm_ve_alguno('ac_grupos', 'ac_calendario', 'ac_alumnos', 'ac_resumen', 'ac_tutorias', 'ac_seguimiento') or profile_id = auth.uid()$e$,
                $e$public.perm_edita_todo('ac_grupos')$e$, '', ''),
            ('ac_aulas',
                $e$public.perm_alguno('ac_grupos', 'ac_calendario')$e$,
                $e$public.perm_edita_todo('ac_grupos') or public.perm_edita_todo('ac_calendario')$e$, '', ''),
            ('ac_alumnos',
                ver_alumnos || $e$ or (public.perm_propio_alguno('ac_grupos', 'ac_tutorias', 'ac_seguimiento') and public.es_mi_alumno(id))$e$,
                $e$public.perm_edita_todo('ac_alumnos')$e$,
                $e$public.perm_edita_todo('ac_alumnos') or public.perm_edita_todo('ac_bajas')$e$, ''),
            ('ac_inscripciones',
                $e$public.perm_ve_alguno('ac_pagos', 'ac_remesas')$e$,
                $e$public.perm_edita_todo('ac_pagos')$e$,
                $e$public.perm_edita_todo('ac_pagos') or public.perm_edita_todo('ac_bajas')$e$, ''),
            ('ac_cuotas',
                $e$public.perm_ve_alguno('ac_pagos', 'ac_remesas')$e$,
                $e$public.perm_edita_todo('ac_pagos') or public.perm_edita_todo('ac_remesas')$e$, '', ''),
            ('ac_remesas',
                $e$public.perm_ve_alguno('ac_pagos', 'ac_remesas')$e$,
                $e$public.perm_edita_todo('ac_pagos') or public.perm_edita_todo('ac_remesas')$e$, '', ''),
            ('ac_grupos',
                ver_grupos || $e$ or (public.perm_propio_alguno('ac_grupos', 'ac_calendario') and public.es_mi_grupo(id))$e$,
                $e$public.perm_edita_todo('ac_grupos') or (public.perm_edita('ac_grupos') and profesora_id = public.mi_profesora())$e$,
                $e$public.perm_edita_todo('ac_grupos') or (public.perm_edita('ac_grupos') and public.es_mi_grupo(id))$e$, ''),
            ('ac_sesiones',
                ver_grupos || $e$ or (public.perm_propio_alguno('ac_grupos', 'ac_calendario') and public.es_mi_grupo(grupo_id))$e$,
                $e$public.perm_edita_todo('ac_grupos') or public.perm_edita_todo('ac_calendario')
                   or ((public.perm_edita('ac_grupos') or public.perm_edita('ac_calendario')) and public.es_mi_grupo(grupo_id))$e$, '', ''),
            ('ac_alumno_grupo',
                $e$public.perm_ve_alguno('ac_alumnos', 'ac_grupos', 'ac_resumen', 'ac_pagos', 'ac_remesas', 'ac_bajas', 'ac_recogidas')
                   or (public.perm_propio_alguno('ac_grupos') and public.es_mi_grupo(grupo_id))$e$,
                $e$public.perm_edita_todo('ac_alumnos') or public.perm_edita_todo('ac_bajas') or public.perm_edita_todo('ac_grupos')
                   or (public.perm_edita('ac_grupos') and public.es_mi_grupo(grupo_id))$e$, '', ''),
            ('ac_bajas',
                $e$public.perm_ve_alguno('ac_bajas', 'ac_resumen')$e$,
                $e$public.perm_edita_todo('ac_bajas')$e$, '', ''),
            ('ac_contactos',
                $e$public.perm_ve('ac_seguimiento')$e$,
                $e$public.perm_edita_todo('ac_seguimiento')$e$, '', ''),
            ('ac_tutorias',
                $e$public.perm_ve_alguno('ac_tutorias', 'ac_alumnos', 'ac_resumen')
                   or (public.perm_propio_alguno('ac_tutorias') and profesora_id = public.mi_profesora())$e$,
                $e$public.perm_edita_todo('ac_tutorias')
                   or (public.perm_edita('ac_tutorias') and profesora_id = public.mi_profesora() and public.es_mi_alumno(alumno_id))$e$, '', ''),
            ('ac_anotaciones',
                $e$public.perm_ve_alguno('ac_seguimiento', 'ac_alumnos')
                   or (public.perm_propio_alguno('ac_seguimiento', 'ac_tutorias') and (public.es_mi_alumno(alumno_id) or created_by = auth.uid()))$e$,
                $e$public.perm_edita_todo('ac_seguimiento') or public.perm_edita_todo('ac_alumnos')
                   or (tipo = 'tutoría' and public.perm_edita_todo('ac_tutorias'))
                   or (public.perm_edita('ac_seguimiento') and public.es_mi_alumno(alumno_id))
                   or (tipo = 'tutoría' and public.perm_edita('ac_tutorias') and public.es_mi_alumno(alumno_id))$e$, '',
                $e$public.perm_edita_todo('ac_seguimiento') or public.perm_edita_todo('ac_alumnos')
                   or (public.perm_edita('ac_seguimiento') and (public.es_mi_alumno(alumno_id) or created_by = auth.uid()))$e$),
            ('ac_prestamos',
                $e$public.perm_ve('ac_biblioteca')$e$,
                $e$public.perm_edita_todo('ac_biblioteca')$e$, '', $e$public.perm_edita_todo('ac_biblioteca')$e$),
            ('ac_recogidas',
                $e$public.perm_ve('ac_recogidas')$e$,
                $e$public.perm_edita_todo('ac_recogidas')$e$, '', $e$public.perm_edita_todo('ac_recogidas')$e$),
            ('ac_autorizados',
                $e$public.perm_ve('ac_recogidas')$e$,
                $e$public.perm_edita_todo('ac_recogidas')$e$, '', $e$public.perm_edita_todo('ac_recogidas')$e$),
            ('ac_autorizados_priv',
                $e$public.perm_edita_todo('ac_recogidas')$e$,
                $e$public.perm_edita_todo('ac_recogidas')$e$, '', $e$public.perm_edita_todo('ac_recogidas')$e$),
            ('ac_documentos',
                $e$public.perm_ve('ac_documentos')$e$,
                $e$public.perm_edita_todo('ac_documentos')$e$, '', ''),
            ('ac_tareas',
                $e$public.ve_area_tarea(area)$e$,
                $e$public.perm_edita_todo('ac_tareas') and public.ve_area_tarea(area)$e$, '', $e$public.perm_edita_todo('ac_tareas') and public.ve_area_tarea(area)$e$)
        ) v(tabla, leer, crear, modificar, borrar)
    loop
        execute format('alter policy leer on public.%I using (%s)', r.tabla, r.leer);
        execute format('alter policy insertar on public.%I with check (%s)', r.tabla, r.crear);
        execute format('alter policy modificar on public.%I using (%s) with check (%s)', r.tabla,
                       coalesce(nullif(r.modificar, ''), r.crear), coalesce(nullif(r.modificar, ''), r.crear));
        if r.borrar <> '' then
            execute format('alter policy borrar on public.%I using (%s)', r.tabla, r.borrar);
        end if;
    end loop;
end $$;
