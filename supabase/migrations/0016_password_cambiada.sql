-- 0016: el propio usuario quita la marca de "contraseña provisional" tras cambiarla
create or replace function public.password_cambiada()
returns void language sql security definer set search_path = public as $$
  update public.profiles set debe_cambiar_password = false where id = auth.uid();
$$;
revoke execute on function public.password_cambiada() from public, anon;
grant execute on function public.password_cambiada() to authenticated;
