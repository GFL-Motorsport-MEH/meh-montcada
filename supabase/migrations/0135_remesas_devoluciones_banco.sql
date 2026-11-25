-- Las devoluciones de recibos se concilian con el movimiento negativo del banco:
-- un enlace de remesa puede ser negativo (resta del ingresado del mes y banco).
alter table public.movimiento_remesas drop constraint if exists movimiento_remesas_importe_check;
alter table public.movimiento_remesas add constraint movimiento_remesas_importe_check check (importe <> 0);
drop table if exists public.remesa_devoluciones;
