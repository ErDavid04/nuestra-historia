-- ============================================================
-- Nuestra historia — base de datos en Supabase
-- Pega TODO este archivo en Supabase → SQL Editor → New query → Run.
-- Se puede ejecutar varias veces sin romper nada.
-- ============================================================

-- 1) Tabla con el contenido de la página (cfg) y lo que hace quien la visita (estado)
create table if not exists public.pagina (
  id         text primary key default 'main',
  cfg        jsonb not null default '{}'::jsonb,
  estado     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.pagina (id) values ('main') on conflict (id) do nothing;

alter table public.pagina enable row level security;

-- Cualquiera con el enlace puede LEER la página
drop policy if exists "pagina lectura publica" on public.pagina;
create policy "pagina lectura publica" on public.pagina
  for select using (true);

-- Solo tú (usuario con sesión iniciada) puedes MODIFICARLA desde el editor
drop policy if exists "pagina edicion propietario" on public.pagina;
create policy "pagina edicion propietario" on public.pagina
  for update to authenticated using (true) with check (true);

-- 2) Acciones permitidas a quien visita (sin sesión), validadas en el servidor

-- Canjear un vale (solo si existe en la lista de vales)
create or replace function public.canjear_vale(vale text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e jsonb;
begin
  if vale is null or length(vale) > 300 then raise exception 'Vale no válido'; end if;
  update pagina
     set estado = jsonb_set(
           coalesce(estado, '{}'::jsonb), '{usados}',
           case when coalesce(estado->'usados', '[]'::jsonb) ? vale
                then estado->'usados'
                else coalesce(estado->'usados', '[]'::jsonb) || jsonb_build_array(vale) end),
         updated_at = now()
   where id = 'main' and coalesce(cfg->'vales', '[]'::jsonb) ? vale
  returning estado into e;
  if e is null then raise exception 'Ese vale no existe'; end if;
  return e;
end $$;

-- Guardar la respuesta a la pregunta final
create or replace function public.guardar_respuesta(texto text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e jsonb;
begin
  if texto is null or length(trim(texto)) = 0 then raise exception 'La respuesta está vacía'; end if;
  if length(texto) > 5000 then raise exception 'La respuesta es demasiado larga'; end if;
  update pagina
     set estado = coalesce(estado, '{}'::jsonb) || jsonb_build_object('respuesta', texto, 'respuesta_at', now()),
         updated_at = now()
   where id = 'main'
  returning estado into e;
  return e;
end $$;

-- Guardar el resultado de la ruleta (solo opciones que existan)
create or replace function public.guardar_ruleta(opcion text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e jsonb;
begin
  if opcion is null or length(opcion) > 300 then raise exception 'Opción no válida'; end if;
  update pagina
     set estado = coalesce(estado, '{}'::jsonb) || jsonb_build_object('ruleta', opcion, 'ruleta_at', now()),
         updated_at = now()
   where id = 'main' and coalesce(cfg->'ruleta', '[]'::jsonb) ? opcion
  returning estado into e;
  if e is null then raise exception 'Esa opción no existe'; end if;
  return e;
end $$;

revoke all on function public.canjear_vale(text), public.guardar_respuesta(text), public.guardar_ruleta(text) from public;
grant execute on function public.canjear_vale(text), public.guardar_respuesta(text), public.guardar_ruleta(text) to anon, authenticated;

-- 3) Almacén de fotos y canción (lectura pública, subida solo con sesión)
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 31457280)
on conflict (id) do update set public = true, file_size_limit = 31457280;

drop policy if exists "media lectura" on storage.objects;
create policy "media lectura" on storage.objects
  for select using (bucket_id = 'media');

drop policy if exists "media subida propietario" on storage.objects;
create policy "media subida propietario" on storage.objects
  for insert to authenticated with check (bucket_id = 'media');

drop policy if exists "media cambios propietario" on storage.objects;
create policy "media cambios propietario" on storage.objects
  for update to authenticated using (bucket_id = 'media');

drop policy if exists "media borrado propietario" on storage.objects;
create policy "media borrado propietario" on storage.objects
  for delete to authenticated using (bucket_id = 'media');
