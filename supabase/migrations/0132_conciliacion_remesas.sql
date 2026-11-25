-- 0132: conciliar los ingresos de remesas con el banco, solo por totales.
-- Cada fila = "este movimiento (ingreso) del banco corresponde a las remesas de ese mes y banco, por este importe".
-- Se enlaza por curso + mes + banco (no por el id del envío), así sobrevive a volver a pulsar «REMESAS ENVIADAS».
-- remesa_nombre es opcional: BBVA ingresa cada remesa por separado; Sabadell no (se compara el total del mes).
create table if not exists public.movimiento_remesas (
    id uuid primary key default gen_random_uuid(),
    movimiento_id uuid not null references public.movimientos_banco(id) on delete cascade,
    curso_id uuid not null references public.cursos(id),
    mes text not null check (mes in ('septiembre','octubre','noviembre','diciembre','enero','febrero','marzo','abril','mayo','junio','julio','agosto')),
    banco text not null check (banco in ('SABADELL', 'BBVA')),
    remesa_nombre text,
    importe numeric(12,2) not null check (importe > 0),
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid()
);
create unique index if not exists movimiento_remesas_uq on public.movimiento_remesas (movimiento_id, curso_id, mes, banco, coalesce(remesa_nombre, ''));
create index if not exists movimiento_remesas_grupo_idx on public.movimiento_remesas (curso_id, mes, banco);
alter table public.movimiento_remesas enable row level security;
create policy "empleados leen remesas banco" on public.movimiento_remesas for select to authenticated using (public.usuario_activo());
create policy "empleados crean remesas banco" on public.movimiento_remesas for insert to authenticated with check (public.usuario_activo());
create policy "empleados editan remesas banco" on public.movimiento_remesas for update to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy "empleados quitan remesas banco" on public.movimiento_remesas for delete to authenticated using (public.usuario_activo());
create policy centro on public.movimiento_remesas as restrictive for all to authenticated
    using ((select public.mi_centro()) is null or public.centro_ok((select m.centro_id from public.movimientos_banco m where m.id = movimiento_id)))
    with check ((select public.mi_centro()) is null or public.centro_ok((select m.centro_id from public.movimientos_banco m where m.id = movimiento_id)));
create or replace trigger zz_auditar after insert or update or delete on public.movimiento_remesas for each row execute function public.auditar();
