-- 0121: Remesas — archivados y «Cambios/Comentarios» con fecha.
-- · ac_domiciliaciones: archivado (alumnos que pasan a otro método de pago que no es domiciliación), con fecha y remesa que tenían.
-- · ac_domiciliacion_notas: cambios/comentarios por alumno, numerados por orden de creación, con fecha de creación y de última edición.
--   Los comentarios que ya había en ac_domiciliaciones.comentario se copian como primera nota (la columna no se borra).

alter table public.ac_domiciliaciones add column if not exists archivado boolean not null default false;
alter table public.ac_domiciliaciones add column if not exists archivado_el timestamptz;
alter table public.ac_domiciliaciones add column if not exists archivado_remesa text;
create index if not exists ac_domiciliaciones_archivado_idx on public.ac_domiciliaciones (archivado);

create table if not exists public.ac_domiciliacion_notas (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    texto text not null,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    editado_el timestamptz,
    editado_por uuid references public.profiles(id)
);
create index if not exists ac_domiciliacion_notas_alumno_idx on public.ac_domiciliacion_notas (alumno_id, created_at);

insert into public.ac_domiciliacion_notas (alumno_id, texto, created_at)
select distinct on (d.alumno_id, d.comentario) d.alumno_id, d.comentario, d.created_at
from public.ac_domiciliaciones d
where coalesce(btrim(d.comentario), '') <> ''
  and not exists (select 1 from public.ac_domiciliacion_notas n where n.alumno_id = d.alumno_id and n.texto = d.comentario)
order by d.alumno_id, d.comentario, d.created_at;

alter table public.ac_domiciliacion_notas enable row level security;
do $$
begin
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ac_domiciliacion_notas' and policyname = 'leer') then
        create policy leer on public.ac_domiciliacion_notas for select to authenticated using (public.perm_ve_alguno('ac_pagos', 'ac_remesas'));
        create policy insertar on public.ac_domiciliacion_notas for insert to authenticated with check (public.perm_edita_todo('ac_pagos') or public.perm_edita_todo('ac_remesas'));
        create policy modificar on public.ac_domiciliacion_notas for update to authenticated using (public.perm_edita_todo('ac_pagos') or public.perm_edita_todo('ac_remesas')) with check (public.perm_edita_todo('ac_pagos') or public.perm_edita_todo('ac_remesas'));
        create policy borrar on public.ac_domiciliacion_notas for delete to authenticated using (public.perm_edita_todo('ac_pagos') or public.perm_edita_todo('ac_remesas'));
    end if;
end $$;
