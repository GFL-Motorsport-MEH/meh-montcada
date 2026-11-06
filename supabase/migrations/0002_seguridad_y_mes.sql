-- =====================================================================
-- 0002: seguridad de acceso + columna "mes" en gastos
--
-- 1) Un usuario recien registrado NO ve nada hasta que un admin lo active
--    (profiles.activo). Antes cualquier usuario autenticado podia leer y
--    escribir todos los datos.
-- 2) Las politicas de profiles consultaban la propia tabla profiles
--    (recursion infinita en RLS). Ahora usan funciones security definer.
-- 3) Borrar gastos/ingresos/facturacion: solo admin.
-- 4) gastos.mes: el mes al que se imputa el gasto, igual que la columna
--    "Mes" del Excel (no siempre coincide con la fecha: p.ej. "Royalties
--    Junio" facturado el 1 de julio cuenta en junio). Los graficos del
--    Excel suman por esta columna.
-- 5) Auditoria basica: created_by / updated_by / updated_at automaticos.
--
-- Solo usa ALTER POLICY / CREATE (nada de DROP).
-- =====================================================================

-- ---------- profiles ----------
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists activo boolean not null default false;

update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.profiles (id, nombre, rol, email, activo)
    values (new.id,
            coalesce(nullif(new.raw_user_meta_data->>'nombre', ''), split_part(new.email, '@', 1)),
            'empleado', new.email, false);
    return new;
end;
$$;

create or replace function public.usuario_activo()
returns boolean
language sql stable
security definer set search_path = public
as $$
    select exists (select 1 from public.profiles where id = auth.uid() and activo);
$$;

create or replace function public.es_admin()
returns boolean
language sql stable
security definer set search_path = public
as $$
    select exists (select 1 from public.profiles where id = auth.uid() and activo and rol = 'admin');
$$;

revoke execute on function public.usuario_activo() from public, anon;
revoke execute on function public.es_admin() from public, anon;
grant execute on function public.usuario_activo() to authenticated;
grant execute on function public.es_admin() to authenticated;

alter policy "usuarios ven su propio perfil" on public.profiles
    to authenticated using (id = auth.uid() or public.es_admin());
alter policy "admin gestiona perfiles" on public.profiles
    to authenticated using (public.es_admin()) with check (public.es_admin());

-- ---------- tablas maestras: leer usuarios activos, escribir admin ----------
alter policy "lectura autenticada: cursos" on public.cursos to authenticated using (public.usuario_activo());
alter policy "lectura autenticada: categorias" on public.categorias to authenticated using (public.usuario_activo());
alter policy "lectura autenticada: subcategorias" on public.subcategorias to authenticated using (public.usuario_activo());

create policy "admin gestiona cursos" on public.cursos for all to authenticated
    using (public.es_admin()) with check (public.es_admin());
create policy "admin gestiona categorias" on public.categorias for all to authenticated
    using (public.es_admin()) with check (public.es_admin());
create policy "admin gestiona subcategorias" on public.subcategorias for all to authenticated
    using (public.es_admin()) with check (public.es_admin());

-- ---------- gastos ----------
alter policy "empleados leen gastos" on public.gastos to authenticated using (public.usuario_activo());
alter policy "empleados escriben gastos" on public.gastos to authenticated with check (public.usuario_activo());
alter policy "empleados editan gastos" on public.gastos to authenticated
    using (public.usuario_activo()) with check (public.usuario_activo());
alter policy "empleados borran gastos" on public.gastos to authenticated using (public.es_admin());

-- ---------- ingresos ----------
alter policy "empleados leen ingresos" on public.ingresos to authenticated using (public.usuario_activo());
alter policy "empleados escriben ingresos" on public.ingresos to authenticated with check (public.usuario_activo());
alter policy "empleados editan ingresos" on public.ingresos to authenticated
    using (public.usuario_activo()) with check (public.usuario_activo());
create policy "admin borra ingresos" on public.ingresos for delete to authenticated using (public.es_admin());

-- ---------- facturacion ----------
alter policy "empleados leen facturacion" on public.facturacion to authenticated using (public.usuario_activo());
alter policy "empleados escriben facturacion" on public.facturacion to authenticated with check (public.usuario_activo());
alter policy "empleados editan facturacion" on public.facturacion to authenticated
    using (public.usuario_activo()) with check (public.usuario_activo());
create policy "admin borra facturacion" on public.facturacion for delete to authenticated using (public.es_admin());

-- ---------- gastos.mes + auditoria ----------
alter table public.gastos add column if not exists mes text
    check (mes in ('enero','febrero','marzo','abril','mayo','junio','julio','agosto',
                   'septiembre','octubre','noviembre','diciembre'));
alter table public.gastos add column if not exists updated_by uuid references public.profiles(id);
alter table public.gastos alter column created_by set default auth.uid();

-- regla general (coincide con el Excel en 1967 de 2016 filas); las
-- excepciones se corrigen en una actualizacion de datos aparte
update public.gastos
set mes = (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
                 'septiembre','octubre','noviembre','diciembre'])
          [extract(month from coalesce(fecha_pago, fecha_factura))::int]
where mes is null;

create or replace function public.set_updated_audit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.updated_at := now();
    new.updated_by := auth.uid();
    return new;
end;
$$;

create trigger gastos_set_updated
    before update on public.gastos
    for each row execute procedure public.set_updated_audit();

create index if not exists gastos_curso_idx on public.gastos(curso_id);
create index if not exists ingresos_curso_idx on public.ingresos(curso_id);
