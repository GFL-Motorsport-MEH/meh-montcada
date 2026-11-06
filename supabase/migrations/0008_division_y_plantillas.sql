-- 1) Gastos divididos (entre meses o entre centros): las partes comparten division_id.
alter table public.gastos add column if not exists division_id uuid;
create index if not exists gastos_division_idx on public.gastos (division_id) where division_id is not null;

-- 2) Plantillas de gastos que se repiten (gastos mensuales y nominas), configurables desde la app.
--    En el concepto, {mes} se sustituye por el mes al generar (p.ej. "Nomina {mes}" -> "Nomina Octubre").
create table if not exists public.plantillas_gasto (
    id uuid primary key default gen_random_uuid(),
    grupo text not null check (grupo in ('mensual', 'nomina')),
    activo boolean not null default true,
    orden integer not null default 0,
    empresa text not null,
    concepto text,
    cantidad numeric(12,2),
    tipo text,
    categoria_id uuid references public.categorias(id),
    subcategoria_id uuid references public.subcategorias(id),
    metodo_pago text,
    periodicidad text default 'Mensual',
    dia_pago integer check (dia_pago between 1 and 31),
    centro_id uuid references public.centros(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
alter table public.plantillas_gasto enable row level security;
create policy "empleados leen plantillas" on public.plantillas_gasto for select to authenticated using (public.usuario_activo());
create policy "empleados escriben plantillas" on public.plantillas_gasto for insert to authenticated with check (public.usuario_activo());
create policy "empleados editan plantillas" on public.plantillas_gasto for update to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy "empleados borran plantillas" on public.plantillas_gasto for delete to authenticated using (public.usuario_activo());
create trigger plantillas_set_updated before update on public.plantillas_gasto for each row execute procedure public.set_updated_audit();
