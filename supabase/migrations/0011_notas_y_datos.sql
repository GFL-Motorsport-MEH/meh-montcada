-- Hoja Notas: cuaderno de revisiones (fecha, ultimo cargo revisado, comentarios).
create table if not exists public.notas (
    id uuid primary key default gen_random_uuid(),
    fecha date not null default current_date,
    ultimo_cargo text,
    comentario text,
    hecho boolean not null default false,
    created_at timestamptz not null default now(),
    created_by uuid references public.profiles(id) default auth.uid(),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
alter table public.notas enable row level security;
create policy "empleados leen notas" on public.notas for select to authenticated using (public.usuario_activo());
create policy "empleados escriben notas" on public.notas for insert to authenticated with check (public.usuario_activo());
create policy "empleados editan notas" on public.notas for update to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy "admin borra notas" on public.notas for delete to authenticated using (public.es_admin());
create trigger notas_set_updated before update on public.notas for each row execute procedure public.set_updated_audit();

-- Hoja Datos interes: tarifas por grupo (ingreso por hora) y parametros de costes por hora.
create table if not exists public.tarifas (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    cuota numeric(10,2),
    horas_mes numeric(6,2),
    max_grupo integer,
    orden integer not null default 0
);
create table if not exists public.parametros (
    clave text primary key,
    valor numeric(12,2),
    etiqueta text,
    orden integer not null default 0
);
alter table public.tarifas enable row level security;
alter table public.parametros enable row level security;
create policy "empleados leen tarifas" on public.tarifas for select to authenticated using (public.usuario_activo());
create policy "admin gestiona tarifas" on public.tarifas for all to authenticated using (public.es_admin()) with check (public.es_admin());
create policy "empleados leen parametros" on public.parametros for select to authenticated using (public.usuario_activo());
create policy "admin gestiona parametros" on public.parametros for all to authenticated using (public.es_admin()) with check (public.es_admin());

insert into public.tarifas (nombre, cuota, horas_mes, max_grupo, orden) values
    ('Babies', 55, 3, 6, 0), ('Kids 1 dia', 55, 4, 10, 1), ('Kids 2 dias', 75, 8, 10, 2),
    ('Teenagers', 85, 8, 6, 3), ('Adults', 95, 12, 6, 4), ('1to1', 21, 1, 1, 5);
insert into public.parametros (clave, valor, etiqueta, orden) values
    ('coste_hora_profesor', 25, 'Coste por hora de profesor', 0),
    ('horas_semanales', 45, 'Horas de clase a la semana', 1),
    ('gastos_mes_material', 350, 'Gastos mensuales de clases (material)', 2),
    ('gastos_mes_local', 3000, 'Gastos mensuales del local', 3),
    ('gastos_mes_gestion', 1200, 'Gastos mensuales gestoría / MEH / banco', 4)
on conflict (clave) do nothing;
