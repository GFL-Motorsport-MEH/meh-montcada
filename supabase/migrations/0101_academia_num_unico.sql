-- Índice único completo sobre el nº de alumno (los NULL no chocan entre sí) para poder importar con "upsert por num".
create unique index if not exists ac_alumnos_num_uq on public.ac_alumnos (num);
