-- Agrega la modalidad "liga" (todos contra todos, con horarios semanales fijos) al lado de
-- "torneo" (zonas + fixture eliminatorio, como ya funciona hoy). No toca ni borra nada de lo
-- que ya existe para torneos. Pegar y ejecutar en el SQL Editor de Supabase.

-- 1) Modalidad del torneo. "torneo" por defecto para no tocar los que ya existen.
alter table tournaments add column if not exists modalidad text not null default 'torneo' check (modalidad in ('torneo', 'liga'));

-- 2) Ida y vuelta: si una liga juega el todos-contra-todos dos veces (local/visitante).
alter table tournaments add column if not exists ida_vuelta boolean not null default false;

-- 3) Los partidos de liga son su propio "stage", separado de zona/fixture, para no mezclar
--    la lógica de zonas+cuadro eliminatorio con la de liga en ningún lado del código.
alter table matches drop constraint if exists matches_stage_check;
alter table matches add constraint matches_stage_check check (stage in ('zona', 'fixture', 'liga'));

-- 4) Horarios semanales fijos de una liga (ej. "lunes 19 a 00hs", "martes 20:30 a 00:30hs").
--    hora_fin <= hora_inicio significa que la franja cruza la medianoche (termina al día
--    siguiente) — se interpreta así en el código, no hace falta nada especial acá.
create table if not exists horarios_liga (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  dia_semana int not null check (dia_semana between 0 and 6), -- 0 = domingo .. 6 = sábado
  hora_inicio time not null,
  hora_fin time not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_horarios_liga_tournament on horarios_liga (tournament_id);

-- ============ ROW LEVEL SECURITY ============
-- Mismas políticas que el resto de las tablas de torneos: lectura pública solo si el
-- torneo está publicado, acceso total para el organizador logueado.

alter table horarios_liga enable row level security;

drop policy if exists "public read horarios_liga of published tournaments" on horarios_liga;
create policy "public read horarios_liga of published tournaments" on horarios_liga for select
  using (exists (select 1 from tournaments t where t.id = tournament_id and t.published));

drop policy if exists "admin full access horarios_liga" on horarios_liga;
create policy "admin full access horarios_liga" on horarios_liga for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
