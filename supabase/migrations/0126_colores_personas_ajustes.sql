-- Colores de las personas (círculos de siglas en tareas y reuniones) y ajustes personales de la app.
-- Sin ningún DROP, para que se pueda aplicar sin confirmaciones.

-- Color elegido para cada usuario (vacío = la app reparte colores distintos automáticamente)
alter table public.profiles add column if not exists color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$');

-- Ajustes de cada usuario (colores de pestañas, pantalla de inicio, datos en segundo plano), en todos sus dispositivos
alter table public.ui_preferencias add column if not exists ajustes jsonb not null default '{}'::jsonb;

-- Color de cada compañero de equipo (misma regla de visibilidad que equipo_tareas)
create or replace function public.equipo_colores()
returns table(id uuid, color text)
language sql stable security definer set search_path to 'public' as $$
    select p.id, p.color
    from public.profiles p
    where p.activo and public.ac_acceso() and (public.mi_centro() is null or p.centro_id is null or p.centro_id = public.mi_centro());
$$;
revoke execute on function public.equipo_colores() from public, anon;
grant execute on function public.equipo_colores() to authenticated;

-- Profesoras: todas nacieron con el mismo azul. Si hay varias con ese color por defecto, se reparten colores distintos
-- (solo las que siguen con el azul inicial; las que ya tienen un color elegido no se tocan).
with defecto as (
    select id, row_number() over (order by orden, nombre) as n
    from public.ac_profesoras
    where color = '#4f7cff'
), paleta(i, c) as (
    values (1, '#3b6fd8'), (2, '#d6455d'), (3, '#23966b'), (4, '#d17a12'), (5, '#7c4dcc'), (6, '#0f95aa'),
           (7, '#b83b86'), (8, '#6f8416'), (9, '#cf5b2b'), (10, '#4b6676'), (11, '#9a3f27'), (12, '#2f7fbf')
)
update public.ac_profesoras p
set color = (select c from paleta where i = ((d.n - 1) % 12) + 1)
from defecto d
where p.id = d.id and (select count(*) from defecto) > 1;
