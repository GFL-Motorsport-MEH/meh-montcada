-- PDFs de facturas en Supabase Storage (bucket privado "facturas"). En gastos.link_factura se guarda
-- "storage:<ruta>"; la app abre el archivo con un enlace firmado temporal.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facturas', 'facturas', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "empleados leen facturas" on storage.objects for select to authenticated
    using (bucket_id = 'facturas' and public.usuario_activo());
create policy "empleados suben facturas" on storage.objects for insert to authenticated
    with check (bucket_id = 'facturas' and public.usuario_activo());
create policy "empleados actualizan facturas" on storage.objects for update to authenticated
    using (bucket_id = 'facturas' and public.usuario_activo());
