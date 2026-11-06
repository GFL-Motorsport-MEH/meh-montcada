-- =====================================================================
-- Esquema inicial para la migracion de "Montcada - Accountancy Control"
-- (Excel) a una app web (Netlify + Supabase).
--
-- Decisiones de diseño:
-- - "cursos" es tabla propia (no un texto suelto) para poder añadir
--   cursos futuros sin tocar código, igual que ListasNuevas!AR en el
--   Excel.
-- - "categorias"/"subcategorias" replican exactamente la taxonomia de
--   ListasNuevas!$AT$1:$AT$74 (9 categorias, 65 subcategorias) ya
--   validada en el Excel -- ver extract/taxonomia.json.
-- - "gastos" tiene una fila por gasto real (igual que las hojas
--   2023.24/2024.25/2025.26), con categoria_id/subcategoria_id como
--   claves foraneas en vez de texto libre, para que la app obligue a
--   elegir una combinacion valida (equivalente al desplegable
--   dependiente del Excel).
-- - "ingresos" replica IngresosBase (formato largo: una fila por
--   Curso/Grupo/Mes/Tipo).
-- - "facturacion" replica Table1 de "Fact Meharic" (import del CRM).
-- - RLS: cualquier usuario autenticado (empleado) puede leer/escribir
--   los datos del dia a dia; solo "admin" puede gestionar perfiles de
--   usuario. Esto es deliberadamente simple para el primer prototipo;
--   se puede refinar por tabla mas adelante si Gustavo quiere permisos
--   mas finos (p.ej. un empleado que solo pueda ver Gastos, no Balance).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Perfiles de usuario (rol encima de auth.users de Supabase)
-- ---------------------------------------------------------------------
create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    nombre text not null,
    rol text not null default 'empleado' check (rol in ('admin', 'empleado')),
    created_at timestamptz not null default now()
);

