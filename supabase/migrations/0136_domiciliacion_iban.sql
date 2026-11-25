-- 0136: el IBAN de cargo va en la domiciliación (no en el responsable): un mismo responsable puede tener IBAN distintos
-- según el alumno y dos responsables pueden compartir IBAN. Si la domiciliación no tiene IBAN propio se usa el del responsable.
-- Mismo nivel de acceso que ac_responsables_priv (solo quien ve Pagos).
create table if not exists public.ac_domiciliaciones_priv (
    domiciliacion_id uuid primary key references public.ac_domiciliaciones(id) on delete cascade,
    iban text,
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create trigger ac_domiciliaciones_priv_set_updated before update on public.ac_domiciliaciones_priv for each row execute procedure public.set_updated_audit();
alter table public.ac_domiciliaciones_priv enable row level security;
create policy leer on public.ac_domiciliaciones_priv for select to authenticated using (public.perm_ve('ac_pagos'));
create policy insertar on public.ac_domiciliaciones_priv for insert to authenticated with check (public.perm_edita_todo('ac_pagos'));
create policy modificar on public.ac_domiciliaciones_priv for update to authenticated using (public.perm_edita_todo('ac_pagos')) with check (public.perm_edita_todo('ac_pagos'));
create policy borrar on public.ac_domiciliaciones_priv for delete to authenticated using (public.es_admin());
create policy centro on public.ac_domiciliaciones_priv as restrictive for all to authenticated
    using ((select public.mi_centro()) is null or exists (select 1 from public.ac_domiciliaciones d where d.id = domiciliacion_id and public.alumno_centro_ok(d.alumno_id)))
    with check ((select public.mi_centro()) is null or exists (select 1 from public.ac_domiciliaciones d where d.id = domiciliacion_id and public.alumno_centro_ok(d.alumno_id)));
