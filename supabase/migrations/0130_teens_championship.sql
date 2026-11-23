-- 0130: TEENS Championship dentro del módulo ALUMNOS (sustituye a la web de Apps Script + Google Sheet).
-- Clasificación por niveles (A2 / B1 / B2) de los test de unidad (T1–T10) y los dos exámenes (mitad y final de curso).
-- Las notas se guardan en bruto y se normalizan a base 10 al calcular (nota / total de la prueba × 10), con pesos configurables.
-- Permiso nuevo: al_teens (tipo «todo»). Solo CREATE / INSERT (sin borrados).

create table if not exists public.al_teens_grupos (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    nivel text not null check (nivel in ('A2', 'B1', 'B2')),
    centro_id uuid references public.centros(id),
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create table if not exists public.al_teens_alumnos (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    grupo_id uuid not null references public.al_teens_grupos(id) on delete restrict,   -- el nivel es el del grupo
    activo boolean not null default true,                                              -- inactivo: no sale en la clasificación pero conserva sus notas
    centro_id uuid references public.centros(id),
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists al_teens_alumnos_grupo_idx on public.al_teens_alumnos (grupo_id);
create table if not exists public.al_teens_notas (
    id uuid primary key default gen_random_uuid(),
    teen_id uuid not null references public.al_teens_alumnos(id) on delete cascade,
    prueba text not null check (prueba ~ '^(u([1-9]|10)|mid|final)$'),                 -- u1..u10 = test de unidad, mid / final = exámenes
    valor numeric(7, 2) not null check (valor >= 0),                                   -- nota en bruto, tal cual la corrige la profesora
    centro_id uuid references public.centros(id),
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    unique (teen_id, prueba)
);
create table if not exists public.al_teens_config (
    id uuid primary key default gen_random_uuid(),
    clave text not null,                                                               -- peso_unidad, peso_mid, peso_final, total_u1..total_u10, total_mid, total_final
    valor numeric(7, 2) not null check (valor > 0),
    centro_id uuid references public.centros(id),
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);

do $$
declare t text;
begin
    foreach t in array array['al_teens_grupos', 'al_teens_alumnos', 'al_teens_notas', 'al_teens_config'] loop
        execute format('create trigger %I before update on public.%I for each row execute procedure public.set_updated_audit()', t || '_set_updated', t);
        execute format('alter table public.%I enable row level security', t);
        execute format('grant all on public.%I to authenticated', t);
        execute format('create policy leer on public.%I for select to authenticated using (public.perm_ve(''al_teens''))', t);
        execute format('create policy escribir on public.%I for all to authenticated using (public.perm_edita_todo(''al_teens'')) with check (public.perm_edita_todo(''al_teens''))', t);
        execute format('create policy centro on public.%I as restrictive for all to authenticated using ((select public.mi_centro()) is null or public.centro_ok(centro_id)) with check ((select public.mi_centro()) is null or public.centro_ok(centro_id))', t);
    end loop;
end $$;

-- permisos recomendados (se cambian en Usuarios > Permisos de los roles): las profesoras introducen las notas
insert into public.rol_permisos (rol, permiso, alcance, editar) values
    ('direccion', 'al_teens', 'todo', true), ('coordinacion', 'al_teens', 'todo', true), ('profesora', 'al_teens', 'todo', true)
on conflict (rol, permiso) do nothing;
