import { supabase } from "./supabase";
import { buildLeagueSchedule, type LeagueMatchInput } from "./league-logic";
import type { AutoScheduleResult } from "./autoschedule";

/**
 * Agenda cancha+horario para los partidos de liga (stage = 'liga') de todo el torneo que
 * ya tienen las dos parejas definidas pero todavía no tienen horario. Nunca toca un
 * partido que el admin ya movió a mano. Requiere que haya al menos una franja horaria
 * semanal cargada ("horarios_liga") y una fecha de inicio en el torneo.
 */
export async function autoScheduleLeague(tournamentId: string): Promise<AutoScheduleResult> {
  const [{ data: tournament }, { data: courts }, { data: slots }, { data: categories }] = await Promise.all([
    supabase.from("tournaments").select("default_match_minutes, start_date").eq("id", tournamentId).maybeSingle(),
    supabase.from("courts").select("id").eq("tournament_id", tournamentId).order("name"),
    supabase.from("horarios_liga").select("court_id, dia_semana, hora_inicio, hora_fin").eq("tournament_id", tournamentId),
    supabase.from("categories").select("id").eq("tournament_id", tournamentId).order("created_at"),
  ]);

  if (!courts || courts.length === 0) return { scheduled: 0, unscheduled: 0, error: "Cargá al menos una cancha primero." };
  if (!slots || slots.length === 0) return { scheduled: 0, unscheduled: 0, error: "Cargá al menos un horario semanal de la liga primero." };
  if (!tournament?.start_date) return { scheduled: 0, unscheduled: 0, error: "Cargale una fecha de inicio al torneo primero." };
  if (!categories || categories.length === 0) return { scheduled: 0, unscheduled: 0 };

  const categoryOrder = new Map(categories.map((c, i) => [c.id, i]));
  const categoryIds = categories.map((c) => c.id);

  const [{ data: matches }, { data: scheduled }] = await Promise.all([
    supabase
      .from("matches")
      .select("id, category_id, round_order, position, team1_id, team2_id")
      .in("category_id", categoryIds)
      .eq("stage", "liga")
      .is("scheduled_at", null)
      .not("team1_id", "is", null)
      .not("team2_id", "is", null),
    supabase
      .from("matches")
      .select("court_id, scheduled_at, team1_id, team2_id")
      .in("category_id", categoryIds)
      .not("scheduled_at", "is", null),
  ]);

  if (!matches || matches.length === 0) return { scheduled: 0, unscheduled: 0 };

  // Agrupa por categoría y jornada (round_order), en orden, tal como los agrupó
  // roundRobinJourneys al generar el fixture — así cada jornada se agenda como bloque.
  const pending = matches
    .filter((m): m is typeof m & { team1_id: string; team2_id: string } => !!m.team1_id && !!m.team2_id)
    .sort((a, b) => {
      const catDiff = (categoryOrder.get(a.category_id) ?? 0) - (categoryOrder.get(b.category_id) ?? 0);
      if (catDiff !== 0) return catDiff;
      return (a.round_order ?? 0) - (b.round_order ?? 0) || a.position - b.position;
    });

  const journeys: LeagueMatchInput[][] = [];
  let lastKey: string | null = null;
  for (const m of pending) {
    const key = `${m.category_id}|${m.round_order ?? 0}`;
    if (key !== lastKey) {
      journeys.push([]);
      lastKey = key;
    }
    journeys[journeys.length - 1].push({ id: m.id, team1_id: m.team1_id, team2_id: m.team2_id });
  }

  const { assignments, unscheduledCount } = buildLeagueSchedule(
    journeys,
    slots,
    Math.max(15, tournament.default_match_minutes ?? 60),
    tournament.start_date,
    (scheduled ?? []).filter((m): m is typeof m & { court_id: string; scheduled_at: string } => !!m.court_id && !!m.scheduled_at),
  );

  for (const a of assignments) {
    await supabase.from("matches").update({ court_id: a.courtId, scheduled_at: a.scheduledAt }).eq("id", a.matchId);
  }

  return { scheduled: assignments.length, unscheduled: unscheduledCount };
}
