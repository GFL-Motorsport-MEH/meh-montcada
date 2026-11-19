-- Preferencias de interfaz por usuario (orden de pestañas), para que se mantengan en todos los dispositivos.
create table if not exists public.ui_preferencias (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  tabs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.ui_preferencias enable row level security;
create policy "preferencias propias lectura" on public.ui_preferencias for select using (user_id = auth.uid());
create policy "preferencias propias alta" on public.ui_preferencias for insert with check (user_id = auth.uid());
create policy "preferencias propias cambio" on public.ui_preferencias for update using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.ui_preferencias to authenticated;
