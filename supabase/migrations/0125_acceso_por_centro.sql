-- =====================================================================
-- 0118: acceso por centro
--
-- Cada usuario puede quedar limitado a UN centro (profiles.centro_id; vacío = todos los centros, como hasta ahora).
-- Es el primer filtro: dentro de su centro, el usuario tiene los permisos de su rol (matriz de permisos), también en Trabajadores.
--
-- 1) Los datos de Academia pasan a llevar centro: las tablas «raíz» reciben centro_id (por defecto el centro principal; todo lo
--    existente es de MONTCADA). Lo que cuelga de un alumno, un grupo, una reunión o un responsable hereda el centro del padre.
-- 2) Políticas RESTRICTIVAS: se suman (AND) a las que ya había, así que no dan acceso a nada: solo quitan lo que es de otro centro.
--    Para un usuario sin centro fijo no cambia nada.
-- 3) Ingresos, facturación y remesas todavía no llevan centro: cuentan como del principal (un usuario de otro centro no los ve).
-- =====================================================================

alter table public.profiles add column if not exists centro_id uuid references public.centros(id) on delete set null;

-- ---------- centro en las tablas raíz de Academia ----------
do $$
declare t text;
begin
    foreach t in array array['ac_profesoras', 'ac_tareas', 'ac_reuniones', 'ac_documentos', 'ac_biblioteca_items', 'ac_remesas', 'ac_responsables'] loop
        execute format('alter table public.%I add column if not exists centro_id uuid references public.centros(id) default public.centro_principal()', t);
        execute format('create index if not exists %I on public.%I (centro_id)', t || '_centro_idx', t);
    end loop;
end $$;

-- ---------- funciones ----------
create or replace function public.mi_centro()
returns uuid language sql stable security definer set search_path = public as $$
    select pr.centro_id from public.profiles pr where pr.id = auth.uid() and pr.activo
$$;

