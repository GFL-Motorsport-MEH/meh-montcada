-- 0013: control de envío de facturas a la gestoría (FISCONTAL).
-- gastos.fiscontal ('True'/'False') ya existía (columna del Excel). Se añade la fecha en que se marcó como enviada,
-- y el texto de la carpeta sugerida para guardar la factura en OneDrive (lo rellena el escáner de facturas).
alter table public.gastos add column if not exists fiscontal_fecha date;
update public.gastos set fiscontal_fecha = coalesce(fecha_pago, fecha_factura)
where fiscontal = 'True' and fiscontal_fecha is null;
