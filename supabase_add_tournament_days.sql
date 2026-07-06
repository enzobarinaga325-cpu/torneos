-- Hora de inicio y de cierre por cada día del torneo (antes había un solo horario para
-- todo el torneo). El autocompletado de horarios ahora agenda dentro de la ventana de
-- cada día y salta al día siguiente cuando se llena.
-- Pegar y ejecutar en el SQL Editor de Supabase.

create table if not exists tournament_days (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  date date not null,
  start_time time not null default '09:00',
  end_time time not null default '22:00',
  unique (tournament_id, date)
);

create index if not exists idx_tournament_days_tournament on tournament_days (tournament_id);

alter table tournament_days enable row level security;

drop policy if exists "public read tournament_days of published tournaments" on tournament_days;
create policy "public read tournament_days of published tournaments" on tournament_days for select
  using (exists (select 1 from tournaments t where t.id = tournament_id and t.published));

drop policy if exists "admin full access tournament_days" on tournament_days;
create policy "admin full access tournament_days" on tournament_days for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
