-- 0127: módulo ALUMNOS (base del futuro portal de familias).
-- Cuelga de ac_alumnos (y de sus tutorías, grupos, biblioteca/mascotas y calendario, que ya existen).
-- Cada fila que una familia podrá ver lleva «visible_familia» (o estado = 'publicado' en informes): el portal solo enseñará lo marcado.
-- Permisos nuevos (tipo «propio»: la profesora ve/edita a SUS alumnos = los de sus grupos o tutorías; coordinación y dirección, a todos):
--   al_ficha · al_notas · al_tareas · al_informes · al_comunicaciones · al_documentos · al_actividades (esta última tipo «todo»)
-- Solo CREATE / ALTER ADD / INSERT / CREATE OR REPLACE (sin borrados).

-- ---------- enlace de la familia con su usuario del futuro portal ----------
alter table public.ac_responsables add column if not exists user_id uuid references auth.users(id);
create index if not exists ac_responsables_user_idx on public.ac_responsables (user_id) where user_id is not null;

create or replace function public.es_mi_hijo(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.ac_alumnos x join public.ac_responsables r on r.id = x.responsable_id where x.id = a and r.user_id = auth.uid());
$$;
create or replace function public.es_familia()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.ac_responsables r where r.user_id = auth.uid());
$$;

-- las anotaciones de las profesoras (Seguimiento) pueden marcarse como visibles para la familia
alter table public.ac_anotaciones add column if not exists visible_familia boolean not null default false;

-- ---------- notas / evaluaciones ----------
create table if not exists public.al_evaluaciones (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    curso_id uuid references public.cursos(id),
    periodo text not null default '1T',                 -- 1T, 2T, 3T, Final, Test de nivel, Otro
    area text not null default 'Global',                -- Speaking, Listening, Reading, Writing, Grammar, Vocabulary, Participación, Global…
    nota numeric(4, 2),                                 -- 0–10 (vacío si solo hay valoración)
    valoracion text,                                    -- comentario o nivel cualitativo
    fecha date not null default current_date,
    profesora_id uuid references public.ac_profesoras(id),
    visible_familia boolean not null default false,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    check (nota is null or nota between 0 and 10)
);
create index if not exists al_evaluaciones_alumno_idx on public.al_evaluaciones (alumno_id, fecha desc);

