-- =====================================================================
-- 0100: módulo ACADEMIA (alumnos, grupos, horarios, cuotas, remesas, bajas, seguimiento, tutorías,
--       tareas y protocolos).
--
-- Todas las tablas empiezan por ac_ para no mezclarse con Facturación. Numeración 0100+ para no chocar
-- con las migraciones 00xx de Facturación. Solo CREATE/ALTER (nada de DROP).
--
-- Un alumno existe UNA sola vez (ac_alumnos): grupos, cuotas, bajas, anotaciones y tutorías apuntan a su id,
-- así el nombre es siempre el mismo en todas las pantallas.
-- Permisos (RLS, igual que Facturación): leer = admin/empleado/consulta; escribir = admin/empleado;
-- borrar = solo admin. El rol «escáner» no ve nada de Academia. DNI e IBAN van en una tabla aparte
-- que solo leen admin/empleado.
-- =====================================================================

-- ---------- listas editables de Academia ----------
create table if not exists public.ac_listas (
    id uuid primary key default gen_random_uuid(),
    lista text not null check (lista in ('modalidad', 'nivel', 'colegio', 'como_conocio', 'metodo_pago', 'motivo_baja',
                                         'tipo_anotacion', 'situacion_contacto', 'categoria_documento', 'descuento')),
    valor text not null,
    orden integer not null default 0,
    created_at timestamptz not null default now()
);
create unique index if not exists ac_listas_valor_idx on public.ac_listas (lista, lower(valor));

