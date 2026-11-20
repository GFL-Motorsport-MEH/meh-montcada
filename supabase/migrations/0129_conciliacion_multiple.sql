-- 0129: conciliación bancaria muchos-a-muchos.
--   · una factura/gasto puede pagarse con 2 o más movimientos del banco
--   · un movimiento del banco puede pagar 2 o más facturas/gastos
--   · los abonos (gastos con importe negativo) se enlazan con el movimiento positivo de la devolución
-- Cada fila = "este movimiento cubre este importe de este gasto". Se rellena a partir de movimientos_banco.gasto_id (que se mantiene
-- como enlace principal por compatibilidad). Solo añade una tabla: no cambia nada de lo existente.
create table if not exists public.movimiento_gastos (
    id uuid primary key default gen_random_uuid(),
    movimiento_id uuid not null references public.movimientos_banco(id) on delete cascade,
    gasto_id uuid not null references public.gastos(id) on delete cascade,
    importe numeric(12,2) not null check (importe > 0),   -- importe absoluto que este movimiento cubre de este gasto
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid(),
    unique (movimiento_id, gasto_id)
);
create index if not exists movimiento_gastos_gasto_idx on public.movimiento_gastos (gasto_id);
create index if not exists movimiento_gastos_mov_idx on public.movimiento_gastos (movimiento_id);
alter table public.movimiento_gastos enable row level security;
create policy "empleados leen enlaces banco" on public.movimiento_gastos for select to authenticated using (public.usuario_activo());
create policy "empleados crean enlaces banco" on public.movimiento_gastos for insert to authenticated with check (public.usuario_activo());
create policy "empleados editan enlaces banco" on public.movimiento_gastos for update to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy "empleados quitan enlaces banco" on public.movimiento_gastos for delete to authenticated using (public.usuario_activo());
-- mismas reglas por centro que los movimientos
create policy centro on public.movimiento_gastos as restrictive for all to authenticated
    using ((select public.mi_centro()) is null or public.centro_ok((select m.centro_id from public.movimientos_banco m where m.id = movimiento_id)))
    with check ((select public.mi_centro()) is null or public.centro_ok((select m.centro_id from public.movimientos_banco m where m.id = movimiento_id)));
create or replace trigger zz_auditar after insert or update or delete on public.movimiento_gastos for each row execute function public.auditar();

-- enlaces que ya existían (1 movimiento -> 1 gasto): el movimiento cubre su importe completo
insert into public.movimiento_gastos (movimiento_id, gasto_id, importe)
select m.id, m.gasto_id, abs(m.importe)
from public.movimientos_banco m
where m.gasto_id is not null and m.estado = 'conciliado' and m.importe <> 0
on conflict (movimiento_id, gasto_id) do nothing;
