-- 0017: resaltado manual de gastos (amarillo) y orden por último movimiento
alter table public.gastos add column if not exists resaltado boolean not null default false;
create index if not exists gastos_created_at on public.gastos (created_at desc);
