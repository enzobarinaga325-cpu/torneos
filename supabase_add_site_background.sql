-- Fondo global para la vista de los clientes (home + página de cada torneo).
-- Pegar y ejecutar en el SQL Editor de Supabase.

create table if not exists site_settings (
  id int primary key default 1,
  background_url text,
  constraint site_settings_single_row check (id = 1)
);
insert into site_settings (id) values (1) on conflict (id) do nothing;

alter table site_settings enable row level security;

drop policy if exists "public read site_settings" on site_settings;
create policy "public read site_settings" on site_settings for select using (true);

drop policy if exists "admin full access site_settings" on site_settings;
create policy "admin full access site_settings" on site_settings for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============ STORAGE (imágenes de apariencia del sitio) ============

insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true)
on conflict (id) do nothing;

drop policy if exists "public read site-assets" on storage.objects;
create policy "public read site-assets" on storage.objects for select using (bucket_id = 'site-assets');

drop policy if exists "admin upload site-assets" on storage.objects;
create policy "admin upload site-assets" on storage.objects for insert
  with check (bucket_id = 'site-assets' and auth.role() = 'authenticated');

drop policy if exists "admin update site-assets" on storage.objects;
create policy "admin update site-assets" on storage.objects for update
  using (bucket_id = 'site-assets' and auth.role() = 'authenticated');

drop policy if exists "admin delete site-assets" on storage.objects;
create policy "admin delete site-assets" on storage.objects for delete
  using (bucket_id = 'site-assets' and auth.role() = 'authenticated');
