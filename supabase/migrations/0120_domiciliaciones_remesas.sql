-- 0118: Domiciliaciones y remesas como en la hoja «Domiciliaciones» del Excel Control Alumnos.
-- · ac_remesas_lista: las remesas «permanentes» (Sabadell Montcada 1–21 con hasta 20 cobros, «21 - TRIM», BBVA 1 - FED, BBVA 4…).
-- · ac_domiciliaciones: una línea por alumno domiciliado con su remesa, comentario y referencia de mandato (por defecto el ID del alumno).
-- · ac_cuota_cambios: registro de cada cambio de la cuota mensual (para resaltar los cambios entre el día 5 y el 25).
-- · ac_remesa_envios (+ _resumen + _lineas): lo que se envió al banco cada mes («REMESAS ENVIADAS - mes X»), para comparar cuando entran los pagos.
-- Las remesas mensuales antiguas (ac_remesas) no se tocan.

create table if not exists public.ac_remesas_lista (
    id uuid primary key default gen_random_uuid(),
    nombre text not null unique,
    banco text not null check (banco in ('SABADELL', 'BBVA')),
    capacidad integer check (capacidad is null or capacidad > 0),
    orden integer not null default 0,
    comentario text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);

create table if not exists public.ac_domiciliaciones (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    remesa_id uuid references public.ac_remesas_lista(id) on delete set null,
    ref_mandato text,
    comentario text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists ac_domiciliaciones_alumno_idx on public.ac_domiciliaciones (alumno_id);
create index if not exists ac_domiciliaciones_remesa_idx on public.ac_domiciliaciones (remesa_id);

create table if not exists public.ac_cuota_cambios (
    id uuid primary key default gen_random_uuid(),
    inscripcion_id uuid references public.ac_inscripciones(id) on delete cascade,
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    curso_id uuid not null references public.cursos(id),
    anterior numeric(8, 2),
    nueva numeric(8, 2),
    fecha date not null default (now() at time zone 'Europe/Madrid')::date,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id)
);
create index if not exists ac_cuota_cambios_alumno_idx on public.ac_cuota_cambios (alumno_id, fecha);

create table if not exists public.ac_remesa_envios (
    id uuid primary key default gen_random_uuid(),
    curso_id uuid not null references public.cursos(id),
    mes text not null check (mes in ('septiembre', 'octubre', 'noviembre', 'diciembre', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto')),
    enviado_el timestamptz not null default now(),
    enviado_por uuid default auth.uid() references public.profiles(id),
    nota text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    unique (curso_id, mes)
);

create table if not exists public.ac_remesa_envio_resumen (
    id uuid primary key default gen_random_uuid(),
    envio_id uuid not null references public.ac_remesa_envios(id) on delete cascade,
    remesa_nombre text not null,
    banco text check (banco in ('SABADELL', 'BBVA')),
    orden integer not null default 0,
    cobros integer not null default 0,
    total numeric(10, 2) not null default 0,
    ok boolean not null default false,
    nota text,
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    unique (envio_id, remesa_nombre)
);

create table if not exists public.ac_remesa_envio_lineas (
    id uuid primary key default gen_random_uuid(),
    envio_id uuid not null references public.ac_remesa_envios(id) on delete cascade,
    domiciliacion_id uuid references public.ac_domiciliaciones(id) on delete set null,
    alumno_id uuid references public.ac_alumnos(id) on delete set null,
    alumno_num numeric,
    remesa_nombre text,
    importe numeric(8, 2) not null default 0
);
create index if not exists ac_remesa_envio_lineas_envio_idx on public.ac_remesa_envio_lineas (envio_id);

-- cada cambio de cuota mensual queda registrado con su fecha
create or replace function public.ac_registrar_cambio_cuota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.cuota_mensual is distinct from old.cuota_mensual then
        insert into public.ac_cuota_cambios (inscripcion_id, alumno_id, curso_id, anterior, nueva)
        values (new.id, new.alumno_id, new.curso_id, old.cuota_mensual, new.cuota_mensual);
    end if;
    return new;
end;
$$;
create or replace trigger ac_registrar_cambio_cuota
    after update of cuota_mensual on public.ac_inscripciones
    for each row execute function public.ac_registrar_cambio_cuota();

-- auditoría y seguridad
do $$
declare t text;
begin
    foreach t in array array['ac_remesas_lista', 'ac_domiciliaciones', 'ac_remesa_envios', 'ac_remesa_envio_resumen']
    loop
        execute format('create or replace trigger %I before update on public.%I for each row execute procedure public.set_updated_audit()', t || '_set_updated', t);
    end loop;
    foreach t in array array['ac_remesas_lista', 'ac_domiciliaciones', 'ac_cuota_cambios', 'ac_remesa_envios', 'ac_remesa_envio_resumen', 'ac_remesa_envio_lineas']
    loop
        execute format('alter table public.%I enable row level security', t);
        execute format('create policy leer on public.%I for select to authenticated using (public.perm_ve_alguno(''ac_pagos'', ''ac_remesas''))', t);
        execute format('create policy insertar on public.%I for insert to authenticated with check (public.perm_edita_todo(''ac_pagos'') or public.perm_edita_todo(''ac_remesas''))', t);
        execute format('create policy modificar on public.%I for update to authenticated using (public.perm_edita_todo(''ac_pagos'') or public.perm_edita_todo(''ac_remesas'')) with check (public.perm_edita_todo(''ac_pagos'') or public.perm_edita_todo(''ac_remesas''))', t);
        execute format('create policy borrar on public.%I for delete to authenticated using (public.perm_edita_todo(''ac_pagos'') or public.perm_edita_todo(''ac_remesas''))', t);
    end loop;
end $$;
