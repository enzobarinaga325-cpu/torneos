-- Torneos de pádel: schema completo. Pegar y ejecutar en el SQL Editor de Supabase.

create extension if not exists pgcrypto;

-- ============ TABLAS ============

create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  start_date date,
  end_date date,
  default_start_time time not null default '12:00',
  default_match_minutes int not null default 60,
  status text not null default 'armando' check (status in ('armando', 'en_curso', 'finalizado')),
  published boolean not null default false,
  modalidad text not null default 'torneo' check (modalidad in ('torneo', 'liga')),
  logo_url text,
  ida_vuelta boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists courts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists zones (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  zone_id uuid references zones(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  stage text not null check (stage in ('zona', 'fixture', 'liga')),
  zone_id uuid references zones(id) on delete cascade,
  round_name text,
  round_order int,
  position int not null default 0,
  team1_id uuid references teams(id) on delete set null,
  team2_id uuid references teams(id) on delete set null,
  court_id uuid references courts(id) on delete set null,
  scheduled_at timestamptz,
  auto_scheduled boolean not null default true, -- false = el admin lo movió a mano
  team1_sets int,
  team2_sets int,
  winner_id uuid references teams(id) on delete set null,
  next_match_id uuid references matches(id) on delete set null,
  next_match_slot int check (next_match_slot in (1, 2)),
  created_at timestamptz not null default now()
);

-- Horarios semanales fijos de una liga (modalidad = 'liga'), UNA fila por cancha por día
-- (cada cancha puede tener su propia franja horaria el mismo día). hora_fin <= hora_inicio
-- significa que la franja cruza la medianoche (termina al día siguiente).
create table if not exists horarios_liga (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  court_id uuid not null references courts(id) on delete cascade,
  dia_semana int not null check (dia_semana between 0 and 6), -- 0 = domingo .. 6 = sábado
  hora_inicio time not null,
  hora_fin time not null,
  created_at timestamptz not null default now(),
  unique (tournament_id, dia_semana, court_id)
);

create index if not exists idx_courts_tournament on courts (tournament_id);
create index if not exists idx_categories_tournament on categories (tournament_id);
create index if not exists idx_zones_category on zones (category_id);
create index if not exists idx_teams_category on teams (category_id);
create index if not exists idx_teams_zone on teams (zone_id);
create index if not exists idx_matches_category on matches (category_id);
create index if not exists idx_matches_zone on matches (zone_id);
create index if not exists idx_horarios_liga_tournament on horarios_liga (tournament_id);
create index if not exists idx_horarios_liga_court on horarios_liga (court_id);

-- ============ ROW LEVEL SECURITY ============
-- Lectura pública solo de torneos publicados (para que puedas armar todo en privado
-- antes de mostrarlo). Cualquier usuario logueado (el organizador) tiene acceso total:
-- esta app es de un solo organizador, sin roles.

alter table tournaments enable row level security;
alter table courts enable row level security;
alter table categories enable row level security;
alter table zones enable row level security;
alter table teams enable row level security;
alter table matches enable row level security;

drop policy if exists "public read published tournaments" on tournaments;
create policy "public read published tournaments" on tournaments for select using (published = true);
drop policy if exists "admin full access tournaments" on tournaments;
create policy "admin full access tournaments" on tournaments for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "public read courts of published tournaments" on courts;
create policy "public read courts of published tournaments" on courts for select
  using (exists (select 1 from tournaments t where t.id = tournament_id and t.published));
drop policy if exists "admin full access courts" on courts;
create policy "admin full access courts" on courts for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "public read categories of published tournaments" on categories;
create policy "public read categories of published tournaments" on categories for select
  using (exists (select 1 from tournaments t where t.id = tournament_id and t.published));
drop policy if exists "admin full access categories" on categories;
create policy "admin full access categories" on categories for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "public read zones of published tournaments" on zones;
create policy "public read zones of published tournaments" on zones for select
  using (exists (
    select 1 from categories c join tournaments t on t.id = c.tournament_id
    where c.id = category_id and t.published
  ));
drop policy if exists "admin full access zones" on zones;
create policy "admin full access zones" on zones for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "public read teams of published tournaments" on teams;
create policy "public read teams of published tournaments" on teams for select
  using (exists (
    select 1 from categories c join tournaments t on t.id = c.tournament_id
    where c.id = category_id and t.published
  ));
drop policy if exists "admin full access teams" on teams;
create policy "admin full access teams" on teams for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "public read matches of published tournaments" on matches;
create policy "public read matches of published tournaments" on matches for select
  using (exists (
    select 1 from categories c join tournaments t on t.id = c.tournament_id
    where c.id = category_id and t.published
  ));
drop policy if exists "admin full access matches" on matches;
create policy "admin full access matches" on matches for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table horarios_liga enable row level security;

drop policy if exists "public read horarios_liga of published tournaments" on horarios_liga;
create policy "public read horarios_liga of published tournaments" on horarios_liga for select
  using (exists (select 1 from tournaments t where t.id = tournament_id and t.published));
drop policy if exists "admin full access horarios_liga" on horarios_liga;
create policy "admin full access horarios_liga" on horarios_liga for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
