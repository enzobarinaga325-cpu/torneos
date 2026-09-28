-- Un equipo puntual no puede jugar entre dos fechas (viaje, lesión, etc.) — a diferencia de
-- team_availability (una franja semanal que se repite), esto es un rango de fechas concreto
-- que se borra solo si el admin lo quita. Mientras esté cargado, ningún partido de ese
-- equipo se agenda (ni a mano por el auto-agendado, ni por una reparación puntual) dentro de
-- esas fechas.
create table if not exists team_unavailability (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now()
);

alter table team_unavailability enable row level security;

create policy "team_unavailability_public_read" on team_unavailability
  for select using (
    exists (
      select 1 from teams
      join categories on categories.id = teams.category_id
      join tournaments on tournaments.id = categories.tournament_id
      where teams.id = team_unavailability.team_id and tournaments.published = true
    )
  );

create policy "team_unavailability_auth_all" on team_unavailability
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
