import { supabase } from "./supabase";
import { buildLeagueSchedule, type LeagueMatchInput } from "./league-logic";
import type { AutoScheduleResult } from "./autoschedule";

/**
 * Agenda cancha+horario para los partidos de liga (stage = 'liga') de todo el torneo.
 * Replanifica TODOS los partidos que todavía no se jugaron y que nadie movió a mano
 * (`auto_scheduled = true`) — no solo los recién creados — para poder repartir bien las
 * categorías (y, dentro de cada una, sus zonas si tiene) cada vez que se genera o regenera
 * el fixture de una de ellas; nunca toca un partido ya jugado ni uno que el admin movió a
 * mano (eso queda con `auto_scheduled = false`). Requiere que haya al menos una franja
 * horaria semanal cargada ("horarios_liga") y una fecha de inicio en el torneo.
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

  const categoryIds = categories.map((c) => c.id);
  const { data: zones } = await supabase.from("zones").select("id, category_id").in("category_id", categoryIds).order("position");

  // Un "grupo" es una categoría entera (si no tiene zonas) o una zona puntual dentro de una
  // categoría (si tiene). Cada grupo es su propia cola de jornadas más abajo — así una liga
  // con zonas también las va intercalando entre sí, no solo entre categorías.
  const groupKeys: string[] = [];
  for (const cat of categories) {
    const catZones = (zones ?? []).filter((z) => z.category_id === cat.id);
    if (catZones.length === 0) groupKeys.push(`${cat.id}|`);
    else for (const z of catZones) groupKeys.push(`${cat.id}|${z.id}`);
  }

  const [{ data: replanPool }, { data: locked }] = await Promise.all([
    // Todo lo que no se jugó y nadie movió a mano — se vuelve a repartir de cero cada vez,
    // tenga o no ya un horario puesto por una corrida anterior del auto-agendado.
    supabase
      .from("matches")
      .select("id, category_id, zone_id, round_order, position, team1_id, team2_id, scheduled_at")
      .in("category_id", categoryIds)
      .eq("stage", "liga")
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

  // Una cola por grupo, cada una en orden de jornada — buildLeagueSchedule va rotando entre
  // grupos al llenar horarios, para que todos vayan jugando a lo largo de la semana en vez
  // de agendar uno entero antes de tocar el siguiente.
  const pending = replanPool
    .filter((m): m is typeof m & { team1_id: string; team2_id: string } => !!m.team1_id && !!m.team2_id)
    .sort((a, b) => (a.round_order ?? 0) - (b.round_order ?? 0) || a.position - b.position);

  const queuesByGroup = new Map<string, LeagueMatchInput[]>();
  for (const m of pending) {
    const key = `${m.category_id}|${m.zone_id ?? ""}`;
    const queue = queuesByGroup.get(key) ?? [];
    queue.push({ id: m.id, team1_id: m.team1_id, team2_id: m.team2_id });
    queuesByGroup.set(key, queue);
  }
  const groupQueues = groupKeys
    .map((key) => queuesByGroup.get(key))
    .filter((q): q is LeagueMatchInput[] => !!q);

  const { assignments, unscheduledCount } = buildLeagueSchedule(
    groupQueues,
    slots,
    Math.max(15, tournament.default_match_minutes ?? 60),
    tournament.start_date,
    (locked ?? []).filter((m): m is typeof m & { court_id: string; scheduled_at: string } => !!m.court_id && !!m.scheduled_at),
  );

  for (const a of assignments) {
    await supabase.from("matches").update({ court_id: a.courtId, scheduled_at: a.scheduledAt }).eq("id", a.matchId);
  }

  return { scheduled: assignments.length, unscheduled: unscheduledCount };
}
