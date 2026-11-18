-- Tareas de Academia v2: estado, área (con permisos por área), repetición, comentarios y responsable en texto.
-- Sustituye a Google Keep. Las áreas Contabilidad y Domiciliaciones/pagos no las ve quien tenga "sin_dinero".

-- Permiso por usuario: quien lo tenga no ve nada de contabilidad, domiciliaciones ni pagos (p. ej. la coordinadora académica).
alter table public.profiles add column if not exists sin_dinero boolean not null default false;

alter table public.ac_tareas
    add column if not exists estado text not null default 'pend' check (estado in ('pend', 'curso', 'hecha')),
    add column if not exists area text not null default 'aca' check (area in ('aca', 'centro', 'conta', 'pagos')),
    add column if not exists repite text check (repite in ('semanal', 'mensual')),
    add column if not exists responsable text,           -- nombre libre para quien aún no tiene usuario
    add column if not exists origen text,                -- 'keep' si viene de la exportación de Google Keep
    add column if not exists comentarios jsonb not null default '[]'::jsonb;

update public.ac_tareas set estado = case when hecha then 'hecha' else 'pend' end where estado = 'pend' and hecha;

-- hecha (booleano de siempre) y estado se mantienen sincronizados
create or replace function public.ac_tareas_sync() returns trigger language plpgsql as $$
begin
    if tg_op = 'INSERT' then
        if new.estado = 'hecha' then new.hecha := true;
        elsif new.hecha and new.estado = 'pend' then new.estado := 'hecha'; end if;
    else
        if new.estado is distinct from old.estado then new.hecha := (new.estado = 'hecha');
        elsif new.hecha is distinct from old.hecha then new.estado := case when new.hecha then 'hecha' else 'pend' end; end if;
    end if;
    if new.hecha and new.hecha_at is null then new.hecha_at := now(); end if;
    if not new.hecha then new.hecha_at := null; end if;
    return new;
end $$;
create or replace trigger ac_tareas_sync before insert or update on public.ac_tareas for each row execute function public.ac_tareas_sync();

-- ¿puede el usuario actual ver las tareas de esta área?
create or replace function public.ve_area_tarea(a text) returns boolean
language sql stable security definer set search_path to 'public' as $$
    select exists (select 1 from public.profiles
                   where id = auth.uid() and activo and (rol = 'admin' or not sin_dinero or a in ('aca', 'centro')));
$$;

alter policy "leer" on public.ac_tareas using (public.usuario_activo() and public.ve_area_tarea(area));
alter policy "insertar" on public.ac_tareas with check (public.puede_editar() and public.ve_area_tarea(area));
alter policy "modificar" on public.ac_tareas using (public.puede_editar() and public.ve_area_tarea(area)) with check (public.puede_editar() and public.ve_area_tarea(area));
alter policy "borrar" on public.ac_tareas using (public.puede_editar() and public.ve_area_tarea(area));
