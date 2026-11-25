-- Recibos devueltos / impagados de una remesa: restan de lo esperado al conciliar con el banco (curso + mes + banco).
create table if not exists public.remesa_devoluciones (
    id uuid primary key default gen_random_uuid(),
    curso_id uuid not null references public.cursos(id),
    mes text not null check (mes in ('septiembre','octubre','noviembre','diciembre','enero','febrero','marzo','abril','mayo','junio','julio','agosto')),
    banco text not null check (banco in ('SABADELL', 'BBVA')),
    remesa_nombre text,
    alumno_id uuid references public.ac_alumnos(id) on delete set null,
    alumno_num numeric,
    concepto text,
    importe numeric(12,2) not null check (importe > 0),
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid()
);
create index if not exists remesa_devoluciones_grupo_idx on public.remesa_devoluciones (curso_id, mes, banco);
alter table public.remesa_devoluciones enable row level security;
create policy "empleados leen devoluciones" on public.remesa_devoluciones for select to authenticated using (public.usuario_activo());
create policy "empleados crean devoluciones" on public.remesa_devoluciones for insert to authenticated with check (public.usuario_activo());
create policy "empleados editan devoluciones" on public.remesa_devoluciones for update to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy "empleados quitan devoluciones" on public.remesa_devoluciones for delete to authenticated using (public.usuario_activo());
create or replace trigger zz_auditar after insert or update or delete on public.remesa_devoluciones for each row execute function public.auditar();
