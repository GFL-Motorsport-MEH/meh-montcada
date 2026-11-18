-- Recogidas: documentos obligatorios de los padres (autorización + copia del DNI) y pagos de 10 € en efectivo.

-- 1) Rutas de los archivos en el bucket privado "recogidas-docs" (solo ven los archivos quienes pueden editar)
alter table public.ac_recogidas add column if not exists doc_autorizacion text;
alter table public.ac_recogidas add column if not exists doc_dni_padres text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recogidas-docs', 'recogidas-docs', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "leer recogidas-docs" on storage.objects for select to authenticated using (bucket_id = 'recogidas-docs' and public.puede_editar());
create policy "subir recogidas-docs" on storage.objects for insert to authenticated with check (bucket_id = 'recogidas-docs' and public.puede_editar());
create policy "actualizar recogidas-docs" on storage.objects for update to authenticated using (bucket_id = 'recogidas-docs' and public.puede_editar());
create policy "borrar recogidas-docs" on storage.objects for delete to authenticated using (bucket_id = 'recogidas-docs' and public.puede_editar());

-- 2) Pagos de recogidas (cada uno, 10 € en efectivo por defecto). traspasado_at != null => ya llevado a Ingresos.
create table if not exists public.ac_recogidas_pagos (
    id uuid primary key default gen_random_uuid(),
    recogida_id uuid not null references public.ac_recogidas(id) on delete cascade,
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    curso_id uuid not null references public.cursos(id),
    fecha date not null default current_date,
    importe numeric(8, 2) not null default 10 check (importe >= 0),
    metodo text not null default 'efectivo',
    notas text,
    traspasado_at timestamptz,
    traspasado_por uuid references public.profiles(id),
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists ac_recogidas_pagos_curso_idx on public.ac_recogidas_pagos (curso_id, fecha);
create index if not exists ac_recogidas_pagos_recogida_idx on public.ac_recogidas_pagos (recogida_id);

create trigger ac_recogidas_pagos_set_updated before update on public.ac_recogidas_pagos for each row execute procedure public.set_updated_audit();
alter table public.ac_recogidas_pagos enable row level security;
create policy leer on public.ac_recogidas_pagos for select to authenticated using (public.usuario_activo());
create policy insertar on public.ac_recogidas_pagos for insert to authenticated with check (public.puede_editar());
create policy modificar on public.ac_recogidas_pagos for update to authenticated using (public.puede_editar()) with check (public.puede_editar());
create policy borrar on public.ac_recogidas_pagos for delete to authenticated using (public.puede_editar() and traspasado_at is null);
