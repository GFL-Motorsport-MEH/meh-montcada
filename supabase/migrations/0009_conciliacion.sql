-- Conciliacion bancaria con varias cuentas (Mod_Conciliacion_Bancaria del Excel, ampliado).
-- cuentas_bancarias: cada cuenta del banco; "referencia" es un texto que aparece en sus extractos (IBAN, nº de cuenta...)
-- y sirve para reconocer a que cuenta pertenece un archivo al importarlo.
create table if not exists public.cuentas_bancarias (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    banco text,
    iban text,
    referencia text,
    centro_id uuid references public.centros(id),
    activo boolean not null default true,
    orden integer not null default 0,
    created_at timestamptz not null default now()
);
alter table public.cuentas_bancarias enable row level security;
create policy "empleados leen cuentas" on public.cuentas_bancarias for select to authenticated using (public.usuario_activo());
create policy "admin gestiona cuentas" on public.cuentas_bancarias for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- movimientos_banco: lineas de los extractos importados. importe con signo (negativo = pago, positivo = cobro).
-- clave evita duplicados al reimportar periodos que se solapan (fecha|importe|concepto|n de repeticion).
create table if not exists public.movimientos_banco (
    id uuid primary key default gen_random_uuid(),
    cuenta_id uuid not null references public.cuentas_bancarias(id),
    fecha date not null,
    fecha_valor date,
    concepto text,
    importe numeric(12,2) not null,
    saldo numeric(12,2),
    clave text not null,
    estado text not null default 'pendiente' check (estado in ('pendiente', 'conciliado', 'ignorado')),
    gasto_id uuid references public.gastos(id) on delete set null,
    centro_id uuid references public.centros(id),
    notas text,
    archivo text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create unique index if not exists movimientos_clave_idx on public.movimientos_banco (cuenta_id, clave);
create index if not exists movimientos_fecha_idx on public.movimientos_banco (fecha);
create index if not exists movimientos_gasto_idx on public.movimientos_banco (gasto_id);
alter table public.movimientos_banco enable row level security;
create policy "empleados leen movimientos" on public.movimientos_banco for select to authenticated using (public.usuario_activo());
create policy "empleados importan movimientos" on public.movimientos_banco for insert to authenticated with check (public.usuario_activo());
create policy "empleados editan movimientos" on public.movimientos_banco for update to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy "admin borra movimientos" on public.movimientos_banco for delete to authenticated using (public.es_admin());
create trigger movimientos_set_updated before update on public.movimientos_banco for each row execute procedure public.set_updated_audit();
