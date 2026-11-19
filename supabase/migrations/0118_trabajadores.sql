-- 0118: módulo TRABAJADORES (portal del trabajador): contratos, horario de contrato y bolsa de horas.
-- Los documentos (nóminas, contratos firmados, certificados…) siguen en ac_portal_docs + bucket «trabajadores» (permiso ac_portal).
-- Permisos nuevos (tipo «propio»: «lo suyo» = lo del propio usuario; «todo» = el de todos):
--   tr_contrato -> contratos y horario de contrato        tr_horas -> bolsa de horas
-- Solo CREATE / INSERT / CREATE OR REPLACE (sin borrados).

-- ---------- contratos ----------
create table if not exists public.tr_contratos (
    id uuid primary key default gen_random_uuid(),
    profile_id uuid not null references public.profiles(id),
    tipo text not null default 'indefinido' check (tipo in ('indefinido', 'temporal', 'fijo_discontinuo', 'practicas', 'obra', 'autonomo', 'otro')),
    categoria text,                       -- puesto: profesora, coordinación, administración…
    jornada text not null default 'parcial' check (jornada in ('completa', 'parcial')),
    horas_semana numeric(5, 1),           -- horas semanales contratadas
    fecha_inicio date not null,
    fecha_fin date,                       -- vacío = sin fecha de fin
    notas text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists tr_contratos_profile_idx on public.tr_contratos (profile_id, fecha_inicio);

-- ---------- horario de contrato (franjas semanales) ----------
create table if not exists public.tr_horario (
    id uuid primary key default gen_random_uuid(),
    profile_id uuid not null references public.profiles(id),
    contrato_id uuid references public.tr_contratos(id) on delete set null,
    dia smallint not null check (dia between 1 and 7),   -- 1 = lunes … 7 = domingo
    hora_inicio time not null,
    hora_fin time not null,
    concepto text,                        -- clases, coordinación, reunión…
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id),
    check (hora_fin > hora_inicio)
);
create index if not exists tr_horario_profile_idx on public.tr_horario (profile_id, dia, hora_inicio);

-- ---------- bolsa de horas (movimientos; el saldo es la suma) ----------
-- horas > 0: a favor del trabajador (horas de más) · horas < 0: horas devueltas, disfrutadas o descontadas
create table if not exists public.tr_horas (
    id uuid primary key default gen_random_uuid(),
    profile_id uuid not null references public.profiles(id),
    fecha date not null default current_date,
    tipo text not null default 'extra' check (tipo in ('saldo_inicial', 'extra', 'compensacion', 'ajuste')),
    horas numeric(6, 2) not null check (horas <> 0),
    concepto text,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create index if not exists tr_horas_profile_idx on public.tr_horas (profile_id, fecha);

do $$
declare t text;
begin
    foreach t in array array['tr_contratos', 'tr_horario', 'tr_horas'] loop
        execute format('create trigger %I before update on public.%I for each row execute procedure public.set_updated_audit()', t || '_set_updated', t);
        execute format('alter table public.%I enable row level security', t);
        execute format('grant all on public.%I to authenticated', t);
    end loop;
end $$;

-- cada uno ve lo suyo si su rol tiene el permiso; quien tiene alcance «todo» ve y (si puede editar) cambia lo de todos
create policy leer on public.tr_contratos for select to authenticated using (public.perm_ve('tr_contrato') or (profile_id = auth.uid() and public.perm_alcance('tr_contrato') is not null));
create policy escribir on public.tr_contratos for all to authenticated using (public.perm_edita_todo('tr_contrato')) with check (public.perm_edita_todo('tr_contrato'));
create policy leer on public.tr_horario for select to authenticated using (public.perm_ve('tr_contrato') or (profile_id = auth.uid() and public.perm_alcance('tr_contrato') is not null));
create policy escribir on public.tr_horario for all to authenticated using (public.perm_edita_todo('tr_contrato')) with check (public.perm_edita_todo('tr_contrato'));
create policy leer on public.tr_horas for select to authenticated using (public.perm_ve('tr_horas') or (profile_id = auth.uid() and public.perm_alcance('tr_horas') is not null));
create policy escribir on public.tr_horas for all to authenticated using (public.perm_edita_todo('tr_horas')) with check (public.perm_edita_todo('tr_horas'));

-- quien tiene algún permiso de Trabajadores también puede leer la lista del equipo (nombres para elegir trabajador)
create or replace function public.ac_acceso()
returns boolean language sql stable security definer set search_path = public as $$
    select coalesce((select pr.rol = 'admin' or exists (select 1 from public.rol_permisos rp where rp.rol = pr.rol and (rp.permiso like 'ac\_%' or rp.permiso like 'tr\_%'))
                     from public.profiles pr where pr.id = auth.uid() and pr.activo), false);
$$;

-- ---------- permisos recomendados (se cambian en Usuarios > Permisos de los roles) ----------
insert into public.rol_permisos (rol, permiso, alcance, editar) values
    ('direccion', 'tr_contrato', 'todo', true), ('coordinacion', 'tr_contrato', 'propio', false), ('profesora', 'tr_contrato', 'propio', false),
    ('direccion', 'tr_horas', 'todo', true), ('coordinacion', 'tr_horas', 'propio', false), ('profesora', 'tr_horas', 'propio', false)
on conflict (rol, permiso) do nothing;
