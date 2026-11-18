-- Vínculos familiares entre alumnos (hermanos, primos, otros familiares) para avisar de los descuentos.
-- Los hermanos «obvios» (mismo responsable o mismos apellidos) se detectan en pantalla; esta tabla guarda
-- los vínculos que se añaden a mano (p. ej. apellidos distintos). Solo CREATE (nada de DROP).
create table if not exists public.ac_vinculos (
    id uuid primary key default gen_random_uuid(),
    alumno_id uuid not null references public.ac_alumnos(id) on delete cascade,
    otro_id uuid not null references public.ac_alumnos(id) on delete cascade,
    tipo text not null default 'hermano' check (tipo in ('hermano', 'primo', 'familiar')),
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    check (alumno_id <> otro_id),
    unique (alumno_id, otro_id)
);
create index if not exists ac_vinculos_otro_idx on public.ac_vinculos (otro_id);
alter table public.ac_vinculos enable row level security;
create policy "leer" on public.ac_vinculos for select using (public.perm_ve_alguno('ac_alumnos', 'ac_pagos', 'ac_remesas'));
create policy "insertar" on public.ac_vinculos for insert with check (public.perm_edita_todo('ac_alumnos'));
create policy "modificar" on public.ac_vinculos for update using (public.perm_edita_todo('ac_alumnos')) with check (public.perm_edita_todo('ac_alumnos'));
create policy "borrar" on public.ac_vinculos for delete using (public.perm_edita_todo('ac_alumnos'));
grant select, insert, update, delete on public.ac_vinculos to authenticated;
create trigger ac_vinculos_set_updated before update on public.ac_vinculos for each row execute procedure public.set_updated_audit();
