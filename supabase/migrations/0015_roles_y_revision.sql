-- =====================================================================
-- 0015: roles de usuario y revisión de gastos
--
-- Roles (profiles.rol):
--   admin    -> todo, incluida la gestión de usuarios y borrar
--   empleado -> ver y editar todo (sin borrar ni gestionar usuarios)  [en la app: "Gestión"]
--   consulta -> solo ver
--   escaner  -> solo el escáner: añade gastos (quedan pendientes de revisar) y ve los suyos pendientes
--
-- Los permisos se aplican en la base de datos (RLS), no solo en la app.
-- Solo ALTER/CREATE (nada de DROP).
-- =====================================================================

-- ---------- perfiles ----------
alter table public.profiles drop constraint if exists profiles_rol_check;
alter table public.profiles add constraint profiles_rol_check check (rol in ('admin', 'empleado', 'consulta', 'escaner'));
alter table public.profiles add column if not exists debe_cambiar_password boolean not null default false;

-- ---------- funciones de permisos ----------
-- usuario_activo(): ve todos los datos (admin, empleado, consulta). El escáner NO.
create or replace function public.usuario_activo()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.profiles where id = auth.uid() and activo and rol in ('admin', 'empleado', 'consulta'));
$$;
-- usuario_habilitado(): cualquier usuario activo (también el escáner). Para listas maestras.
create or replace function public.usuario_habilitado()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.profiles where id = auth.uid() and activo);
$$;
-- puede_editar(): admin o empleado.
create or replace function public.puede_editar()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.profiles where id = auth.uid() and activo and rol in ('admin', 'empleado'));
$$;
create or replace function public.es_escaner()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.profiles where id = auth.uid() and activo and rol = 'escaner');
$$;
revoke execute on function public.usuario_habilitado(), public.puede_editar(), public.es_escaner() from public, anon;
grant execute on function public.usuario_habilitado(), public.puede_editar(), public.es_escaner() to authenticated;

-- ---------- escritura: de usuario_activo() a puede_editar() (la consulta solo lee) ----------
do $$
declare p record;
begin
  for p in select tablename, policyname, cmd from pg_policies
           where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE')
             and (coalesce(qual, '') like '%usuario_activo()%' or coalesce(with_check, '') like '%usuario_activo()%')
  loop
    if p.cmd = 'INSERT' then
      execute format('alter policy %I on public.%I with check (public.puede_editar())', p.policyname, p.tablename);
    elsif p.cmd = 'UPDATE' then
      execute format('alter policy %I on public.%I using (public.puede_editar()) with check (public.puede_editar())', p.policyname, p.tablename);
    else
      execute format('alter policy %I on public.%I using (public.puede_editar())', p.policyname, p.tablename);
    end if;
  end loop;
end $$;

-- listas maestras que necesita el escáner para rellenar el gasto
alter policy "lectura autenticada: cursos" on public.cursos using (public.usuario_habilitado());
alter policy "lectura autenticada: categorias" on public.categorias using (public.usuario_habilitado());
alter policy "lectura autenticada: subcategorias" on public.subcategorias using (public.usuario_habilitado());
alter policy "empleados leen centros" on public.centros using (public.usuario_habilitado());
alter policy "empleados leen listas" on public.listas using (public.usuario_habilitado());

-- ---------- revisión de gastos ----------
alter table public.gastos add column if not exists revisado boolean not null default true;
alter table public.gastos add column if not exists revisado_por uuid references public.profiles(id);
alter table public.gastos add column if not exists revisado_at timestamptz;
create index if not exists gastos_pendientes_revision on public.gastos (curso_id) where not revisado;

-- quien no puede editar (escáner) solo crea gastos pendientes de revisar y sin marcas de control
create or replace function public.gastos_control_alta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- (auth.uid() nulo = cargas desde el panel/SQL: no se toca nada)
    if auth.uid() is not null and not public.puede_editar() then
      new.revisado := false; new.revisado_por := null; new.revisado_at := null;
      new.check_banca := false; new.fiscontal := 'False'; new.fiscontal_fecha := null;
      new.created_by := auth.uid(); new.division_id := null;
    end if;
  elsif new.revisado and not old.revisado then
    new.revisado_por := auth.uid(); new.revisado_at := now();
  elsif not new.revisado and old.revisado then
    new.revisado_por := null; new.revisado_at := null;
  end if;
  return new;
