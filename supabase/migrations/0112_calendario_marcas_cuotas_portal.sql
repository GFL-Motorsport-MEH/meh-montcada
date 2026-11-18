-- 0112: calendario del curso con varios tipos de marca por día (como el PDF «Calendario MEH Montcada»),
--       cuotas y descuentos configurables, historial de cambios de nivel, portal del trabajador y permisos nuevos.
-- Solo CREATE / INSERT / ALTER (sin borrados): la antigua ac_calendario_dias queda sin uso.

-- ---------- calendario: una marca por día Y tipo (un día puede ser festivo y estar dentro de un camp) ----------
create table if not exists public.ac_calendario_marcas (
    id uuid primary key default gen_random_uuid(),
    curso_id uuid not null references public.cursos(id),
    fecha date not null,
    tipo text not null check (tipo in ('festivo', 'vacaciones', 'sin_clase', 'evento', 'inicio_clases', 'fun_day', 'storytime', 'tematica', 'camp')),
    nombre text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    unique (curso_id, fecha, tipo)
);
create index if not exists ac_calendario_marcas_curso_idx on public.ac_calendario_marcas (curso_id, fecha);
create trigger ac_calendario_marcas_set_updated before update on public.ac_calendario_marcas for each row execute procedure public.set_updated_audit();
alter table public.ac_calendario_marcas enable row level security;
create policy leer on public.ac_calendario_marcas for select to authenticated using (public.perm_alguno('ac_grupos', 'ac_calendario'));
create policy escribir on public.ac_calendario_marcas for all to authenticated using (public.perm_edita_todo('ac_calendario')) with check (public.perm_edita_todo('ac_calendario'));
grant all on public.ac_calendario_marcas to authenticated;

-- lo que hubiera en la tabla antigua pasa a la nueva
insert into public.ac_calendario_marcas (curso_id, fecha, tipo, nombre)
select curso_id, fecha, tipo, nombre from public.ac_calendario_dias on conflict do nothing;

-- datos del PDF «Calendario MEH MONTCADA 2026-2027 v1»
do $$
declare c uuid;
begin
    select id into c from public.cursos where nombre = '2026.27';
    if c is null then return; end if;
    insert into public.ac_calendario_marcas (curso_id, fecha, tipo, nombre) values
        (c, '2026-09-07', 'inicio_clases', 'Comienzo de clases'), (c, '2027-01-08', 'inicio_clases', 'Comienzo de clases'), (c, '2027-03-30', 'inicio_clases', 'Comienzo de clases'),
        (c, '2026-09-11', 'festivo', 'Diada de Catalunya'), (c, '2026-09-24', 'festivo', 'Festivo en Barcelona'), (c, '2026-10-12', 'festivo', 'Fiesta Nacional de España'),
        (c, '2026-11-01', 'festivo', 'Todos los Santos'), (c, '2026-12-06', 'festivo', 'Día de la Constitución Española'), (c, '2026-12-07', 'festivo', 'Lunes siguiente'),
        (c, '2026-12-08', 'festivo', 'Inmaculada Concepción'), (c, '2026-12-25', 'festivo', 'Navidad'), (c, '2027-01-01', 'festivo', 'Año Nuevo'), (c, '2027-01-06', 'festivo', 'Día de Reyes'),
        (c, '2027-03-26', 'festivo', 'Viernes Santo'), (c, '2027-03-29', 'festivo', 'Lunes de Pascua'), (c, '2027-05-01', 'festivo', 'Fiesta del Trabajo'),
        (c, '2027-05-17', 'festivo', 'Segunda Pascua'), (c, '2027-06-24', 'festivo', 'San Juan'),
        (c, '2026-10-31', 'fun_day', 'Halloween'), (c, '2026-12-19', 'fun_day', 'Christmas'), (c, '2027-02-06', 'fun_day', 'Carnival'), (c, '2027-06-05', 'fun_day', 'Summer'),
        (c, '2026-09-26', 'storytime', 'Storytime'), (c, '2027-03-13', 'storytime', 'Storytime'), (c, '2027-04-24', 'storytime', 'Sant Jordi'),
        (c, '2027-04-23', 'tematica', 'Sant Jordi')
    on conflict do nothing;
    -- rangos (solo de lunes a viernes)
    insert into public.ac_calendario_marcas (curso_id, fecha, tipo, nombre)
    select c, d::date, r.tipo, r.nombre
    from (values ('2026-10-26'::date, '2026-10-30'::date, 'tematica', 'Halloween'), ('2026-12-07', '2026-12-18', 'tematica', 'Christmas'), ('2027-02-01', '2027-02-05', 'tematica', 'Carnival'),
                 ('2027-03-22', '2027-03-25', 'camp', 'Easter Camp'), ('2026-12-21', '2027-01-05', 'camp', 'Xmas Camp'), ('2027-06-21', '2027-07-30', 'camp', 'Summer Camp')) r(a, b, tipo, nombre)
    cross join lateral generate_series(r.a, r.b, interval '1 day') d
    where extract(isodow from d) < 6
    on conflict do nothing;
end $$;

