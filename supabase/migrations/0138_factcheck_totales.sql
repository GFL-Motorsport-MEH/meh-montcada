-- Totales para Control > FactCheck calculados en la base de datos (sin descargar todas las líneas).
-- Son funciones de solo lectura con los permisos del usuario (RLS se aplica igual). Ya aplicada en Supabase.
create or replace function public.factcheck_facturacion(p_desde date, p_hasta date)
returns table (periodo text, metodo_pago text, total numeric)
language sql stable security invoker set search_path = public as $$
  select to_char(fecha_pago, 'YYYY-MM'), f.metodo_pago, coalesce(sum(f.cantidad), 0)
  from public.facturacion f
  where f.fecha_pago >= p_desde and f.fecha_pago <= p_hasta
  group by 1, 2
$$;

create or replace function public.factcheck_banco(p_desde date, p_hasta date)
returns table (periodo text, centro_id uuid, total numeric)
language sql stable security invoker set search_path = public as $$
  select to_char(m.fecha, 'YYYY-MM'), m.centro_id, coalesce(sum(m.importe), 0)
  from public.movimientos_banco m
  where m.fecha >= p_desde and m.fecha <= p_hasta and m.importe > 0 and m.estado <> 'ignorado'
  group by 1, 2
$$;

grant execute on function public.factcheck_facturacion(date, date) to authenticated;
grant execute on function public.factcheck_banco(date, date) to authenticated;
