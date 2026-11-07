-- FactCHECK: valores que introduce Gustavo a mano para cruzar ingresos (control de alumnos) vs facturacion vs banco.
-- periodo = 'YYYY-MM' (mes natural). campo = p.ej. 'banco_total', 'banco_domiciliacion', 'banco_tpv', 'banco_transferencia',
-- 'banco_efectivo', 'nota'. Los demas datos se calculan en la app a partir de las otras pestañas.
create table if not exists public.factcheck_manual (
    id uuid primary key default gen_random_uuid(),
    periodo text not null check (periodo ~ '^\d{4}-\d{2}$'),
    campo text not null,
    valor numeric(12,2),
    texto text,
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    unique (periodo, campo)
);
alter table public.factcheck_manual enable row level security;
create policy "empleados leen factcheck" on public.factcheck_manual for select to authenticated using (public.usuario_activo());
create policy "empleados escriben factcheck" on public.factcheck_manual for insert to authenticated with check (public.usuario_activo());
create policy "empleados editan factcheck" on public.factcheck_manual for update to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create trigger factcheck_set_updated before update on public.factcheck_manual for each row execute procedure public.set_updated_audit();
