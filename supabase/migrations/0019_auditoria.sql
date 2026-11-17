-- 0019: historial permanente de cambios (quién, cuándo, valor anterior y nuevo) para poder restaurar.
-- Lo rellena un trigger en las tablas de contabilidad; nadie puede escribirlo ni borrarlo desde la app.
create table if not exists public.auditoria (
  id bigserial primary key,
  at timestamptz not null default now(),
  usuario uuid default auth.uid(),
  tabla text not null,
  registro_id text,
  accion text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
  antes jsonb,
  despues jsonb,
  restaurado_de bigint
);
create index if not exists auditoria_tabla_reg on public.auditoria (tabla, registro_id, at desc);
create index if not exists auditoria_at on public.auditoria (at desc);

alter table public.auditoria enable row level security;
create policy "admin lee auditoria" on public.auditoria for select to authenticated using (public.es_admin());

create or replace function public.auditar()
returns trigger language plpgsql security definer set search_path = public as $$
declare a jsonb; d jsonb; k text;
begin
  if tg_op = 'INSERT' then d := to_jsonb(new);
  elsif tg_op = 'DELETE' then a := to_jsonb(old);
  else
    -- solo lo que cambia (sin contar las marcas de fecha/usuario de actualización)
    a := to_jsonb(old) - 'updated_at' - 'updated_by'; d := to_jsonb(new) - 'updated_at' - 'updated_by';
    if a = d then return new; end if;
    for k in select key from jsonb_each(a) loop
      if a -> k = d -> k and k not in ('id', 'clave') then a := a - k; d := d - k; end if;
    end loop;
  end if;
  insert into public.auditoria (tabla, registro_id, accion, antes, despues, restaurado_de)
  values (tg_table_name, coalesce(coalesce(d, a) ->> 'id', coalesce(d, a) ->> 'clave'), tg_op, a, d,
          nullif(current_setting('meh.restaurando', true), '')::bigint);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['gastos', 'ingresos', 'ingresos_metodo', 'alumnos_mes', 'facturacion', 'empresas', 'plantillas_gasto',
    'cuentas_bancarias', 'movimientos_banco', 'notas', 'factcheck_manual', 'categorias', 'subcategorias', 'listas', 'parametros',
    'tarifas', 'centros', 'cursos', 'profiles', 'extractos', 'gestoria_envios', 'gestoria_notas'] loop
    if to_regclass('public.' || t) is not null then
      execute format('create or replace trigger zz_auditar after insert or update or delete on public.%I for each row execute function public.auditar()', t);
    end if;
  end loop;
end $$;

-- Restaurar un cambio (solo admin): vuelve a dejar el registro como estaba antes de ese cambio.
--   UPDATE -> repone los valores anteriores de los campos que cambiaron
--   DELETE -> vuelve a crear el registro borrado
--   INSERT -> no se deshace aquí (sería borrar): se borra desde la propia app si hace falta
create or replace function public.auditoria_restaurar(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare r public.auditoria; cols text; pk text;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede restaurar cambios'; end if;
  select * into r from public.auditoria where id = p_id;
  if not found then raise exception 'Cambio no encontrado'; end if;
  pk := case when r.tabla = 'parametros' then 'clave' else 'id' end;
  perform set_config('meh.restaurando', p_id::text, true);
  if r.accion = 'UPDATE' then
    select string_agg(format('%I', key), ', ') into cols from jsonb_object_keys(r.antes - pk) key;
    if cols is null then return 'Nada que restaurar'; end if;
    execute format('update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1) x) where t.%I::text = $2',
      r.tabla, cols, (select string_agg(format('x.%I', key), ', ') from jsonb_object_keys(r.antes - pk) key), r.tabla, pk)
      using r.antes, r.registro_id;
    return 'Valores anteriores repuestos';
  elsif r.accion = 'DELETE' then
    execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', r.tabla, r.tabla) using r.antes;
    return 'Registro recuperado';
  else
    return 'Es un alta: si sobra, bórrala desde la app';
  end if;
end $$;
revoke all on function public.auditoria_restaurar(bigint) from public, anon;
grant execute on function public.auditoria_restaurar(bigint) to authenticated;
