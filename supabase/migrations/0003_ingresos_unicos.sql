-- Una sola cifra por curso + grupo + level + tipo + mes (el Welcome Pack no tiene mes).
-- Permite que la pantalla de Ingresos guarde cada celda sin crear duplicados.
create unique index if not exists ingresos_celda_unica
    on public.ingresos (curso_id, grupo, level, tipo, coalesce(mes, ''));

alter table public.ingresos add column if not exists updated_at timestamptz not null default now();
alter table public.ingresos add column if not exists updated_by uuid references public.profiles(id);

create trigger ingresos_set_updated
    before update on public.ingresos
    for each row execute procedure public.set_updated_audit();
