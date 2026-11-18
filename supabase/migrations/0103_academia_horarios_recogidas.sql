-- Horarios: horas contratadas por profesora. Recogidas: servicio de recogida/extraescolares por alumno y personas autorizadas.
alter table public.ac_profesoras add column if not exists horas_semana numeric(5, 1);

-- Servicio de recogida: de dónde (colegio / extraescolar) hasta la academia, qué días, a qué hora y si puede salir solo.
create table if not exists public.ac_recogidas (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    curso_id uuid not null references public.cursos(id),
    servicio text not null default 'tarde' check (servicio in ('tarde', 'extraescolar', 'otro')),
    centro text,                        -- colegio o escuela de origen (Mas Rampinyo, Elvira Cuyas, FEDAC…)
    dias smallint[] not null default '{}',   -- 1 = lunes … 5 = viernes
    hora_recogida time,
    sale_solo boolean not null default false,   -- autorizado a salir sin acompañante al terminar
    autorizacion_firmada boolean not null default false,
    fecha_autorizacion date,
    observaciones text,
    activa boolean not null default true,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists ac_recogidas_alumno_idx on public.ac_recogidas (alumno_id);
create index if not exists ac_recogidas_curso_idx on public.ac_recogidas (curso_id, activa);

-- Personas autorizadas a recoger al alumno (sin DNI: el DNI va aparte, solo visible para quien edita).
create table if not exists public.ac_autorizados (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    nombre text not null,
    parentesco text,
    telefono text,
    orden integer not null default 0,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists ac_autorizados_alumno_idx on public.ac_autorizados (alumno_id);

create table if not exists public.ac_autorizados_priv (
    autorizado_id uuid primary key references public.ac_autorizados(id) on delete cascade,
    dni text,
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);

do $$
declare t text;
begin
  foreach t in array array['ac_recogidas', 'ac_autorizados', 'ac_autorizados_priv']
  loop
    execute format('create trigger %I before update on public.%I for each row execute procedure public.set_updated_audit()', t || '_set_updated', t);
    execute format('alter table public.%I enable row level security', t);
    if t = 'ac_autorizados_priv' then
      execute format('create policy leer on public.%I for select to authenticated using (public.puede_editar())', t);
    else
      execute format('create policy leer on public.%I for select to authenticated using (public.usuario_activo())', t);
    end if;
    execute format('create policy insertar on public.%I for insert to authenticated with check (public.puede_editar())', t);
    execute format('create policy modificar on public.%I for update to authenticated using (public.puede_editar()) with check (public.puede_editar())', t);
    execute format('create policy borrar on public.%I for delete to authenticated using (public.puede_editar())', t);
  end loop;
end $$;