end $$;
create or replace trigger gastos_control_alta before insert or update on public.gastos for each row execute function public.gastos_control_alta();

-- el escáner inserta sus gastos y ve los suyos mientras están pendientes
create policy "escaner añade gastos" on public.gastos for insert to authenticated
  with check (public.es_escaner() and created_by = auth.uid() and not revisado);
create policy "escaner ve sus gastos pendientes" on public.gastos for select to authenticated
  using (public.es_escaner() and created_by = auth.uid() and not revisado);

-- facturas en Storage: el escáner sube y ve lo que sube él
create policy "escaner sube facturas" on storage.objects for insert to authenticated
  with check (bucket_id = 'facturas' and public.es_escaner());
create policy "escaner ve sus facturas" on storage.objects for select to authenticated
  using (bucket_id = 'facturas' and public.es_escaner() and owner = auth.uid());

-- ---------- ayudas del escáner (sin dar acceso a los gastos) ----------
-- proveedores conocidos (nombre + NIF) para reconocer la factura
create or replace function public.escaner_proveedores()
returns table (nombre text, nif text) language sql stable security definer set search_path = public as $$
  select distinct on (lower(trim(empresa))) trim(empresa), nullif(trim(nif), '')
  from public.gastos where public.usuario_habilitado() and empresa is not null and trim(empresa) <> ''
  order by lower(trim(empresa)), (nif is null), fecha_factura desc nulls last
$$;
-- clasificación del último gasto de ese proveedor
create or replace function public.escaner_sugerencia(p_empresa text, p_nif text default null)
returns table (empresa text, nif text, iban text, swift text, tipo text, concepto text, categoria_id uuid, subcategoria_id uuid,
               periodicidad text, metodo_pago text, centro_id uuid, fecha_factura date)
language sql stable security definer set search_path = public as $$
  select g.empresa, g.nif, g.iban, g.swift, g.tipo, g.concepto, g.categoria_id, g.subcategoria_id, g.periodicidad, g.metodo_pago, g.centro_id, g.fecha_factura
  from public.gastos g
  where public.usuario_habilitado()
    and (lower(trim(g.empresa)) = lower(trim(p_empresa)) or (p_nif is not null and g.nif = p_nif))
  order by g.revisado desc, g.fecha_factura desc nulls last limit 1
$$;
-- ¿ya existe esta factura?
create or replace function public.escaner_duplicado(p_empresa text, p_numero text, p_fecha date, p_importe numeric)
returns table (fecha_factura date, factura_nr text, cantidad numeric) language sql stable security definer set search_path = public as $$
  select g.fecha_factura, g.factura_nr, g.cantidad from public.gastos g
  where public.usuario_habilitado() and lower(trim(g.empresa)) = lower(trim(p_empresa))
    and ((p_numero is not null and lower(g.factura_nr) = lower(p_numero))
         or (p_fecha is not null and p_importe is not null and g.fecha_factura = p_fecha and abs(g.cantidad - p_importe) < 0.01))
  limit 1
$$;
revoke execute on function public.escaner_proveedores(), public.escaner_sugerencia(text, text), public.escaner_duplicado(text, text, date, numeric) from public, anon;
grant execute on function public.escaner_proveedores(), public.escaner_sugerencia(text, text), public.escaner_duplicado(text, text, date, numeric) to authenticated;

-- (aplicado también) Storage: subir/actualizar facturas solo quien puede editar
alter policy "empleados suben facturas" on storage.objects with check (bucket_id = 'facturas' and public.puede_editar());
alter policy "empleados actualizan facturas" on storage.objects using (bucket_id = 'facturas' and public.puede_editar());
