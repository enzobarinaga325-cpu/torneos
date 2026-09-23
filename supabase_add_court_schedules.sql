-- Los horarios de liga pasan a configurarse por cancha, no por día compartido entre todas.
-- Ej: "los lunes, Cancha 1 juega 19 a 22 y Cancha 2 juega 20 a 23". No toca ni borra nada de
-- lo que ya existe para torneos. Pegar y ejecutar en el SQL Editor de Supabase.

-- 1) Nueva columna, todavía nullable para poder migrar los datos existentes antes de exigirla.
alter table horarios_liga add column if not exists court_id uuid references courts(id) on delete cascade;

-- 2) Las filas viejas (sin cancha) aplicaban a TODAS las canchas del torneo por igual —
--    se expanden a una fila por cancha para conservar exactamente el mismo comportamiento
--    que tenían hasta ahora. Si el torneo no tiene ninguna cancha cargada todavía, la fila
--    vieja no tiene a qué cancha migrarse y se descarta (no había nada que agendar de todos
--    modos sin canchas).
insert into horarios_liga (tournament_id, dia_semana, hora_inicio, hora_fin, court_id)
select h.tournament_id, h.dia_semana, h.hora_inicio, h.hora_fin, c.id
from horarios_liga h
join courts c on c.tournament_id = h.tournament_id
where h.court_id is null;

delete from horarios_liga where court_id is null;

-- 3) De acá en más, toda fila de horarios_liga es de una cancha puntual.
alter table horarios_liga alter column court_id set not null;
alter table horarios_liga add constraint horarios_liga_tournament_dia_cancha_key unique (tournament_id, dia_semana, court_id);

create index if not exists idx_horarios_liga_court on horarios_liga (court_id);
