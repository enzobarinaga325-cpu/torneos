-- Le permite a un equipo puntual (ej: una pareja que solo puede jugar 1 o 2 días a la
-- semana, a tal hora) restringir cuándo se lo puede agendar. Un equipo SIN ninguna fila acá
-- se sigue agendando como hasta ahora, sin ninguna restricción — esto es solo para los pocos
-- equipos que la necesiten. El auto-agendado (torneo y liga) respeta esto además de sus
-- reglas de siempre, y el resto de los partidos se sigue rellenando alrededor normalmente.
-- Pegar y ejecutar en el SQL Editor de Supabase.

create table if not exists team_availability (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  dia_semana int not null check (dia_semana between 0 and 6), -- 0 = domingo .. 6 = sábado
  hora_inicio time not null,
  hora_fin time not null, -- <= hora_inicio significa que cruza la medianoche
  created_at timestamptz not null default now()
);

create index if not exists idx_team_availability_team on team_availability (team_id);

-- ============ ROW LEVEL SECURITY ============
-- Mismas políticas que el resto de las tablas de torneos: lectura pública solo si el
-- torneo está publicado, acceso total para el organizador logueado.

alter table team_availability enable row level security;

drop policy if exists "public read team_availability of published tournaments" on team_availability;
create policy "public read team_availability of published tournaments" on team_availability for select
  using (
    exists (
      select 1 from teams tm
      join categories c on c.id = tm.category_id
      join tournaments t on t.id = c.tournament_id
      where tm.id = team_id and t.published
    )
  );

drop policy if exists "admin full access team_availability" on team_availability;
create policy "admin full access team_availability" on team_availability for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