-- ¿puede este usuario ver filas del centro c? (null = centro principal)
create or replace function public.centro_ok(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select public.mi_centro() is null or coalesce(c, public.centro_principal()) = public.mi_centro()
$$;

create or replace function public.solo_principal_ok()
returns boolean language sql stable security definer set search_path = public as $$
    select public.mi_centro() is null or public.mi_centro() = public.centro_principal()
$$;

create or replace function public.alumno_centro_ok(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select public.mi_centro() is null
        or public.centro_ok((select x.centro_id from public.ac_alumnos x where x.id = a))
$$;

create or replace function public.grupo_centro_ok(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select public.mi_centro() is null or public.centro_ok((select x.centro_id from public.ac_grupos x where x.id = g))
$$;

create or replace function public.reunion_centro_ok(r uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select public.mi_centro() is null or public.centro_ok((select x.centro_id from public.ac_reuniones x where x.id = r))
$$;

create or replace function public.responsable_centro_ok(r uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select public.mi_centro() is null or public.centro_ok((select x.centro_id from public.ac_responsables x where x.id = r))
$$;

create or replace function public.autorizado_centro_ok(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select public.mi_centro() is null
        or public.alumno_centro_ok((select x.alumno_id from public.ac_autorizados x where x.id = a))
$$;

-- una persona (su ficha de usuario) es de un centro si lo tiene fijado; sin centro fijo trabaja en todos
create or replace function public.perfil_centro_ok(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select public.mi_centro() is null
        or coalesce((select x.centro_id from public.profiles x where x.id = p), public.mi_centro()) = public.mi_centro()
$$;

-- ---------- políticas restrictivas ----------
do $$
declare
    t text; expr text;
    directas text[] := array['ac_alumnos', 'ac_grupos', 'ac_aulas', 'ac_profesoras', 'ac_tareas', 'ac_reuniones', 'ac_documentos',
        'ac_biblioteca_items', 'ac_remesas', 'ac_responsables', 'gastos', 'movimientos_banco', 'cuentas_bancarias', 'plantillas_gasto'];
    de_alumno text[] := array['ac_vinculos', 'ac_inscripciones', 'ac_cuotas', 'ac_bajas', 'ac_contactos', 'ac_tutorias', 'ac_tutorias_solicitudes',
        'ac_anotaciones', 'ac_autorizados', 'ac_recogidas', 'ac_recogidas_pagos', 'ac_nivel_historial', 'ac_cuota_cambios', 'ac_domiciliaciones',
        'ac_remesa_envio_lineas', 'ac_alumno_grupo', 'ac_prestamos'];
    principal text[] := array['ingresos', 'ingresos_metodo', 'alumnos_mes', 'facturacion', 'ac_remesa_envios', 'ac_remesa_envio_resumen', 'ac_remesas_lista'];
begin
    foreach t in array directas loop
        expr := '(select public.mi_centro()) is null or public.centro_ok(centro_id)';
        execute format('drop policy if exists centro on public.%I', t);
        execute format('create policy centro on public.%I as restrictive for all to authenticated using (%s) with check (%s)', t, expr, expr);
    end loop;
    foreach t in array de_alumno loop
        expr := '(select public.mi_centro()) is null or public.alumno_centro_ok(alumno_id)';
        execute format('drop policy if exists centro on public.%I', t);
        execute format('create policy centro on public.%I as restrictive for all to authenticated using (%s) with check (%s)', t, expr, expr);
    end loop;
    foreach t in array principal loop
        expr := 'public.solo_principal_ok()';
        execute format('drop policy if exists centro on public.%I', t);
        execute format('create policy centro on public.%I as restrictive for all to authenticated using (%s) with check (%s)', t, expr, expr);
    end loop;
end $$;

-- lo que cuelga de otras cosas
drop policy if exists centro on public.ac_sesiones;
create policy centro on public.ac_sesiones as restrictive for all to authenticated
    using ((select public.mi_centro()) is null or public.grupo_centro_ok(grupo_id)) with check ((select public.mi_centro()) is null or public.grupo_centro_ok(grupo_id));
drop policy if exists centro on public.ac_reunion_temas;
create policy centro on public.ac_reunion_temas as restrictive for all to authenticated
    using ((select public.mi_centro()) is null or public.reunion_centro_ok(reunion_id)) with check ((select public.mi_centro()) is null or public.reunion_centro_ok(reunion_id));
drop policy if exists centro on public.ac_responsables_priv;
create policy centro on public.ac_responsables_priv as restrictive for all to authenticated
    using ((select public.mi_centro()) is null or public.responsable_centro_ok(responsable_id)) with check ((select public.mi_centro()) is null or public.responsable_centro_ok(responsable_id));
drop policy if exists centro on public.ac_autorizados_priv;
create policy centro on public.ac_autorizados_priv as restrictive for all to authenticated
    using ((select public.mi_centro()) is null or public.autorizado_centro_ok(autorizado_id)) with check ((select public.mi_centro()) is null or public.autorizado_centro_ok(autorizado_id));
-- Trabajadores: los documentos de cada persona los ve quien trabaja en su mismo centro
drop policy if exists centro on public.ac_portal_docs;
create policy centro on public.ac_portal_docs as restrictive for all to authenticated
    using ((select public.mi_centro()) is null or public.perfil_centro_ok(profile_id)) with check ((select public.mi_centro()) is null or public.perfil_centro_ok(profile_id));

-- ---------- compañeros de equipo (asignar tareas): solo los de mi centro (o sin centro fijo) ----------
drop function if exists public.equipo_tareas();
create function public.equipo_tareas()
returns table(id uuid, nombre text, email text, activo boolean, rol text, sin_dinero boolean, siglas text, centro_id uuid)
language sql stable security definer set search_path to 'public' as $$
    select p.id, p.nombre, p.email, p.activo, p.rol, p.sin_dinero, p.siglas, p.centro_id
    from public.profiles p
    where p.activo and public.ac_acceso() and (public.mi_centro() is null or p.centro_id is null or p.centro_id = public.mi_centro());
$$;

-- tablas de Academia creadas después (formularios y notas de domiciliaciones), también por centro a través del alumno
create policy centro on public.ac_domiciliacion_notas as restrictive for all to authenticated
    using ((select public.mi_centro()) is null or public.alumno_centro_ok(alumno_id)) with check ((select public.mi_centro()) is null or public.alumno_centro_ok(alumno_id));
create policy centro on public.ac_formulario_respuestas as restrictive for all to authenticated
    using ((select public.mi_centro()) is null or public.alumno_centro_ok(alumno_id)) with check ((select public.mi_centro()) is null or public.alumno_centro_ok(alumno_id));

-- Se dejan compartidas (configuración común a todos los centros): listas, tarifas, descuentos, precios WP, calendario, formularios y mejoras del software.

-- Trabajadores (contratos, horario y bolsa de horas): los datos de cada persona los ve quien trabaja en su mismo centro
create policy centro on public.tr_contratos as restrictive for all to authenticated
    using ((select public.mi_centro()) is null or public.perfil_centro_ok(profile_id)) with check ((select public.mi_centro()) is null or public.perfil_centro_ok(profile_id));
create policy centro on public.tr_horario as restrictive for all to authenticated
    using ((select public.mi_centro()) is null or public.perfil_centro_ok(profile_id)) with check ((select public.mi_centro()) is null or public.perfil_centro_ok(profile_id));
create policy centro on public.tr_horas as restrictive for all to authenticated
    using ((select public.mi_centro()) is null or public.perfil_centro_ok(profile_id)) with check ((select public.mi_centro()) is null or public.perfil_centro_ok(profile_id));
