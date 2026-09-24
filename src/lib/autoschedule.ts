import { supabase } from "./supabase";
import { buildSchedule, type SchedulableMatch } from "./tournament-logic";

export type AutoScheduleResult = { scheduled: number; unscheduled: number; error?: string };

/**
 * Agenda cancha+horario para los partidos del torneo (zona + fixture) que ya tienen las
 * dos parejas definidas. Replanifica TODOS los que todavía no se jugaron y que nadie movió
 * a mano (`auto_scheduled = true`) — no solo los recién habilitados — para que las
 * categorías se repartan bien las canchas libres y todas vayan terminando sus zonas por
 * las mismas fechas, en vez de que una categoría acapare las primeras canchas libres antes
 * de que la siguiente tenga partidos para agendar. Nunca toca un partido ya jugado ni uno
 * que el admin movió a mano (eso queda con `auto_scheduled = false`). Es seguro llamarla
 * después de cualquier evento que deje partidos nuevos "listos" (generar zona, generar
 * fixture, o cargar un resultado que hace avanzar a la próxima ronda).
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

  const [{ data: replanPool }, { data: locked }] = await Promise.all([
    // Todo lo que no se jugó y nadie movió a mano — se vuelve a repartir de cero cada vez,
    // tenga o no ya un horario puesto por una corrida anterior del auto-agendado.
    supabase
      .from("matches")
      .select("id, category_id, stage, zone:zones(position), round_order, position, team1_id, team2_id, scheduled_at")
      .in("category_id", categoryIds)
      .neq("stage", "liga") // los partidos de liga se agendan aparte, por franjas semanales
      .eq("auto_scheduled", true)
      .is("winner_id", null)
      .not("team1_id", "is", null)
      .not("team2_id", "is", null),
    // Lo ya jugado o movido a mano: se respeta tal cual, solo sirve para no pisarlo.
    supabase
      .from("matches")
      .select("court_id, scheduled_at, team1_id, team2_id")
      .in("category_id", categoryIds)
      .not("scheduled_at", "is", null)
      .or("auto_scheduled.eq.false,winner_id.not.is.null"),
  ]);

  if (!replanPool || replanPool.length === 0) return { scheduled: 0, unscheduled: 0 };

  const toReset = replanPool.filter((m) => m.scheduled_at).map((m) => m.id);
  if (toReset.length > 0) {
    await supabase.from("matches").update({ court_id: null, scheduled_at: null }).in("id", toReset);
  }

  const pending = replanPool.sort((a, b) => {
    if (a.stage !== b.stage) return a.stage === "zona" ? -1 : 1;
    const zoneDiff = (a.zone?.[0]?.position ?? 0) - (b.zone?.[0]?.position ?? 0);
    if (zoneDiff !== 0) return zoneDiff;
    return (a.round_order ?? 0) - (b.round_order ?? 0) || a.position - b.position;
  });

  const queuesByCategory = new Map<string, SchedulableMatch[]>();
  for (const m of pending) {
    const q = queuesByCategory.get(m.category_id) ?? [];
    q.push({ id: m.id, team1_id: m.team1_id, team2_id: m.team2_id });
    queuesByCategory.set(m.category_id, q);
  }
  const categoryQueues = [...categoryOrder.keys()]
    .map((catId) => queuesByCategory.get(catId))
    .filter((q): q is SchedulableMatch[] => !!q);

  const { assignments, unscheduledCount } = buildSchedule(
    categoryQueues,
    courts.map((c) => c.id),
    [...days].sort((a, b) => a.date.localeCompare(b.date)),
    Math.max(15, tournament?.default_match_minutes ?? 60),
    (locked ?? []).filter((m): m is typeof m & { court_id: string; scheduled_at: string } => !!m.court_id && !!m.scheduled_at),
  );

  for (const a of assignments) {
    await supabase.from("matches").update({ court_id: a.courtId, scheduled_at: a.scheduledAt }).eq("id", a.matchId);
  }

  return { scheduled: assignments.length, unscheduled: unscheduledCount };
}
