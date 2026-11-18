-- Pagos: «recibo hecho», importes manuales, welcome pack ligado al nivel y bajas que ponen a 0 las cuotas sin pagar.
-- Solo añade columnas/tablas/disparadores: no toca ninguna cuota existente.

-- ---------- cuotas: recibo hecho, importe manual y nivel con el que se fijó el welcome pack ----------
alter table public.ac_cuotas add column if not exists recibo_hecho boolean not null default false;
alter table public.ac_cuotas add column if not exists importe_manual boolean not null default false;  -- true = lo ha escrito una persona; los cambios automáticos no lo tocan
alter table public.ac_cuotas add column if not exists nivel text;                                      -- nivel del alumno cuando se fijó el importe del welcome pack

-- ---------- precio del welcome pack por nivel y curso ----------
create table if not exists public.ac_wp_precios (
    id uuid primary key default gen_random_uuid(),
    curso_id uuid not null references public.cursos(id),
    nivel text not null,
    importe numeric(8, 2) not null default 0,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create unique index if not exists ac_wp_precios_curso_nivel_idx on public.ac_wp_precios (curso_id, lower(btrim(nivel)));

create or replace trigger ac_wp_precios_set_updated before update on public.ac_wp_precios for each row execute procedure public.set_updated_audit();

alter table public.ac_wp_precios enable row level security;
create policy leer on public.ac_wp_precios for select to authenticated
    using (public.perm_ve_alguno('ac_pagos', 'ac_remesas'));
create policy insertar on public.ac_wp_precios for insert to authenticated
    with check (public.perm_edita_todo('ac_pagos'));
create policy modificar on public.ac_wp_precios for update to authenticated
    using (public.perm_edita_todo('ac_pagos')) with check (public.perm_edita_todo('ac_pagos'));
create policy borrar on public.ac_wp_precios for delete to authenticated
    using (public.perm_edita_todo('ac_pagos'));

-- ---------- al cambiar el nivel de un alumno, su welcome pack NO pagado pasa al precio del nuevo nivel ----------
-- Un welcome pack ya pagado no se toca nunca por este camino (conserva importe y nivel con los que se cobró).
-- Tampoco se tocan los importes escritos a mano (importe_manual).
create or replace function public.ac_wp_al_cambiar_nivel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.nivel is not distinct from old.nivel or coalesce(btrim(new.nivel), '') = '' then
        return new;
    end if;
    update public.ac_inscripciones i
       set welcome_pack = p.importe
      from public.ac_wp_precios p
     where i.alumno_id = new.id
       and p.curso_id = i.curso_id
       and lower(btrim(p.nivel)) = lower(btrim(new.nivel))
       and not exists (select 1 from public.ac_cuotas c
                        where c.alumno_id = i.alumno_id and c.curso_id = i.curso_id
                          and c.concepto = 'welcome_pack' and c.estado = 'pagado');
    update public.ac_cuotas c
       set importe = p.importe, nivel = new.nivel
      from public.ac_wp_precios p
     where c.alumno_id = new.id
       and c.concepto = 'welcome_pack'
       and c.estado <> 'pagado'
       and not c.importe_manual
       and p.curso_id = c.curso_id
       and lower(btrim(p.nivel)) = lower(btrim(new.nivel));
    return new;
end;
$$;
create or replace trigger ac_alumnos_wp_nivel after update of nivel on public.ac_alumnos
    for each row execute procedure public.ac_wp_al_cambiar_nivel();

-- ---------- al fijar o cambiar el precio de un nivel, los welcome pack NO pagados de ese nivel se actualizan ----------
create or replace function public.ac_wp_al_cambiar_precio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.ac_inscripciones i
       set welcome_pack = new.importe
      from public.ac_alumnos a
     where a.id = i.alumno_id
       and i.curso_id = new.curso_id
       and lower(btrim(a.nivel)) = lower(btrim(new.nivel))
       and not exists (select 1 from public.ac_cuotas c
                        where c.alumno_id = i.alumno_id and c.curso_id = i.curso_id
                          and c.concepto = 'welcome_pack' and c.estado = 'pagado');
    update public.ac_cuotas c
       set importe = new.importe, nivel = a.nivel
      from public.ac_alumnos a
     where a.id = c.alumno_id
       and c.curso_id = new.curso_id
       and c.concepto = 'welcome_pack'
       and c.estado <> 'pagado'
       and not c.importe_manual
       and lower(btrim(a.nivel)) = lower(btrim(new.nivel));
    return new;
end;
$$;
create or replace trigger ac_wp_precios_aplicar after insert or update of importe on public.ac_wp_precios
    for each row execute procedure public.ac_wp_al_cambiar_precio();

-- ---------- baja de un alumno: sus cuotas pendientes (sin pagar) pasan a 0 ----------
-- Las pagadas se conservan tal cual. Las devueltas (recibo impagado) siguen siendo deuda y no se tocan.
create or replace function public.ac_cuotas_a_cero_al_baja()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.estado = 'baja' and old.estado is distinct from 'baja' then
        update public.ac_cuotas
           set importe = 0, importe_manual = true
         where alumno_id = new.id and estado = 'pendiente' and importe <> 0;
    end if;
    return new;
end;
$$;
create or replace trigger ac_alumnos_baja_cuotas after update of estado on public.ac_alumnos
    for each row execute procedure public.ac_cuotas_a_cero_al_baja();
