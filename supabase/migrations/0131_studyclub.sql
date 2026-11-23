-- 0131: Study Club (en la base de datos ya aplicada con el nombre «0128_studyclub», el 23-nov-2026).
-- Sesiones de repaso de lunes a jueves 20:10-20:40 con temario y profesora, reservas con control de plazas EN EL SERVIDOR,
-- funciones públicas para el formulario externo (StudyClub en GitHub Pages) y permiso al_studyclub.
-- El formulario público solo puede llamar a studyclub_semana (plazas libres, sin nombres) y studyclub_reservar; no lee ninguna tabla.
-- Calendario suscribible por profesora: Edge Function «studyclub-ics» (token en al_studyclub_ics).
-- Solo CREATE / INSERT / CREATE OR REPLACE (sin borrados).

create table public.al_studyclub_config (
  id int primary key default 1 check (id = 1),
  dias smallint[] not null default '{1,2,3,4}',
  hora_inicio time not null default '20:10',
  hora_fin time not null default '20:40',
  plazas int not null default 6 check (plazas > 0),
  profesora_id uuid references public.ac_profesoras(id) on delete set null,
  semanas_adelante int not null default 8 check (semanas_adelante between 1 and 26),
  centro_id uuid references public.centros(id),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.al_studyclub_sesiones (
  id uuid primary key default gen_random_uuid(),
  centro_id uuid not null default public.centro_principal() references public.centros(id),
  fecha date not null,
  hora_inicio time not null default '20:10',
  hora_fin time not null default '20:40',
  titulo text,
  profesora_id uuid references public.ac_profesoras(id) on delete set null,
  plazas int not null default 6 check (plazas > 0),
  estado text not null default 'abierta' check (estado in ('abierta','cerrada','cancelada')),
  notas text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (centro_id, fecha, hora_inicio)
);
create index on public.al_studyclub_sesiones (fecha);
create index on public.al_studyclub_sesiones (profesora_id, fecha);

create table public.al_studyclub_reservas (
  id uuid primary key default gen_random_uuid(),
  sesion_id uuid not null references public.al_studyclub_sesiones(id) on delete cascade,
  alumno_id uuid references public.ac_alumnos(id) on delete set null,
  nombre text not null,
  email text,
  telefono text,
  tema text,
  estado text not null default 'apuntado' check (estado in ('apuntado','cancelado')),
  asistencia text check (asistencia in ('asistio','falta')),
  origen text not null default 'web' check (origen in ('web','manual','importado')),
  origen_ref text,
  notas text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index on public.al_studyclub_reservas (sesion_id);
create index on public.al_studyclub_reservas (alumno_id);

create table public.al_studyclub_ics (
  profesora_id uuid primary key references public.ac_profesoras(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create trigger al_studyclub_config_set_updated before update on public.al_studyclub_config for each row execute function public.set_updated_audit();
create trigger al_studyclub_sesiones_set_updated before update on public.al_studyclub_sesiones for each row execute function public.set_updated_audit();
create trigger al_studyclub_reservas_set_updated before update on public.al_studyclub_reservas for each row execute function public.set_updated_audit();

alter table public.al_studyclub_config enable row level security;
alter table public.al_studyclub_sesiones enable row level security;
alter table public.al_studyclub_reservas enable row level security;
alter table public.al_studyclub_ics enable row level security;

revoke all on public.al_studyclub_config, public.al_studyclub_sesiones, public.al_studyclub_reservas, public.al_studyclub_ics from anon;
grant select, insert, update, delete on public.al_studyclub_config, public.al_studyclub_sesiones, public.al_studyclub_reservas, public.al_studyclub_ics to authenticated;

-- config
create policy leer on public.al_studyclub_config for select to authenticated using (public.perm_ve('al_studyclub'));
create policy escribir on public.al_studyclub_config for all to authenticated using (public.perm_edita_todo('al_studyclub')) with check (public.perm_edita_todo('al_studyclub'));

-- sesiones
create policy centro on public.al_studyclub_sesiones as restrictive for all to authenticated
  using ((select public.mi_centro()) is null or public.centro_ok(centro_id))
  with check ((select public.mi_centro()) is null or public.centro_ok(centro_id));
create policy leer on public.al_studyclub_sesiones for select to authenticated using (public.perm_ve('al_studyclub'));
create policy escribir on public.al_studyclub_sesiones for all to authenticated using (public.perm_edita_todo('al_studyclub')) with check (public.perm_edita_todo('al_studyclub'));
create policy mi_sesion on public.al_studyclub_sesiones for update to authenticated
  using (profesora_id is not null and profesora_id = public.mi_profesora())
  with check (profesora_id is not null and profesora_id = public.mi_profesora());
create policy leer_mia on public.al_studyclub_sesiones for select to authenticated
  using (profesora_id is not null and profesora_id = public.mi_profesora());

-- reservas
create policy centro on public.al_studyclub_reservas as restrictive for all to authenticated
  using ((select public.mi_centro()) is null or exists (select 1 from public.al_studyclub_sesiones s where s.id = sesion_id and public.centro_ok(s.centro_id)))
  with check ((select public.mi_centro()) is null or exists (select 1 from public.al_studyclub_sesiones s where s.id = sesion_id and public.centro_ok(s.centro_id)));
create policy leer on public.al_studyclub_reservas for select to authenticated using (public.perm_ve('al_studyclub'));
create policy escribir on public.al_studyclub_reservas for all to authenticated using (public.perm_edita_todo('al_studyclub')) with check (public.perm_edita_todo('al_studyclub'));
create policy mi_sesion_ver on public.al_studyclub_reservas for select to authenticated
  using (exists (select 1 from public.al_studyclub_sesiones s where s.id = sesion_id and s.profesora_id = public.mi_profesora()));
create policy mi_sesion_asistencia on public.al_studyclub_reservas for update to authenticated
  using (exists (select 1 from public.al_studyclub_sesiones s where s.id = sesion_id and s.profesora_id = public.mi_profesora()))
  with check (exists (select 1 from public.al_studyclub_sesiones s where s.id = sesion_id and s.profesora_id = public.mi_profesora()));
create policy familia_ve on public.al_studyclub_reservas for select to authenticated using (alumno_id is not null and public.es_mi_hijo(alumno_id));

-- tokens .ics: cada profesora ve el suyo; quien edita Study Club, todos
create policy leer on public.al_studyclub_ics for select to authenticated
  using (profesora_id = public.mi_profesora() or public.perm_edita_todo('al_studyclub'));
create policy escribir on public.al_studyclub_ics for all to authenticated
  using (profesora_id = public.mi_profesora() or public.perm_edita_todo('al_studyclub'))
  with check (profesora_id = public.mi_profesora() or public.perm_edita_todo('al_studyclub'));

-- Generador interno de sesiones (idempotente). Salta festivos y días ya existentes.
create or replace function public._studyclub_gen(p_desde date, p_hasta date)
returns int language plpgsql security definer set search_path = public as $$
declare cfg record; n int := 0; d date; hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  select * into cfg from al_studyclub_config where id = 1;
  if not found then return 0; end if;
  for d in select g::date from generate_series(greatest(p_desde, hoy), p_hasta, interval '1 day') g loop
    if extract(isodow from d)::smallint = any (cfg.dias)
       and not exists (select 1 from ac_calendario_marcas m where m.fecha = d and m.tipo = 'festivo') then
      insert into al_studyclub_sesiones (centro_id, fecha, hora_inicio, hora_fin, profesora_id, plazas)
      values (coalesce(cfg.centro_id, centro_principal()), d, cfg.hora_inicio, cfg.hora_fin, cfg.profesora_id, cfg.plazas)
      on conflict (centro_id, fecha, hora_inicio) do nothing;
      if found then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public._studyclub_gen(date, date) from public, anon, authenticated;

-- Para el personal: generar sesiones de un rango
create or replace function public.studyclub_generar(p_desde date, p_hasta date)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.perm_edita_todo('al_studyclub') then raise exception 'sin permiso'; end if;
  return public._studyclub_gen(p_desde, p_hasta);
end $$;
revoke all on function public.studyclub_generar(date, date) from public, anon;
grant execute on function public.studyclub_generar(date, date) to authenticated;

-- PÚBLICO: sesiones de una semana con plazas libres (sin datos personales)
create or replace function public.studyclub_semana(p_lunes date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg record; v_lunes date; hoy date := (now() at time zone 'Europe/Madrid')::date; v_max date;
begin
  select * into cfg from al_studyclub_config where id = 1;
  if not found then return jsonb_build_object('lunes', null, 'sesiones', '[]'::jsonb); end if;
  v_lunes := date_trunc('week', p_lunes)::date;
  v_max := hoy + cfg.semanas_adelante * 7;
  if v_lunes <= v_max then
    perform public._studyclub_gen(v_lunes, least(v_lunes + 6, v_max));
  end if;
  return jsonb_build_object(
    'lunes', v_lunes,
    'sesiones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'fecha', s.fecha, 'hora_inicio', to_char(s.hora_inicio, 'HH24:MI'), 'hora_fin', to_char(s.hora_fin, 'HH24:MI'),
        'titulo', s.titulo, 'estado', s.estado, 'plazas', s.plazas,
        'ocupadas', o.n, 'libres', greatest(s.plazas - o.n, 0),
        'abierta', (s.estado = 'abierta' and (s.fecha + s.hora_inicio) at time zone 'Europe/Madrid' > now() and o.n < s.plazas),
        'profesora', p.nombre
      ) order by s.fecha, s.hora_inicio)
      from al_studyclub_sesiones s
      left join ac_profesoras p on p.id = s.profesora_id
      cross join lateral (select count(*)::int n from al_studyclub_reservas r where r.sesion_id = s.id and r.estado = 'apuntado') o
      where s.fecha between v_lunes and v_lunes + 6 and s.estado <> 'cancelada'
    ), '[]'::jsonb));
end $$;
revoke all on function public.studyclub_semana(date) from public;
grant execute on function public.studyclub_semana(date) to anon, authenticated;

-- PÚBLICO: reservar con control de plazas en servidor
create or replace function public.studyclub_reservar(p_sesion uuid, p_nombre text, p_email text, p_telefono text, p_tema text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; n int; v_nombre text := btrim(coalesce(p_nombre, '')); v_email text := lower(btrim(coalesce(p_email, '')));
        v_tel text := btrim(coalesce(p_telefono, '')); v_tema text := nullif(btrim(coalesce(p_tema, '')), ''); v_id uuid;
begin
  if char_length(v_nombre) < 2 or char_length(v_nombre) > 120 then return jsonb_build_object('ok', false, 'error', 'nombre_invalido'); end if;
  if char_length(v_email) > 160 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'email_invalido'); end if;
  if char_length(v_tel) < 6 or char_length(v_tel) > 30 then return jsonb_build_object('ok', false, 'error', 'telefono_invalido'); end if;
  if v_tema is not null and char_length(v_tema) > 200 then v_tema := left(v_tema, 200); end if;

  select * into s from al_studyclub_sesiones where id = p_sesion for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'sesion_no_existe'); end if;
  if s.estado <> 'abierta' then return jsonb_build_object('ok', false, 'error', 'sesion_cerrada'); end if;
  if (s.fecha + s.hora_inicio) at time zone 'Europe/Madrid' <= now() then return jsonb_build_object('ok', false, 'error', 'sesion_pasada'); end if;
  if exists (select 1 from al_studyclub_reservas r where r.sesion_id = s.id and r.estado = 'apuntado'
             and lower(r.nombre) = lower(v_nombre) and lower(coalesce(r.email, '')) = v_email) then
    return jsonb_build_object('ok', false, 'error', 'ya_apuntado');
  end if;
  select count(*) into n from al_studyclub_reservas r where r.sesion_id = s.id and r.estado = 'apuntado';
  if n >= s.plazas then return jsonb_build_object('ok', false, 'error', 'completa'); end if;

  insert into al_studyclub_reservas (sesion_id, nombre, email, telefono, tema, origen)
  values (s.id, v_nombre, v_email, v_tel, v_tema, 'web') returning id into v_id;

  return jsonb_build_object('ok', true, 'reserva_id', v_id,
    'sesion', jsonb_build_object('id', s.id, 'fecha', s.fecha, 'hora_inicio', to_char(s.hora_inicio, 'HH24:MI'),
                                 'hora_fin', to_char(s.hora_fin, 'HH24:MI'), 'titulo', s.titulo));
end $$;
revoke all on function public.studyclub_reservar(uuid, text, text, text, text) from public;
grant execute on function public.studyclub_reservar(uuid, text, text, text, text) to anon, authenticated;

-- Permisos del módulo
insert into public.rol_permisos (rol, permiso, alcance, editar) values
  ('coordinacion', 'al_studyclub', 'todo', true),
  ('direccion', 'al_studyclub', 'todo', true),
  ('profesora', 'al_studyclub', 'todo', false)
on conflict do nothing;

-- Configuración inicial: Lun-Jue 20:10-20:40, 6 plazas, Paula Alcala por defecto, Montcada
insert into public.al_studyclub_config (id, profesora_id, centro_id)
select 1, (select id from public.ac_profesoras where nombre = 'Paula Alcala' limit 1), public.centro_principal()
on conflict do nothing;

insert into public.al_studyclub_ics (profesora_id) select id from public.ac_profesoras where activa on conflict do nothing;