-- ---------- responsables (padre/madre/tutor) ----------
create table if not exists public.ac_responsables (
    id uuid primary key default gen_random_uuid(),
    apellidos text not null default '',
    nombre text not null default '',
    email text,
    telefono text,
    crm_id text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists ac_responsables_nombre_idx on public.ac_responsables (lower(apellidos), lower(nombre));

-- datos sensibles del responsable: solo los ve quien puede editar (no el rol «consulta»)
create table if not exists public.ac_responsables_priv (
    responsable_id uuid primary key references public.ac_responsables(id) on delete cascade,
    dni text,
    iban text,
    titular_iban text,
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);

-- ---------- profesoras y aulas ----------
create table if not exists public.ac_profesoras (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    color text not null default '#4f7cff',
    activa boolean not null default true,
    orden integer not null default 0,
    profile_id uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create unique index if not exists ac_profesoras_nombre_idx on public.ac_profesoras (lower(nombre));

create table if not exists public.ac_aulas (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    centro_id uuid references public.centros(id) default public.centro_principal(),
    capacidad integer,
    activa boolean not null default true,
    orden integer not null default 0,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create unique index if not exists ac_aulas_nombre_idx on public.ac_aulas (centro_id, lower(nombre));

-- ---------- alumnos ----------
create table if not exists public.ac_alumnos (
    id uuid primary key default gen_random_uuid(),
    num integer,                                   -- «ID» del Excel (se conserva para enlazar con la hoja antigua)
    apellidos text not null,
    nombre text not null,
    nombre_completo text generated always as (trim(nombre || ' ' || apellidos)) stored,
    fecha_nacimiento date,
    colegio text,
    responsable_id uuid references public.ac_responsables(id) on delete set null,
    estado text not null default 'inscrito' check (estado in ('inscrito', 'prematricula', 'baja', 'antiguo')),
    fecha_entrada date,
    fecha_baja date,
    modalidad text,
    nivel text,
    metodo_pago text,
    como_nos_conocio text,
    intolerancias text,
    info text,
    autoriza_rrss boolean not null default false,
    codigo_postal text,
    centro_id uuid references public.centros(id) default public.centro_principal(),
    crm_id text,                                   -- id en el CRM de la franquicia (Meharic), para sincronizar
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create unique index if not exists ac_alumnos_num_idx on public.ac_alumnos (num) where num is not null;
create index if not exists ac_alumnos_nombre_idx on public.ac_alumnos (lower(apellidos), lower(nombre));
create index if not exists ac_alumnos_estado_idx on public.ac_alumnos (estado);
create index if not exists ac_alumnos_resp_idx on public.ac_alumnos (responsable_id);

-- ---------- inscripción por curso (cuotas pactadas) ----------
create table if not exists public.ac_inscripciones (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    curso_id uuid not null references public.cursos(id),
    cuota_mensual numeric(8, 2) not null default 0,
    welcome_pack numeric(8, 2) not null default 0,
    descuento text,
    activa boolean not null default true,
    notas text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    unique (alumno_id, curso_id)
);
create index if not exists ac_inscripciones_curso_idx on public.ac_inscripciones (curso_id);

-- ---------- grupos y horarios ----------
create table if not exists public.ac_grupos (
    id uuid primary key default gen_random_uuid(),
    curso_id uuid not null references public.cursos(id),
    nombre text not null,                          -- p.ej. KIDS 1, TEENS 5, ADULTS 6
    modalidad text,                                -- Babies / Kids / Teens / Adults / 1 to 1 / Extraescolar…
    nivel text,                                    -- L1, A2, B1…
    profesora_id uuid references public.ac_profesoras(id) on delete set null,
    aula_id uuid references public.ac_aulas(id) on delete set null,
    capacidad integer not null default 8,
    anios_nacimiento text,
    activo boolean not null default true,
    notas text,
    centro_id uuid references public.centros(id) default public.centro_principal(),
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create unique index if not exists ac_grupos_nombre_idx on public.ac_grupos (curso_id, lower(nombre));

create table if not exists public.ac_sesiones (
    id uuid primary key default gen_random_uuid(),
    grupo_id uuid not null references public.ac_grupos(id) on delete cascade,
    dia smallint not null check (dia between 1 and 7),   -- 1 = lunes … 7 = domingo
    hora_inicio time not null,
    hora_fin time not null,
    aula_id uuid references public.ac_aulas(id) on delete set null,          -- si es distinta a la del grupo
    profesora_id uuid references public.ac_profesoras(id) on delete set null, -- si es distinta a la del grupo
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    check (hora_fin > hora_inicio)
);
create index if not exists ac_sesiones_grupo_idx on public.ac_sesiones (grupo_id);

create table if not exists public.ac_alumno_grupo (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    grupo_id uuid not null references public.ac_grupos(id) on delete cascade,
    fecha_alta date default current_date,
    fecha_baja date,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    unique (alumno_id, grupo_id)
);
create index if not exists ac_alumno_grupo_grupo_idx on public.ac_alumno_grupo (grupo_id);

-- ---------- remesas y cuotas ----------
create table if not exists public.ac_remesas (
    id uuid primary key default gen_random_uuid(),
    curso_id uuid not null references public.cursos(id),
    mes text not null check (mes in ('septiembre', 'octubre', 'noviembre', 'diciembre', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto')),
    nombre text,
    fecha_cargo date,
    estado text not null default 'borrador' check (estado in ('borrador', 'enviada', 'cerrada')),
    comentario text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists ac_remesas_curso_idx on public.ac_remesas (curso_id, mes);

create table if not exists public.ac_cuotas (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    curso_id uuid not null references public.cursos(id),
    concepto text not null default 'mensualidad' check (concepto in ('welcome_pack', 'mensualidad', 'otro')),
    mes text not null default '' check (mes in ('', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto')),
    importe numeric(8, 2) not null default 0,
    estado text not null default 'pendiente' check (estado in ('pendiente', 'pagado', 'devuelto', 'exento')),
    fecha_pago date,
    metodo_pago text,
    remesa_id uuid references public.ac_remesas(id) on delete set null,
    comentario text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    unique (alumno_id, curso_id, concepto, mes)
);
create index if not exists ac_cuotas_curso_mes_idx on public.ac_cuotas (curso_id, mes);
create index if not exists ac_cuotas_remesa_idx on public.ac_cuotas (remesa_id);

-- ---------- bajas ----------
create table if not exists public.ac_bajas (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    curso_id uuid references public.cursos(id),
    fecha_alta date,
    fecha_baja date not null default current_date,
    motivo text,
    comentarios text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists ac_bajas_alumno_idx on public.ac_bajas (alumno_id);

-- ---------- seguimiento: contactos que aún no son alumnos ----------
create table if not exists public.ac_contactos (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    telefono text,
    edad text,
    nivel text,
    comentarios text,
    como_nos_conocio text,
    situacion text not null default 'posible alumno',
    fecha_contacto date default current_date,
    alumno_id uuid references public.ac_alumnos(id) on delete set null,   -- cuando se convierte en alumno
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists ac_contactos_situacion_idx on public.ac_contactos (situacion);

-- ---------- seguimiento de alumnos: anotaciones y tutorías ----------
create table if not exists public.ac_tutorias (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    curso_id uuid references public.cursos(id),
    fecha date not null default current_date,
    hora time,
    profesora_id uuid references public.ac_profesoras(id) on delete set null,
    formato text not null default 'presencial' check (formato in ('presencial', 'telefono', 'online')),
    motivo text,
    acuerdos text,
    estado text not null default 'pendiente' check (estado in ('pendiente', 'hecha', 'cancelada')),
    proxima_fecha date,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists ac_tutorias_alumno_idx on public.ac_tutorias (alumno_id, fecha desc);
create index if not exists ac_tutorias_estado_idx on public.ac_tutorias (estado, fecha);

create table if not exists public.ac_anotaciones (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    fecha date not null default current_date,
    tipo text not null default 'nota',
    texto text not null,
    profesora_id uuid references public.ac_profesoras(id) on delete set null,
    tutoria_id uuid references public.ac_tutorias(id) on delete set null,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists ac_anotaciones_alumno_idx on public.ac_anotaciones (alumno_id, fecha desc);

-- ---------- tareas (sustituye a la lista de Google Keep) ----------
create table if not exists public.ac_tareas (
    id uuid primary key default gen_random_uuid(),
    titulo text not null,
    notas text,
    items jsonb not null default '[]'::jsonb,       -- lista de comprobación: [{"t":"texto","ok":false}]
    hecha boolean not null default false,
    hecha_at timestamptz,
    vence date,
    prioridad smallint not null default 0 check (prioridad between 0 and 2),
    etiqueta text,
    asignado_a uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists ac_tareas_hecha_idx on public.ac_tareas (hecha, vence);

-- ---------- documentación y protocolos ----------
create table if not exists public.ac_documentos (
    id uuid primary key default gen_random_uuid(),
    titulo text not null,
    categoria text,
    contenido text not null default '',
    version integer not null default 1,
    estado text not null default 'vigente' check (estado in ('borrador', 'vigente', 'archivado')),
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists ac_documentos_cat_idx on public.ac_documentos (categoria);

-- ---------- auditoría automática (updated_at / updated_by) ----------
do $$
declare t text;
begin
  foreach t in array array['ac_responsables', 'ac_profesoras', 'ac_aulas', 'ac_alumnos', 'ac_inscripciones', 'ac_grupos', 'ac_sesiones',
                           'ac_alumno_grupo', 'ac_remesas', 'ac_cuotas', 'ac_bajas', 'ac_contactos', 'ac_tutorias', 'ac_anotaciones',
                           'ac_tareas', 'ac_documentos', 'ac_responsables_priv']
  loop
    execute format('create trigger %I before update on public.%I for each row execute procedure public.set_updated_audit()', t || '_set_updated', t);
  end loop;
end $$;

-- ---------- seguridad (RLS) ----------
do $$
declare t text;
begin
  foreach t in array array['ac_listas', 'ac_responsables', 'ac_profesoras', 'ac_aulas', 'ac_alumnos', 'ac_inscripciones', 'ac_grupos', 'ac_sesiones',
                           'ac_alumno_grupo', 'ac_remesas', 'ac_cuotas', 'ac_bajas', 'ac_contactos', 'ac_tutorias', 'ac_anotaciones',
                           'ac_tareas', 'ac_documentos', 'ac_responsables_priv']
  loop
    execute format('alter table public.%I enable row level security', t);
    if t = 'ac_responsables_priv' then
      execute format('create policy leer on public.%I for select to authenticated using (public.puede_editar())', t);
    else
      execute format('create policy leer on public.%I for select to authenticated using (public.usuario_activo())', t);
    end if;
    execute format('create policy insertar on public.%I for insert to authenticated with check (public.puede_editar())', t);
    execute format('create policy modificar on public.%I for update to authenticated using (public.puede_editar()) with check (public.puede_editar())', t);
    -- borrar: solo admin (las tareas y anotaciones también las borra quien edita: son notas del día a día)
    if t in ('ac_tareas', 'ac_anotaciones') then
      execute format('create policy borrar on public.%I for delete to authenticated using (public.puede_editar())', t);
    else
      execute format('create policy borrar on public.%I for delete to authenticated using (public.es_admin())', t);
    end if;
  end loop;
end $$;

-- ---------- generar las mensualidades de un mes ----------
-- Crea una cuota «pendiente» por cada inscripción activa con cuota mensual > 0 que aún no la tenga.
-- Si el alumno está de baja o ya tiene su baja anterior al mes, no se genera. Devuelve cuántas ha creado.
create or replace function public.ac_generar_cuotas(p_curso uuid, p_mes text)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare n integer;
begin
    if not public.puede_editar() then
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
revoke execute on function public.ac_generar_cuotas(uuid, text) from public, anon;
grant execute on function public.ac_generar_cuotas(uuid, text) to authenticated;

-- ---------- valores iniciales de las listas (los que usa el Excel) ----------
insert into public.ac_listas (lista, valor, orden) values
    ('modalidad', 'Babies', 1), ('modalidad', 'Kids', 2), ('modalidad', 'Teens', 3), ('modalidad', 'Adults', 4), ('modalidad', '1 to 1', 5), ('modalidad', 'Extraescolar', 6),
    ('metodo_pago', 'Domiciliacion', 1), ('metodo_pago', 'TPV / Tarjeta', 2), ('metodo_pago', 'Efectivo', 3), ('metodo_pago', 'Transferencia', 4),
    ('motivo_baja', 'Incompatibilidad horaria', 1), ('motivo_baja', 'Cambio de residencia', 2), ('motivo_baja', 'Motivos económicos', 3), ('motivo_baja', 'Cambio de actividad', 4), ('motivo_baja', 'Otros', 9),
    ('tipo_anotacion', 'nota', 1), ('tipo_anotacion', 'llamada', 2), ('tipo_anotacion', 'familia', 3), ('tipo_anotacion', 'incidencia', 4), ('tipo_anotacion', 'pago', 5), ('tipo_anotacion', 'progreso', 6),
    ('situacion_contacto', 'posible alumno', 1), ('situacion_contacto', 'prueba', 2), ('situacion_contacto', 'inscrito', 3), ('situacion_contacto', 'descartado', 4),
    ('categoria_documento', 'Protocolo', 1), ('categoria_documento', 'Familias', 2), ('categoria_documento', 'Profesoras', 3), ('categoria_documento', 'Pagos y cobros', 4), ('categoria_documento', 'Seguridad', 5),
    ('como_conocio', 'Colegio', 1), ('como_conocio', 'Recomendación', 2), ('como_conocio', 'Redes sociales', 3), ('como_conocio', 'Web', 4), ('como_conocio', 'Pasaba por la calle', 5),
    ('descuento', 'Hermanos', 1), ('descuento', 'AMPA', 2), ('descuento', 'Antiguo alumno', 3)
on conflict do nothing;
