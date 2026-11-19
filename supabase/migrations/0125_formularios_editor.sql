-- Editor de formularios: cabecera con logo/foto, ajustes, plantillas y corrección automática (nota).
alter table public.ac_formularios add column if not exists imagen_cabecera text;
alter table public.ac_formularios add column if not exists config jsonb not null default '{}'::jsonb;
alter table public.ac_formularios add column if not exists plantilla boolean not null default false;
alter table public.ac_formulario_respuestas add column if not exists puntuacion numeric;
alter table public.ac_formulario_respuestas add column if not exists puntuacion_max numeric;

-- Bucket PÚBLICO solo para las imágenes de los formularios (cabeceras y fotos). Solo quien edita formularios puede subir o borrar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('formularios', 'formularios', true, 3145728, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
create policy "subir formularios" on storage.objects for insert to authenticated with check (bucket_id = 'formularios' and public.perm_edita_todo('ac_formularios'));
create policy "actualizar formularios" on storage.objects for update to authenticated using (bucket_id = 'formularios' and public.perm_edita_todo('ac_formularios'));
create policy "borrar formularios" on storage.objects for delete to authenticated using (bucket_id = 'formularios' and public.perm_edita_todo('ac_formularios'));
