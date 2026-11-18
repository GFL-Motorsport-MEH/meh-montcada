-- Reflejo en el repo de la migración "ac_alumnos_num_decimal_y_siglas_profesoras" que ya está aplicada en Supabase_MEH
-- (el fichero no se había subido). Es idempotente: en la base de datos real no cambia nada.
-- El ID del Excel puede llevar decimales (p. ej. 12.1), así que num pasa de integer a numeric.
do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'ac_alumnos' and column_name = 'num') = 'integer' then
    alter table public.ac_alumnos alter column num type numeric using num::numeric;
  end if;
end $$;

-- Siglas de las profesoras (MF, MM, FL, PA, NR, AE).
alter table public.ac_profesoras add column if not exists siglas text;
