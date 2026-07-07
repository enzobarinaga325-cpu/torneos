import { supabase } from "./supabase";
import { buildSchedule } from "./tournament-logic";

export type AutoScheduleResult = { scheduled: number; unscheduled: number; error?: string };

/**
 * Agenda cancha+horario para todos los partidos del torneo que ya tienen las dos parejas
 * definidas pero todavía no tienen horario asignado. Es seguro llamarla después de
 * cualquier evento que deje partidos nuevos "listos" (generar zona, generar fixture, o
 * cargar un resultado que hace avanzar a la próxima ronda): nunca toca un partido que ya
 * tiene horario, así que no reordena nada de lo que el admin ya ajustó a mano.
 */
export async function autoScheduleTournament(tournamentId: string): Promise<AutoScheduleResult> {
  const [{ data: tournament }, { data: courts }, { data: days }, { data: categories }] = await Promise.all([
    supabase.from("tournaments").select("default_match_minutes").eq("id", tournamentId).maybeSingle(),
    supabase.from("courts").select("id").eq("tournament_id", tournamentId).order("name"),
    supabase.from("tournament_days").select("date, start_time, end_time").eq("tournament_id", tournamentId).order("date"),
    supabase.from("categories").select("id").eq("tournament_id", tournamentId).order("created_at"),
  ]);

  if (!courts || courts.length === 0) return { scheduled: 0, unscheduled: 0, error: "Cargá al menos una cancha primero." };
  if (!days || days.length === 0) return { scheduled: 0, unscheduled: 0, error: 'Cargá los días del torneo primero ("Sincronizar días").' };
  if (!categories || categories.length === 0) return { scheduled: 0, unscheduled: 0 };

  const categoryOrder = new Map(categories.map((c, i) => [c.id, i]));
  const categoryIds = categories.map((c) => c.id);

  const [{ data: matches }, { data: scheduled }] = await Promise.all([
    supabase
      .from("matches")
      .select("*, zone:zones(position)")
      .in("category_id", categoryIds)
      .is("scheduled_at", null)
      .not("team1_id", "is", null)
      .not("team2_id", "is", null),
    supabase
      .from("matches")
      .select("court_id, scheduled_at, team1_id, team2_id")
      .in("category_id", categoryIds)
      .not("scheduled_at", "is", null),
  ]);

  const pending = (matches ?? []).sort((a, b) => {
    const catDiff = (categoryOrder.get(a.category_id) ?? 0) - (categoryOrder.get(b.category_id) ?? 0);
    if (catDiff !== 0) return catDiff;
    if (a.stage !== b.stage) return a.stage === "zona" ? -1 : 1;
    const zoneDiff = (a.zone?.position ?? 0) - (b.zone?.position ?? 0);
    if (zoneDiff !== 0) return zoneDiff;
    return (a.round_order ?? 0) - (b.round_order ?? 0) || a.position - b.position;
  });

  if (pending.length === 0) return { scheduled: 0, unscheduled: 0 };

  const { assignments, unscheduledCount } = buildSchedule(
    pending.map((m) => ({ id: m.id, team1_id: m.team1_id, team2_id: m.team2_id })),
    courts.map((c) => c.id),
    [...days].sort((a, b) => a.date.localeCompare(b.date)),
    Math.max(15, tournament?.default_match_minutes ?? 60),
    (scheduled ?? []).filter((m): m is typeof m & { court_id: string; scheduled_at: string } => !!m.court_id && !!m.scheduled_at),
  );

  for (const a of assignments) {
    await supabase.from("matches").update({ court_id: a.courtId, scheduled_at: a.scheduledAt }).eq("id", a.matchId);
  }

  return { scheduled: assignments.length, unscheduled: unscheduledCount };
}
