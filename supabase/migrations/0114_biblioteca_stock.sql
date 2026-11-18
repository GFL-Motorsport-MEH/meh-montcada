-- Biblioteca y Mascotas: stock (catálogo) de libros y mascotas viajeras, con foto de portada.
-- Los préstamos (ac_prestamos) se enlazan opcionalmente con un artículo del stock (item_id).
create table if not exists public.ac_biblioteca_items (
    id uuid primary key default gen_random_uuid(),
    tipo text not null default 'libro' check (tipo in ('libro', 'mascota')),
    titulo text not null,          -- título del libro o nombre de la mascota
    nivel text,                    -- nivel (mascotas viajeras)
    ejemplares integer not null default 1 check (ejemplares >= 0),
    portada text,                  -- ruta en el bucket «portadas»
    notas text,
    activo boolean not null default true,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid() references public.profiles(id),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
create unique index if not exists ac_biblioteca_items_uq on public.ac_biblioteca_items (tipo, lower(titulo));

create trigger ac_biblioteca_items_set_updated before update on public.ac_biblioteca_items for each row execute procedure public.set_updated_audit();

alter table public.ac_biblioteca_items enable row level security;
create policy leer on public.ac_biblioteca_items for select to authenticated using (public.perm_ve('ac_biblioteca'));
create policy insertar on public.ac_biblioteca_items for insert to authenticated with check (public.perm_edita_todo('ac_biblioteca'));
create policy modificar on public.ac_biblioteca_items for update to authenticated using (public.perm_edita_todo('ac_biblioteca')) with check (public.perm_edita_todo('ac_biblioteca'));
create policy borrar on public.ac_biblioteca_items for delete to authenticated using (public.perm_edita_todo('ac_biblioteca'));

alter table public.ac_prestamos add column if not exists item_id uuid references public.ac_biblioteca_items(id) on delete set null;
create index if not exists ac_prestamos_item_idx on public.ac_prestamos (item_id);

-- Bucket de portadas (público para lectura: son portadas de libros y fotos de peluches, sin datos personales).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portadas', 'portadas', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "biblioteca sube portadas" on storage.objects for insert to authenticated
    with check (bucket_id = 'portadas' and public.perm_edita_todo('ac_biblioteca'));
create policy "biblioteca cambia portadas" on storage.objects for update to authenticated
    using (bucket_id = 'portadas' and public.perm_edita_todo('ac_biblioteca'));
create policy "biblioteca borra portadas" on storage.objects for delete to authenticated
    using (bucket_id = 'portadas' and public.perm_edita_todo('ac_biblioteca'));

-- Stock inicial a partir de lo que ya hay en el registro de préstamos (variantes de escritura unificadas).
-- 1 ejemplar por título y por nivel de mascota: ajustar en la pestaña Stock.
insert into public.ac_biblioteca_items (tipo, titulo)
select 'libro', min(coalesce((jsonb_build_object('dogman', 'Dog Man', 'dragons loves tacos', 'Dragons love tacos', 'kate on the cas', 'Kate on the case', 'whta''s in the witch''s kitchen?', 'What''s in the Witch''s Kitchen', 'circus', 'The circus book', 'kika. at vampire castle.', 'Kika Superwitch at vampire castle', 'in search or the secret gate', 'In search of the secret gate', 'in search of the secret', 'In search of the secret gate', 'mindful of monsters', 'Be mindful of monsters') ->> lower(trim(libro))), trim(libro))) from public.ac_prestamos
where tipo = 'libro' and nullif(trim(libro), '') is not null
group by lower(coalesce((jsonb_build_object('dogman', 'Dog Man', 'dragons loves tacos', 'Dragons love tacos', 'kate on the cas', 'Kate on the case', 'whta''s in the witch''s kitchen?', 'What''s in the Witch''s Kitchen', 'circus', 'The circus book', 'kika. at vampire castle.', 'Kika Superwitch at vampire castle', 'in search or the secret gate', 'In search of the secret gate', 'in search of the secret', 'In search of the secret gate', 'mindful of monsters', 'Be mindful of monsters') ->> lower(trim(libro))), trim(libro)))
on conflict do nothing;

insert into public.ac_biblioteca_items (tipo, titulo, nivel)
select 'mascota', 'Mascota viajera · Nivel ' || nivel, nivel from (select distinct trim(nivel) as nivel from public.ac_prestamos where tipo = 'mascota' and nullif(trim(nivel), '') is not null) n
on conflict do nothing;

update public.ac_prestamos p set item_id = i.id
from public.ac_biblioteca_items i
where p.item_id is null and p.tipo = 'libro' and i.tipo = 'libro' and lower(i.titulo) = lower(coalesce((jsonb_build_object('dogman', 'Dog Man', 'dragons loves tacos', 'Dragons love tacos', 'kate on the cas', 'Kate on the case', 'whta''s in the witch''s kitchen?', 'What''s in the Witch''s Kitchen', 'circus', 'The circus book', 'kika. at vampire castle.', 'Kika Superwitch at vampire castle', 'in search or the secret gate', 'In search of the secret gate', 'in search of the secret', 'In search of the secret gate', 'mindful of monsters', 'Be mindful of monsters') ->> lower(trim(p.libro))), trim(p.libro)));

update public.ac_prestamos p set item_id = i.id
from public.ac_biblioteca_items i
where p.item_id is null and p.tipo = 'mascota' and i.tipo = 'mascota' and i.nivel = trim(p.nivel);
