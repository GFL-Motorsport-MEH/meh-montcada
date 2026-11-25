-- Remesas que no son mensuales (bimensual / trimestral): cada cuántos meses se cobran y en qué mes empezaron.
alter table public.ac_remesas_lista
  add column if not exists periodicidad smallint not null default 1 check (periodicidad in (1, 2, 3)),
  add column if not exists primer_mes text;
update public.ac_remesas_lista set periodicidad = 3, primer_mes = 'octubre' where nombre ilike '21 - TRIM%';
