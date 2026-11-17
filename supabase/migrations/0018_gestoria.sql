-- 0018: Control > Gestoría. Extractos bancarios (PDF y N43) con el periodo que cubren,
-- envíos mensuales a la gestoría (estado, fecha, notas) y notas por mes.
create table if not exists public.extractos (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.cuentas_bancarias(id),
  fecha_desde date not null,
  fecha_hasta date not null,
  archivo_pdf text,          -- ruta en el bucket "gestoria"
  nombre_pdf text,
  archivo_n43 text,
  nombre_n43 text,
  saldo_inicial numeric(12,2),
  saldo_final numeric(12,2),
  movimientos int,
  notas text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint extractos_fechas check (fecha_hasta >= fecha_desde)
);
create index if not exists extractos_cuenta_fechas on public.extractos (cuenta_id, fecha_desde, fecha_hasta);

create table if not exists public.gestoria_envios (
  id uuid primary key default gen_random_uuid(),
  periodo text not null unique,               -- 'YYYY-MM'
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado')),
  fecha_envio date,
  incompleto boolean not null default false,  -- se envió confirmando que faltaban cosas
  faltaba text,                               -- qué faltaba al enviarlo
  notas text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table if not exists public.gestoria_notas (
  id uuid primary key default gen_random_uuid(),
  periodo text not null,                      -- 'YYYY-MM'
  texto text not null,
  hecho boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists gestoria_notas_periodo on public.gestoria_notas (periodo);

do $$
declare t text;
begin
  foreach t in array array['extractos', 'gestoria_envios', 'gestoria_notas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "leer %1$s" on public.%1$I for select to authenticated using (public.usuario_activo())', t);
    execute format('create policy "alta %1$s" on public.%1$I for insert to authenticated with check (public.puede_editar())', t);
    execute format('create policy "editar %1$s" on public.%1$I for update to authenticated using (public.puede_editar())', t);
    execute format('create trigger %1$s_audit before update on public.%1$I for each row execute function public.set_updated_audit()', t);
  end loop;
end $$;

-- (Sin permiso de borrado desde la app: las notas se marcan como hechas y los extractos se sustituyen.)
-- Archivos de extractos en un bucket privado propio
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gestoria', 'gestoria', false, 20971520, null)
on conflict (id) do nothing;
create policy "leer gestoria" on storage.objects for select to authenticated using (bucket_id = 'gestoria' and public.usuario_activo());
create policy "subir gestoria" on storage.objects for insert to authenticated with check (bucket_id = 'gestoria' and public.puede_editar());
create policy "actualizar gestoria" on storage.objects for update to authenticated using (bucket_id = 'gestoria' and public.puede_editar());