-- crea automaticamente un profile "empleado" cuando se registra un usuario nuevo
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.profiles (id, nombre, rol)
    values (new.id, coalesce(new.raw_user_meta_data->>'nombre', new.email), 'empleado');
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------
-- Cursos academicos (equivalente a ListasNuevas!AR)
-- ---------------------------------------------------------------------
create table public.cursos (
    id uuid primary key default gen_random_uuid(),
    nombre text not null unique,          -- "2023.24", "2024.25", ...
    fecha_inicio date,
    fecha_fin date,
    activo boolean not null default true,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Categorias / Subcategorias de Gastos (taxonomia de ListasNuevas!AT)
-- ---------------------------------------------------------------------
create table public.categorias (
    id uuid primary key default gen_random_uuid(),
    nombre text not null unique,
    orden integer not null default 0
);

create table public.subcategorias (
    id uuid primary key default gen_random_uuid(),
    categoria_id uuid not null references public.categorias(id) on delete cascade,
    nombre text not null,
    orden integer not null default 0,
    unique (categoria_id, nombre)
);

-- ---------------------------------------------------------------------
-- Gastos (una fila = un gasto real, equivalente a las hojas de curso)
-- ---------------------------------------------------------------------
create table public.gastos (
    id uuid primary key default gen_random_uuid(),
    curso_id uuid not null references public.cursos(id),
    tipo text,
    empresa text,
    factura_nr text,
    fecha_factura date,
    pago text,
    concepto text,
    fecha_pago date,
    cantidad numeric(12,2) not null default 0,
    link_factura text,
    categoria_id uuid references public.categorias(id),
    subcategoria_id uuid references public.subcategorias(id),
    -- texto original del Excel, por si no hubo match exacto con la
    -- taxonomia (categoria_id/subcategoria_id quedarian NULL en ese caso
    -- y la fila debe revisarse a mano) -- nunca se pierde el dato crudo
    categoria_texto text,
    subcategoria_texto text,
    periodicidad text,
    metodo_pago text,
    comentarios text,
    nif text,
    iban text,
    swift text,
    check_banca boolean not null default false,
    fiscontal text,
    sin_factura boolean not null default false,
    created_by uuid references public.profiles(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index gastos_curso_idx on public.gastos(curso_id);
create index gastos_categoria_idx on public.gastos(categoria_id);
create index gastos_fecha_pago_idx on public.gastos(fecha_pago);

-- ---------------------------------------------------------------------
-- Ingresos (formato largo, equivalente a IngresosBase/Tabla5)
-- ---------------------------------------------------------------------
create table public.ingresos (
    id uuid primary key default gen_random_uuid(),
    curso_id uuid not null references public.cursos(id),
    trimestre text,
    mes text,
    grupo text,
    level text,
    tipo text,            -- p.ej. "Welcome pack" o vacio para ingreso normal
    cantidad numeric(12,2) not null default 0,
    created_at timestamptz not null default now()
);

create index ingresos_curso_idx on public.ingresos(curso_id);

-- ---------------------------------------------------------------------
-- Facturacion (import del CRM, equivalente a Table1 / "Fact Meharic")
-- ---------------------------------------------------------------------
create table public.facturacion (
    id uuid primary key default gen_random_uuid(),
    centro text,
    alumno text,
    id_crm text,
    fecha_pago date,
    tipo_operacion text,
    fecha_operacion date,
    num_factura text,
    num_recibo text,
    metodo_pago text,
    modalidad_pago text,
    descripcion text,
    qty numeric(12,2),
    cantidad numeric(12,2),
    iva numeric(12,2),
    importe numeric(12,2),
    total numeric(12,2),
    fecha_inicio date,
    fecha_fin date,
    mimag_comprobacion text,
    fiscontal_comprobacion text,
    created_at timestamptz not null default now(),
    -- clave de deduplicacion para la futura importacion automatica del CRM:
    -- ID + Num Recibo + Num Factura + Descripcion + Importe (ver nota en
    -- Mod_Facturacion_Import.bas v3 del Excel: con solo Recibo+Factura se
    -- perdian lineas de un mismo recibo con varias lineas)
    clave_linea text generated always as (
        coalesce(id_crm,'') || '|' || coalesce(num_recibo,'') || '|' ||
        coalesce(num_factura,'') || '|' || coalesce(descripcion,'') || '|' ||
        coalesce(importe::text,'')
    ) stored
);

create unique index facturacion_clave_linea_idx on public.facturacion(clave_linea);
create index facturacion_num_recibo_idx on public.facturacion(num_recibo);

-- ---------------------------------------------------------------------
-- RLS: cualquier usuario autenticado puede leer/escribir los datos del
-- dia a dia; solo admin gestiona perfiles.
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.cursos enable row level security;
alter table public.categorias enable row level security;
alter table public.subcategorias enable row level security;
alter table public.gastos enable row level security;
alter table public.ingresos enable row level security;
alter table public.facturacion enable row level security;

create policy "usuarios ven su propio perfil" on public.profiles
    for select using (auth.uid() = id or exists (
        select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'admin'
    ));
create policy "admin gestiona perfiles" on public.profiles
    for all using (exists (
        select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'admin'
    ));

create policy "lectura autenticada: cursos" on public.cursos for select using (auth.role() = 'authenticated');
create policy "lectura autenticada: categorias" on public.categorias for select using (auth.role() = 'authenticated');
create policy "lectura autenticada: subcategorias" on public.subcategorias for select using (auth.role() = 'authenticated');

create policy "empleados leen gastos" on public.gastos for select using (auth.role() = 'authenticated');
create policy "empleados escriben gastos" on public.gastos for insert with check (auth.role() = 'authenticated');
create policy "empleados editan gastos" on public.gastos for update using (auth.role() = 'authenticated');
create policy "empleados borran gastos" on public.gastos for delete using (auth.role() = 'authenticated');

create policy "empleados leen ingresos" on public.ingresos for select using (auth.role() = 'authenticated');
create policy "empleados escriben ingresos" on public.ingresos for insert with check (auth.role() = 'authenticated');
create policy "empleados editan ingresos" on public.ingresos for update using (auth.role() = 'authenticated');

create policy "empleados leen facturacion" on public.facturacion for select using (auth.role() = 'authenticated');
create policy "empleados escriben facturacion" on public.facturacion for insert with check (auth.role() = 'authenticated');
create policy "empleados editan facturacion" on public.facturacion for update using (auth.role() = 'authenticated');
