-- Aviso de respuestas de formularios sin abrir: se marca la primera vez que alguien con permiso las abre.
alter table public.ac_formulario_respuestas add column if not exists visto_at timestamptz;
alter table public.ac_formulario_respuestas add column if not exists visto_por uuid references public.profiles(id);
-- Lo que ya estaba procesado o descartado cuenta como visto.
update public.ac_formulario_respuestas set visto_at = coalesce(visto_at, updated_at) where estado <> 'nueva' and visto_at is null;
create index if not exists ac_formulario_respuestas_sinver_idx on public.ac_formulario_respuestas (created_at) where estado = 'nueva' and visto_at is null;