-- ---------- tareas extra y material didáctico (una fila por alumno; al asignar a un grupo se crean varias con el mismo lote) ----------
create table if not exists public.al_tareas_extra (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    grupo_id uuid references public.ac_grupos(id) on delete set null,
    lote uuid,                                          -- une las filas creadas a la vez para un grupo
    tipo text not null default 'tarea' check (tipo in ('tarea', 'material')),
    titulo text not null,
    descripcion text,
    enlace text,
    ruta text,                                          -- archivo en el bucket privado «alumnos-material»
    nombre_archivo text,
    fecha_asignada date not null default current_date,
    fecha_entrega date,
    estado text not null default 'pendiente' check (estado in ('pendiente', 'entregada', 'revisada')),
    profesora_id uuid references public.ac_profesoras(id),
    visible_familia boolean not null default true,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists al_tareas_alumno_idx on public.al_tareas_extra (alumno_id, fecha_asignada desc);

-- ---------- informes (trimestrales, de nivel…) ----------
create table if not exists public.al_informes (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    curso_id uuid references public.cursos(id),
    periodo text not null default '1T',
    titulo text not null,
    contenido text,
    ruta text,                                          -- PDF opcional en «alumnos-material»
    nombre_archivo text,
    estado text not null default 'borrador' check (estado in ('borrador', 'publicado')),
    publicado_at timestamptz,
    profesora_id uuid references public.ac_profesoras(id),
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists al_informes_alumno_idx on public.al_informes (alumno_id, created_at desc);

-- ---------- comunicaciones centro ↔ familia ----------
create table if not exists public.al_mensajes (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    sentido text not null default 'a_familia' check (sentido in ('a_familia', 'de_familia')),
    canal text not null default 'portal' check (canal in ('portal', 'email', 'telefono', 'whatsapp', 'presencial', 'otro')),
    asunto text not null,
    texto text,
    visible_familia boolean not null default true,
    leido_at timestamptz,                               -- cuándo lo leyó el centro (si viene de la familia) o la familia (si va a ella)
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists al_mensajes_alumno_idx on public.al_mensajes (alumno_id, created_at desc);

-- ---------- documentación que aportan las familias (DNI, autorización de recogida…) ----------
create table if not exists public.al_documentos_familia (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    tipo text not null default 'otro' check (tipo in ('dni_responsable', 'dni_autorizado', 'autorizacion_recogida', 'libro_familia', 'tarjeta_sanitaria', 'autorizacion_imagen', 'otro')),
    titulo text,
    ruta text not null,                                 -- bucket privado «alumnos-docs»; ruta = <alumno_id>/<fecha>-<nombre>
    nombre_archivo text,
    origen text not null default 'centro' check (origen in ('centro', 'familia')),
    estado text not null default 'revisado' check (estado in ('pendiente', 'revisado', 'rechazado')),
    caduca date,
    notas text,
    visible_familia boolean not null default true,      -- la familia ve que lo ha entregado
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists al_docfam_alumno_idx on public.al_documentos_familia (alumno_id, created_at desc);

-- ---------- actividades (salidas, talleres, extraescolares…) y quién se ha apuntado ----------
create table if not exists public.al_actividades (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    descripcion text,
    fecha date,
    fecha_fin date,
    lugar text,
    precio numeric(8, 2),
    plazas integer,
    formulario_id uuid references public.ac_formularios(id) on delete set null,   -- formulario con el que se apuntan las familias
    curso_id uuid references public.cursos(id),
    centro_id uuid references public.centros(id),
    activa boolean not null default true,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create table if not exists public.al_actividad_inscritos (
    id uuid primary key default gen_random_uuid(),
    actividad_id uuid not null references public.al_actividades(id) on delete cascade,
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    estado text not null default 'apuntado' check (estado in ('apuntado', 'lista_espera', 'cancelado')),
    respuesta_id uuid references public.ac_formulario_respuestas(id) on delete set null,
    pagado boolean not null default false,
    notas text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    unique (actividad_id, alumno_id)
);
create index if not exists al_inscritos_alumno_idx on public.al_actividad_inscritos (alumno_id);

-- ---------- triggers de auditoría, RLS y permisos de tabla ----------
do $$
declare t text;
begin
    foreach t in array array['al_evaluaciones', 'al_tareas_extra', 'al_informes', 'al_mensajes', 'al_documentos_familia', 'al_actividades', 'al_actividad_inscritos'] loop
        execute format('create trigger %I before update on public.%I for each row execute procedure public.set_updated_audit()', t || '_set_updated', t);
        execute format('alter table public.%I enable row level security', t);
        execute format('grant all on public.%I to authenticated', t);
    end loop;
end $$;

-- Tablas colgadas de un alumno: cada permiso da «lo suyo» (es_mi_alumno) o «todo»; el centro se aplica además con una política restrictiva.
do $$
declare r record;
begin
    for r in select * from (values
        ('al_evaluaciones', 'al_notas'), ('al_tareas_extra', 'al_tareas'), ('al_informes', 'al_informes'), ('al_mensajes', 'al_comunicaciones'), ('al_documentos_familia', 'al_documentos')
    ) as v(tabla, permiso) loop
        execute format('create policy leer on public.%I for select to authenticated using (public.perm_ve(%L) or (public.perm_alcance(%L) = ''propio'' and public.es_mi_alumno(alumno_id)))', r.tabla, r.permiso, r.permiso);
        execute format('create policy insertar on public.%I for insert to authenticated with check (public.perm_edita_todo(%L) or (public.perm_edita(%L) and public.perm_alcance(%L) = ''propio'' and public.es_mi_alumno(alumno_id)))', r.tabla, r.permiso, r.permiso, r.permiso);
        execute format('create policy modificar on public.%I for update to authenticated using (public.perm_edita_todo(%L) or (public.perm_edita(%L) and public.perm_alcance(%L) = ''propio'' and public.es_mi_alumno(alumno_id))) with check (public.perm_edita_todo(%L) or (public.perm_edita(%L) and public.perm_alcance(%L) = ''propio'' and public.es_mi_alumno(alumno_id)))', r.tabla, r.permiso, r.permiso, r.permiso, r.permiso, r.permiso, r.permiso);
        execute format('create policy borrar on public.%I for delete to authenticated using (public.perm_edita_todo(%L) or (public.perm_edita(%L) and public.perm_alcance(%L) = ''propio'' and public.es_mi_alumno(alumno_id)))', r.tabla, r.permiso, r.permiso, r.permiso);
        execute format('create policy centro on public.%I as restrictive for all to authenticated using ((select public.mi_centro()) is null or public.alumno_centro_ok(alumno_id)) with check ((select public.mi_centro()) is null or public.alumno_centro_ok(alumno_id))', r.tabla);
    end loop;
end $$;

-- Actividades: permiso «todo» (ver / editar); las inscripciones también cuelgan de un alumno
create policy leer on public.al_actividades for select to authenticated using (public.perm_ve('al_actividades'));
create policy escribir on public.al_actividades for all to authenticated using (public.perm_edita_todo('al_actividades')) with check (public.perm_edita_todo('al_actividades'));
create policy centro on public.al_actividades as restrictive for all to authenticated using ((select public.mi_centro()) is null or public.centro_ok(centro_id)) with check ((select public.mi_centro()) is null or public.centro_ok(centro_id));
create policy leer on public.al_actividad_inscritos for select to authenticated using (public.perm_ve('al_actividades'));
create policy escribir on public.al_actividad_inscritos for all to authenticated using (public.perm_edita_todo('al_actividades')) with check (public.perm_edita_todo('al_actividades'));
create policy centro on public.al_actividad_inscritos as restrictive for all to authenticated using ((select public.mi_centro()) is null or public.alumno_centro_ok(alumno_id)) with check ((select public.mi_centro()) is null or public.alumno_centro_ok(alumno_id));

-- ---------- lo que verá una familia en el futuro portal (solo lectura, solo sus hijos y solo lo marcado como visible) ----------
create policy familia_ve on public.al_evaluaciones for select to authenticated using (visible_familia and public.es_mi_hijo(alumno_id));
create policy familia_ve on public.al_tareas_extra for select to authenticated using (visible_familia and public.es_mi_hijo(alumno_id));
create policy familia_ve on public.al_informes for select to authenticated using (estado = 'publicado' and public.es_mi_hijo(alumno_id));
create policy familia_ve on public.al_mensajes for select to authenticated using (visible_familia and public.es_mi_hijo(alumno_id));
create policy familia_ve on public.al_documentos_familia for select to authenticated using (visible_familia and public.es_mi_hijo(alumno_id));
create policy familia_ve on public.al_actividad_inscritos for select to authenticated using (public.es_mi_hijo(alumno_id));
create policy familia_ve on public.al_actividades for select to authenticated using (activa and public.es_familia());
create policy familia_ve on public.ac_anotaciones for select to authenticated using (visible_familia and public.es_mi_hijo(alumno_id));

-- ---------- archivos (dos buckets privados; la primera carpeta de la ruta es el id del alumno) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('alumnos-docs', 'alumnos-docs', false, 15728640), ('alumnos-material', 'alumnos-material', false, 26214400)
on conflict (id) do nothing;

-- ¿puede este usuario leer (o escribir) el archivo de esa ruta? Misma regla que las tablas: lo suyo o todo, según el permiso.
create or replace function public.al_archivo_ok(nombre text, permiso text, escribir boolean)
returns boolean language sql stable security definer set search_path = public as $$
    with a as (select case when (storage.foldername(nombre))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then ((storage.foldername(nombre))[1])::uuid end as id)
    select coalesce((select case when escribir
        then public.perm_edita_todo(permiso) or (public.perm_edita(permiso) and public.perm_alcance(permiso) = 'propio' and public.es_mi_alumno(a.id))
        else public.perm_ve(permiso) or (public.perm_alcance(permiso) = 'propio' and public.es_mi_alumno(a.id)) end
        from a where a.id is not null), false);
$$;
create policy "alumnos-docs lee" on storage.objects for select to authenticated using (bucket_id = 'alumnos-docs' and public.al_archivo_ok(name, 'al_documentos', false));
create policy "alumnos-docs sube" on storage.objects for insert to authenticated with check (bucket_id = 'alumnos-docs' and public.al_archivo_ok(name, 'al_documentos', true));
create policy "alumnos-docs cambia" on storage.objects for update to authenticated using (bucket_id = 'alumnos-docs' and public.al_archivo_ok(name, 'al_documentos', true));
create policy "alumnos-docs borra" on storage.objects for delete to authenticated using (bucket_id = 'alumnos-docs' and public.al_archivo_ok(name, 'al_documentos', true));
-- el material y los informes en PDF los ven quienes tengan Tareas o Informes
create policy "alumnos-material lee" on storage.objects for select to authenticated using (bucket_id = 'alumnos-material' and (public.al_archivo_ok(name, 'al_tareas', false) or public.al_archivo_ok(name, 'al_informes', false)));
create policy "alumnos-material sube" on storage.objects for insert to authenticated with check (bucket_id = 'alumnos-material' and (public.al_archivo_ok(name, 'al_tareas', true) or public.al_archivo_ok(name, 'al_informes', true)));
create policy "alumnos-material cambia" on storage.objects for update to authenticated using (bucket_id = 'alumnos-material' and (public.al_archivo_ok(name, 'al_tareas', true) or public.al_archivo_ok(name, 'al_informes', true)));
create policy "alumnos-material borra" on storage.objects for delete to authenticated using (bucket_id = 'alumnos-material' and (public.al_archivo_ok(name, 'al_tareas', true) or public.al_archivo_ok(name, 'al_informes', true)));

-- quien tiene algún permiso de Alumnos también cuenta como usuario del módulo de gestión (lista del equipo, etc.)
create or replace function public.ac_acceso()
returns boolean language sql stable security definer set search_path = public as $$
    select coalesce((select pr.rol = 'admin' or exists (select 1 from public.rol_permisos rp where rp.rol = pr.rol and (rp.permiso like 'ac\_%' or rp.permiso like 'tr\_%' or rp.permiso like 'al\_%'))
                     from public.profiles pr where pr.id = auth.uid() and pr.activo), false);
$$;

-- ---------- permisos recomendados (se cambian en Usuarios > Permisos de los roles) ----------
-- Profesora: lo de sus alumnos (notas, tareas, informes, comunicaciones); sin documentación de familias (DNI) salvo que se le dé.
insert into public.rol_permisos (rol, permiso, alcance, editar) values
    ('direccion', 'al_ficha', 'todo', true), ('direccion', 'al_notas', 'todo', true), ('direccion', 'al_tareas', 'todo', true), ('direccion', 'al_informes', 'todo', true),
    ('direccion', 'al_comunicaciones', 'todo', true), ('direccion', 'al_documentos', 'todo', true), ('direccion', 'al_actividades', 'todo', true),
    ('coordinacion', 'al_ficha', 'todo', true), ('coordinacion', 'al_notas', 'todo', true), ('coordinacion', 'al_tareas', 'todo', true), ('coordinacion', 'al_informes', 'todo', true),
    ('coordinacion', 'al_comunicaciones', 'todo', true), ('coordinacion', 'al_documentos', 'todo', true), ('coordinacion', 'al_actividades', 'todo', true),
    ('profesora', 'al_ficha', 'propio', false), ('profesora', 'al_notas', 'propio', true), ('profesora', 'al_tareas', 'propio', true), ('profesora', 'al_informes', 'propio', true),
    ('profesora', 'al_comunicaciones', 'propio', true), ('profesora', 'al_actividades', 'todo', false)
on conflict (rol, permiso) do nothing;
