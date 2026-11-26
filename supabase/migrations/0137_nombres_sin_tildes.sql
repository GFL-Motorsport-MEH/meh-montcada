-- Nombres sin tildes: los datos NUEVOS o MODIFICADOS (nombre, apellidos, colegio...) se guardan sin tildes ni diéresis
-- (la ñ se conserva; la ç pasa a c). Los registros existentes no se tocan. Además, columna oculta *_norm para buscar y vincular.
create or replace function public.f_sin_tildes(s text) returns text language sql immutable parallel safe as $$
  select translate(s,
    'áàäâãéèëêíìïîóòöôõúùüûýÿÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÝçÇ',
    'aaaaaeeeeiiiiooooouuuuyyAAAAAEEEEIIIIOOOOOUUUUYcC');
$$;

-- texto en minúsculas, sin tildes ni ñ, para comparar y buscar
create or replace function public.f_norm(s text) returns text language sql immutable parallel safe as $$
  select lower(translate(public.f_sin_tildes(s), 'ñÑ', 'nN'));
$$;

create or replace function public.trg_sin_tildes() returns trigger language plpgsql as $$
declare j jsonb := to_jsonb(new); o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end; c text; cambio boolean := false;
begin
  foreach c in array tg_argv loop
    if j ? c and jsonb_typeof(j -> c) = 'string' and (tg_op = 'INSERT' or (j ->> c) is distinct from (o ->> c))
       and (j ->> c) <> public.f_sin_tildes(j ->> c) then
      j := jsonb_set(j, array[c], to_jsonb(public.f_sin_tildes(j ->> c))); cambio := true;
    end if;
  end loop;
  if cambio then new := jsonb_populate_record(new, j); end if;
  return new;
end $$;

do $$
declare t record; cols text[]; c text;
begin
  for t in select * from (values
    ('ac_alumnos', array['nombre','apellidos','colegio']), ('ac_responsables', array['nombre','apellidos']),
    ('ac_autorizados', array['nombre']), ('ac_contactos', array['nombre']), ('ac_profesoras', array['nombre']),
    ('ac_grupos', array['nombre']), ('al_teens_alumnos', array['nombre']), ('al_studyclub_reservas', array['nombre']),
    ('ac_responsables_priv', array['titular_iban'])) as v(tabla, columnas) loop
    cols := array[]::text[];
    foreach c in array t.columnas loop
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t.tabla and column_name = c and data_type in ('text', 'character varying')) then cols := cols || c; end if;
    end loop;
    if array_length(cols, 1) > 0 then
      execute format('drop trigger if exists sin_tildes on public.%I', t.tabla);
      execute format('create trigger sin_tildes before insert or update on public.%I for each row execute function public.trg_sin_tildes(%s)', t.tabla, (select string_agg(quote_literal(x), ',') from unnest(cols) x));
    end if;
  end loop;
end $$;

-- columna de búsqueda (generada, no se escribe nunca a mano)
alter table public.ac_alumnos add column if not exists nombre_norm text generated always as (public.f_norm(coalesce(apellidos, '') || ' ' || coalesce(nombre, ''))) stored;
alter table public.ac_responsables add column if not exists nombre_norm text generated always as (public.f_norm(coalesce(apellidos, '') || ' ' || coalesce(nombre, ''))) stored;
create index if not exists ac_alumnos_nombre_norm_idx on public.ac_alumnos (nombre_norm);
create index if not exists ac_responsables_nombre_norm_idx on public.ac_responsables (nombre_norm);
