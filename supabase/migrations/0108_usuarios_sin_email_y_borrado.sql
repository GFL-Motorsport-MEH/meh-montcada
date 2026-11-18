-- =====================================================================
-- 0108: usuarios sin email, borrado de usuarios y fuera «Sin dinero»
--
-- 1) Un usuario puede existir solo como ficha (profiles) sin cuenta de acceso (auth.users): sin email no entra.
--    Cuando el administrador le pone un email, la función admin-usuarios crea la cuenta con el MISMO id,
--    así que sus tareas, su ficha de profesora, etc. siguen apuntando a él.
--    Por eso profiles.id deja de depender de auth.users (antes la FK lo obligaba).
-- 2) Borrar un usuario no debe fallar por «creado por» / «modificado por»: esas referencias pasan a ON DELETE SET NULL
--    (el historial se conserva, solo pierde el nombre de quien lo hizo).
-- 3) «Sin dinero» sobra: lo que ve cada rol ya lo decide la matriz de permisos (quien no tiene Pagos no ve
--    las tareas de Contabilidad ni de Domiciliaciones y pagos). La columna se deja en la tabla sin usarse.
-- =====================================================================

-- ---------- 1) perfiles sin cuenta de acceso ----------
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();

-- el email, cuando existe, es único (sin distinguir mayúsculas)
create unique index if not exists profiles_email_unico on public.profiles (lower(email)) where email is not null;

-- al crear la cuenta de acceso de un perfil que ya existe (mismo id) no se duplica el perfil
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    insert into public.profiles (id, nombre, rol, email, activo)
    values (new.id, coalesce(nullif(new.raw_user_meta_data->>'nombre', ''), split_part(new.email, '@', 1)), 'escaner', new.email, false)
    on conflict (id) do nothing;
    return new;
end;
$$;

-- ---------- 2) borrar usuarios ----------
do $$
declare r record;
begin
    for r in
        select c.conrelid::regclass as tabla, c.conname, a.attname
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and c.confdeltype = 'a'
          and c.conrelid <> 'public.profiles'::regclass
    loop
        execute format('alter table %s drop constraint %I', r.tabla, r.conname);
        execute format('alter table %s add constraint %I foreign key (%I) references public.profiles(id) on delete set null',
                       r.tabla, r.conname, r.attname);
    end loop;
end $$;

-- ---------- 3) «Sin dinero» fuera de las reglas ----------
create or replace function public.ve_area_tarea(a text)
returns boolean language sql stable security definer set search_path to 'public' as $$
    select coalesce((select pr.rol = 'admin'
                            or (public.perm_ve('ac_tareas') and (a in ('aca', 'centro') or public.perm_ve('ac_pagos')))
                     from public.profiles pr where pr.id = auth.uid() and pr.activo), false);
$$;
