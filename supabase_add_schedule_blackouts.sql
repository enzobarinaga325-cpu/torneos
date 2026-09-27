-- Permite cancelar un día entero (todas las canchas), un día de UNA cancha puntual, o un
-- turno puntual (cancha + hora) — por lluvia u otro motivo — sin perder los partidos que
-- tenían agendados ahí: el auto-agendado (torneo y liga) evita esos turnos de ahora en más,
-- y los partidos que quedaban ahí vuelven al pool y se reacomodan solos en el próximo turno
-- libre la próxima vez que se corra "Autocompletar horarios". Pegar y ejecutar en el SQL
-- Editor de Supabase.

create table if not exists schedule_blackouts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  date date not null,
  court_id uuid references courts(id) on delete cascade, -- null = todas las canchas ese día
  hora_inicio time, -- null = todo el día; si tiene valor, es un turno puntual
  created_at timestamptz not null default now()
);

create index if not exists idx_schedule_blackouts_tournament on schedule_blackouts (tournament_id);

-- ============ ROW LEVEL SECURITY ============
-- Mismas políticas que el resto de las tablas de torneos: lectura pública solo si el
-- torneo está publicado, acceso total para el organizador logueado.

alter table schedule_blackouts enable row level security;

drop policy if exists "public read schedule_blackouts of published tournaments" on schedule_blackouts;
create policy "public read schedule_blackouts of published tournaments" on schedule_blackouts for select
  using (exists (select 1 from tournaments t where t.id = tournament_id and t.published));

drop policy if exists "admin full access schedule_blackouts" on schedule_blackouts;
create policy "admin full access schedule_blackouts" on schedule_blackouts for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
