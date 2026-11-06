-- Resumen mensual de las hojas "20xx.xx Ing" que no esta en IngresosBase:
--   * ingresos_metodo: cobros por modalidad de pago y mes (filas "Modalidad Pago" de la hoja).
--   * alumnos_mes: numero de alumnos por grupo y mes (filas "Nr Alumnos").
-- Las columnas "Pagado" y "Total" de la hoja coinciden en todas las celdas de los tres cursos
-- (comprobado el 06-nov-2026), asi que no se modela un "pagado" aparte.
-- Los cobros por modalidad NO suman el total de ingresos del mes: no incluyen el Welcome pack
-- ni parte de los extras (asi esta en el Excel).

create table if not exists public.ingresos_metodo (
    id uuid primary key default gen_random_uuid(),
    curso_id uuid not null references public.cursos(id),
    mes text not null,
    metodo text not null,      -- DOMICILIACION, TRANSFERENCIA, TPV / TARJETA, EFECTIVO, VARIOS
    importe numeric(12,2) not null default 0,
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    unique (curso_id, mes, metodo)
);

create table if not exists public.alumnos_mes (
    id uuid primary key default gen_random_uuid(),
    curso_id uuid not null references public.cursos(id),
    mes text not null,
    grupo text not null,       -- Babies, Kids, Teens, Adultos, 1 to 1, Empresas
    alumnos integer not null default 0,
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    unique (curso_id, mes, grupo)
);

alter table public.ingresos_metodo enable row level security;
alter table public.alumnos_mes enable row level security;

create policy "empleados leen ingresos_metodo" on public.ingresos_metodo for select to authenticated using (public.usuario_activo());
create policy "empleados escriben ingresos_metodo" on public.ingresos_metodo for insert to authenticated with check (public.usuario_activo());
create policy "empleados editan ingresos_metodo" on public.ingresos_metodo for update to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy "admin borra ingresos_metodo" on public.ingresos_metodo for delete to authenticated using (public.es_admin());

create policy "empleados leen alumnos_mes" on public.alumnos_mes for select to authenticated using (public.usuario_activo());
create policy "empleados escriben alumnos_mes" on public.alumnos_mes for insert to authenticated with check (public.usuario_activo());
create policy "empleados editan alumnos_mes" on public.alumnos_mes for update to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy "admin borra alumnos_mes" on public.alumnos_mes for delete to authenticated using (public.es_admin());

create trigger ingresos_metodo_set_updated
    before update on public.ingresos_metodo
    for each row execute procedure public.set_updated_audit();

create trigger alumnos_mes_set_updated
    before update on public.alumnos_mes
    for each row execute procedure public.set_updated_audit();
