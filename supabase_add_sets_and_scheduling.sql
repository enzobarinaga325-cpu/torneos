-- 1) Horario por defecto del torneo, para poder autocompletar los horarios de los
--    partidos en cadena (hora de inicio + minutos por partido + cantidad de canchas).
-- 2) Resultado por sets: antes se guardaba "sets ganados" como un número directo; ahora
--    se cargan los games de cada set (2 sets, con un 3° opcional si van 1 a 1).
-- Pegar y ejecutar en el SQL Editor de Supabase.

alter table tournaments add column if not exists default_start_time time not null default '12:00';
alter table tournaments add column if not exists default_match_minutes int not null default 60;

alter table matches drop column if exists team1_sets;
alter table matches drop column if exists team2_sets;
alter table matches add column if not exists set1_team1 int;
alter table matches add column if not exists set1_team2 int;
alter table matches add column if not exists set2_team1 int;
alter table matches add column if not exists set2_team2 int;
alter table matches add column if not exists set3_team1 int;
alter table matches add column if not exists set3_team2 int;
