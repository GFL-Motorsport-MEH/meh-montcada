-- Calendario anual de la academia: un registro por día marcado del curso (festivo, vacaciones, sin clase o evento).
-- Los días que no aparecen son días normales. Lectura: quien ve Grupos o Horarios/Calendario; escritura: quien edita Horarios/Calendario.
create table if not exists public.ac_calendario_dias (
    id uuid primary key default gen_random_uuid(),
    curso_id uuid not null references public.cursos(id),
    fecha date not null,
    tipo text not null check (tipo in ('festivo', 'vacaciones', 'sin_clase', 'evento')),
    nombre text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    unique (curso_id, fecha)
);
create index if not exists ac_calendario_dias_curso_idx on public.ac_calendario_dias (curso_id, fecha);

create trigger ac_calendario_dias_set_updated before update on public.ac_calendario_dias for each row execute procedure public.set_updated_audit();
alter table public.ac_calendario_dias enable row level security;
create policy leer on public.ac_calendario_dias for select to authenticated using (public.perm_alguno('ac_grupos', 'ac_calendario'));
create policy insertar on public.ac_calendario_dias for insert to authenticated with check (public.perm_edita_todo('ac_calendario'));
create policy modificar on public.ac_calendario_dias for update to authenticated using (public.perm_edita_todo('ac_calendario')) with check (public.perm_edita_todo('ac_calendario'));
create policy borrar on public.ac_calendario_dias for delete to authenticated using (public.perm_edita_todo('ac_calendario'));
