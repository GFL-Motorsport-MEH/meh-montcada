-- 0119: listas de Seguimiento con color. «Situación» y «Cómo nos conoció» pasan a desplegables de ac_listas (editables desde la app).
-- Solo ALTER / INSERT / UPDATE (nada de DROP ni DELETE). Idempotente.

alter table public.ac_listas add column if not exists color text;

-- ---------- Situación del contacto ----------
-- Unifica con los textos que ya usa el Excel (en mayúsculas): renombra los valores de partida y añade los que faltan.
update public.ac_listas set valor = 'POSIBLE ALUMNO' where lista = 'situacion_contacto' and lower(valor) = 'posible alumno';
update public.ac_listas set valor = 'PRUEBA'         where lista = 'situacion_contacto' and lower(valor) = 'prueba';
update public.ac_listas set valor = 'INSCRITO'       where lista = 'situacion_contacto' and lower(valor) = 'inscrito';
update public.ac_listas set valor = 'DESCARTADO'     where lista = 'situacion_contacto' and lower(valor) = 'descartado';

insert into public.ac_listas (lista, valor, orden, color) values
    ('situacion_contacto', 'POSIBLE ALUMNO', 1, '#2563eb'),
    ('situacion_contacto', 'EN ESPERA', 2, '#d97706'),
    ('situacion_contacto', 'CONTACTADO DE NUEVO', 3, '#0891b2'),
    ('situacion_contacto', 'NO RESPONDE', 4, '#6b7280'),
    ('situacion_contacto', 'PRUEBA', 5, '#7c3aed'),
    ('situacion_contacto', 'APUNTADO', 6, '#16a34a'),
    ('situacion_contacto', 'INSCRITO', 7, '#0f766e'),
    ('situacion_contacto', 'CONTACTAR PARA PRÓXIMO CURSO', 8, '#ea580c'),
    ('situacion_contacto', 'NO INTERESADO', 9, '#dc2626'),
    ('situacion_contacto', 'MOTIVOS ECONÓMICOS', 10, '#db2777'),
    ('situacion_contacto', 'NO POR HORARIOS', 11, '#92400e'),
    ('situacion_contacto', 'DESCARTADO', 12, '#475569')
on conflict (lista, lower(valor)) do update set orden = excluded.orden, color = coalesce(public.ac_listas.color, excluded.color);

-- ---------- Cómo nos conoció ----------
insert into public.ac_listas (lista, valor, orden, color) values
    ('como_conocio', 'Colegio', 1, '#2563eb'),
    ('como_conocio', 'AFA / AMPA', 2, '#0891b2'),
    ('como_conocio', 'Familia de un alumno', 3, '#16a34a'),
    ('como_conocio', 'Recomendación', 4, '#7c3aed'),
    ('como_conocio', 'Instagram', 5, '#db2777'),
    ('como_conocio', 'Redes sociales', 6, '#c026d3'),
    ('como_conocio', 'Web', 7, '#0f766e'),
    ('como_conocio', 'Correo', 8, '#d97706'),
    ('como_conocio', 'Pasaba por la calle', 9, '#ea580c'),
    ('como_conocio', 'Publicidad / folletos', 10, '#92400e'),
    ('como_conocio', 'Otro', 11, '#6b7280')
on conflict (lista, lower(valor)) do update set orden = excluded.orden, color = coalesce(public.ac_listas.color, excluded.color);

-- ---------- Unifica los textos libres que ya tenían los contactos ----------
update public.ac_contactos set comentarios = trim(both ' ' from coalesce(comentarios || ' · ', '') || 'AFA Elvira Cuyas')
    where upper(como_nos_conocio) = 'AFA ELVIRA CUYAS';
update public.ac_contactos set como_nos_conocio = 'AFA / AMPA'            where upper(como_nos_conocio) = 'AFA ELVIRA CUYAS';
update public.ac_contactos set como_nos_conocio = 'Correo'                where upper(como_nos_conocio) = 'CORREO';
update public.ac_contactos set como_nos_conocio = 'Instagram'             where upper(como_nos_conocio) = 'INSTAGRAM';
update public.ac_contactos set como_nos_conocio = 'Recomendación'         where upper(como_nos_conocio) = 'RECOMENDADOS POR CLIENTES';
update public.ac_contactos set como_nos_conocio = 'Familia de un alumno'  where upper(como_nos_conocio) in ('ES MAMÁ DE UN ALUMNO', 'ES PAPÁ DE UN ALUMNO');

alter table public.ac_contactos alter column situacion set default 'POSIBLE ALUMNO';
update public.ac_contactos set situacion = 'POSIBLE ALUMNO' where situacion = 'posible alumno';