-- ---------- cuotas y descuentos (Configuración) ----------
create table if not exists public.ac_cuotas_tarifa (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    modalidad text,
    cuota_mensual numeric(8, 2) not null default 0,
    welcome_pack numeric(8, 2) not null default 0,
    notas text,
    orden integer not null default 0,
    activa boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create table if not exists public.ac_descuentos (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    tipo text not null default 'porcentaje' check (tipo in ('porcentaje', 'importe')),
    valor numeric(8, 2) not null default 0,
    notas text,
    orden integer not null default 0,
    activo boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create unique index if not exists ac_descuentos_nombre_idx on public.ac_descuentos (lower(nombre));
create trigger ac_cuotas_tarifa_set_updated before update on public.ac_cuotas_tarifa for each row execute procedure public.set_updated_audit();
create trigger ac_descuentos_set_updated before update on public.ac_descuentos for each row execute procedure public.set_updated_audit();
alter table public.ac_cuotas_tarifa enable row level security;
alter table public.ac_descuentos enable row level security;
create policy leer on public.ac_cuotas_tarifa for select to authenticated using (public.perm_alguno('ac_pagos', 'fact'));
create policy escribir on public.ac_cuotas_tarifa for all to authenticated using (public.perm_edita_todo('fact') or public.perm_edita_todo('ac_pagos')) with check (public.perm_edita_todo('fact') or public.perm_edita_todo('ac_pagos'));
create policy leer on public.ac_descuentos for select to authenticated using (public.perm_alguno('ac_alumnos', 'ac_pagos', 'fact'));
create policy escribir on public.ac_descuentos for all to authenticated using (public.perm_edita_todo('fact') or public.perm_edita_todo('ac_pagos')) with check (public.perm_edita_todo('fact') or public.perm_edita_todo('ac_pagos'));
grant all on public.ac_cuotas_tarifa, public.ac_descuentos to authenticated;
-- los descuentos que ya existían en la lista pasan a la tabla (el valor se fija en Configuración)
insert into public.ac_descuentos (nombre, orden) select valor, orden from public.ac_listas where lista = 'descuento' on conflict do nothing;

-- ---------- historial de cambios de nivel (pantalla «Cambio de curso») ----------
create table if not exists public.ac_nivel_historial (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id),
    curso_id uuid references public.cursos(id),
    nivel_anterior text,
    nivel_nuevo text,
    fecha date not null default current_date,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id)
);
create index if not exists ac_nivel_historial_alumno_idx on public.ac_nivel_historial (alumno_id);
alter table public.ac_nivel_historial enable row level security;
create policy leer on public.ac_nivel_historial for select to authenticated using (public.perm_ve('ac_alumnos'));
create policy escribir on public.ac_nivel_historial for all to authenticated using (public.perm_edita_todo('ac_alumnos')) with check (public.perm_edita_todo('ac_alumnos'));
grant all on public.ac_nivel_historial to authenticated;

-- ---------- portal del trabajador: documentos (nóminas, contratos…) de cada usuario ----------
create table if not exists public.ac_portal_docs (
    id uuid primary key default gen_random_uuid(),
    profile_id uuid not null references public.profiles(id),
    tipo text not null default 'nomina' check (tipo in ('nomina', 'contrato', 'certificado', 'otro')),
    titulo text not null,
    periodo text,
    ruta text not null,
    nombre_archivo text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id)
);
create index if not exists ac_portal_docs_profile_idx on public.ac_portal_docs (profile_id, created_at);
alter table public.ac_portal_docs enable row level security;
-- cada uno ve solo los suyos; quien gestiona el portal (alcance «todo») ve y cambia los de todos
create policy leer on public.ac_portal_docs for select to authenticated using (public.perm_ve('ac_portal') or (profile_id = auth.uid() and public.perm_alcance('ac_portal') is not null));
create policy escribir on public.ac_portal_docs for all to authenticated using (public.perm_edita_todo('ac_portal')) with check (public.perm_edita_todo('ac_portal'));
grant all on public.ac_portal_docs to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trabajadores', 'trabajadores', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
-- ruta de cada archivo: <id del usuario>/<fecha>-<nombre>
create policy "portal lee" on storage.objects for select to authenticated
    using (bucket_id = 'trabajadores' and (public.perm_ve('ac_portal') or (public.perm_alcance('ac_portal') is not null and (storage.foldername(name))[1] = auth.uid()::text)));
create policy "portal escribe" on storage.objects for all to authenticated
    using (bucket_id = 'trabajadores' and public.perm_edita_todo('ac_portal')) with check (bucket_id = 'trabajadores' and public.perm_edita_todo('ac_portal'));

-- ---------- permisos nuevos (valores recomendados; se cambian en Usuarios > Permisos de los roles) ----------
insert into public.rol_permisos (rol, permiso, alcance, editar) values
    ('direccion', 'ac_portal', 'todo', true), ('coordinacion', 'ac_portal', 'propio', false), ('profesora', 'ac_portal', 'propio', false),
    ('direccion', 'ac_programaciones', 'todo', true), ('coordinacion', 'ac_programaciones', 'todo', true), ('profesora', 'ac_programaciones', 'todo', false)
on conflict (rol, permiso) do nothing;
