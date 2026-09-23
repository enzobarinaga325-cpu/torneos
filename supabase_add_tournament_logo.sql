-- Logo opcional de un torneo/liga (se muestra en el cartel semanal para Instagram y, a
-- futuro, en cualquier otra vista para compartir). No toca ni borra nada existente.
alter table tournaments add column if not exists logo_url text;
