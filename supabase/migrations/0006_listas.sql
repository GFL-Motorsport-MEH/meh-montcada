-- Listas editables (hoja ListasNuevas): metodos de pago, periodicidad y tipo de documento de los gastos.
-- Las categorias y subcategorias ya tienen sus propias tablas.
create table if not exists public.listas (
    id uuid primary key default gen_random_uuid(),
    lista text not null check (lista in ('metodo_pago', 'periodicidad', 'tipo')),
    valor text not null,
    orden integer not null default 0,
    created_at timestamptz not null default now()
);
create unique index if not exists listas_valor_idx on public.listas (lista, lower(valor));

alter table public.listas enable row level security;
create policy "empleados leen listas" on public.listas for select to authenticated using (public.usuario_activo());
create policy "admin gestiona listas" on public.listas for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- Carga inicial con los valores usados en los gastos (los mas usados primero)
insert into public.listas (lista, valor, orden)
select l, v, (row_number() over (partition by l order by n desc))::int
from (
    select 'metodo_pago' l, trim(metodo_pago) v, count(*) n from public.gastos where coalesce(trim(metodo_pago), '') <> '' group by 2
    union all select 'periodicidad', trim(periodicidad), count(*) from public.gastos where coalesce(trim(periodicidad), '') <> '' group by 2
    union all select 'tipo', trim(tipo), count(*) from public.gastos where coalesce(trim(tipo), '') <> '' group by 2
) x
on conflict do nothing;

-- Renombrar un valor de una lista y cambiarlo en todos los gastos de todos los cursos, en una sola transaccion.
-- Si el nuevo valor ya existe, se fusionan (el anterior desaparece de la lista). Solo admin.
create or replace function public.renombrar_valor_lista(p_lista text, p_anterior text, p_nuevo text)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    n integer;
begin
    if not public.es_admin() then
        raise exception 'Solo un administrador puede cambiar las listas';
    end if;
    if p_lista not in ('metodo_pago', 'periodicidad', 'tipo') then
        raise exception 'Lista desconocida: %', p_lista;
    end if;
    p_nuevo := trim(p_nuevo);
    if p_nuevo = '' then
        raise exception 'El nuevo valor no puede estar vacio';
    end if;
    execute format('update public.gastos set %I = $1 where %I = $2', p_lista, p_lista) using p_nuevo, p_anterior;
    get diagnostics n = row_count;
    if exists (select 1 from public.listas where lista = p_lista and lower(valor) = lower(p_nuevo) and lower(valor) <> lower(p_anterior)) then
        delete from public.listas where lista = p_lista and valor = p_anterior;
    else
        update public.listas set valor = p_nuevo where lista = p_lista and valor = p_anterior;
    end if;
    return n;
end;
$$;
grant execute on function public.renombrar_valor_lista(text, text, text) to authenticated;
