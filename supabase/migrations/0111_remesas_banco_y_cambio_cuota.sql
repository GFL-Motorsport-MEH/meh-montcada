-- 0111: Remesas por banco + aviso cuando la cuota de un alumno cambia a mitad de mes.
-- 1) ac_remesas.banco: BBVA o SABADELL (varias remesas el mismo mes, una por banco). Nulo = sin asignar (remesas importadas).
-- 2) ac_cuotas.nota_cambio / cambio_cuota_*: se rellenan solos cuando cambia ac_inscripciones.cuota_mensual
--    durante el mes en curso y la cuota de ese mes aún no está marcada como pagada.

alter table public.ac_remesas add column if not exists banco text check (banco in ('BBVA', 'SABADELL'));

alter table public.ac_cuotas add column if not exists nota_cambio text;
alter table public.ac_cuotas add column if not exists cambio_cuota_de numeric(8, 2);
alter table public.ac_cuotas add column if not exists cambio_cuota_a numeric(8, 2);
alter table public.ac_cuotas add column if not exists cambio_cuota_fecha date;

create or replace function public.ac_aviso_cambio_cuota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    hoy date := (now() at time zone 'Europe/Madrid')::date;
    meses text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    mes_actual text := meses[extract(month from (now() at time zone 'Europe/Madrid'))::int];
    c record;
    donde text;
    texto text;
begin
    if new.cuota_mensual is not distinct from old.cuota_mensual then return new; end if;
    for c in
        select q.id, q.importe, q.remesa_id, q.nota_cambio, q.cambio_cuota_de
        from public.ac_cuotas q
        where q.alumno_id = new.alumno_id and q.curso_id = new.curso_id
          and q.concepto = 'mensualidad' and q.mes = mes_actual and q.estado = 'pendiente'
    loop
        select coalesce(r.nombre, 'remesa') || coalesce(' · ' || r.banco, '') || ' (' || r.estado || ')'
          into donde from public.ac_remesas r where r.id = c.remesa_id;
        texto := to_char(hoy, 'DD/MM') || ': cuota cambiada de ' || to_char(coalesce(old.cuota_mensual, 0), 'FM999990.00') || ' € a '
              || to_char(coalesce(new.cuota_mensual, 0), 'FM999990.00') || ' €; el cargo de ' || mes_actual || ' es de '
              || to_char(c.importe, 'FM999990.00') || ' €'
              || case when donde is not null then ' y está en ' || donde else ' (aún sin remesa)' end || '.';
        update public.ac_cuotas
           set nota_cambio = case when c.nota_cambio is null then texto else c.nota_cambio || E'\n' || texto end,
               cambio_cuota_de = coalesce(c.cambio_cuota_de, old.cuota_mensual),
               cambio_cuota_a = new.cuota_mensual,
               cambio_cuota_fecha = hoy
         where id = c.id;
    end loop;
    return new;
end;
$$;

drop trigger if exists ac_aviso_cambio_cuota on public.ac_inscripciones;
create trigger ac_aviso_cambio_cuota
    after update of cuota_mensual on public.ac_inscripciones
    for each row execute function public.ac_aviso_cambio_cuota();
