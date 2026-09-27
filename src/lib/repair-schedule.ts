import { supabase } from "./supabase";
import { buildDayTimeSlots, isBlackedOut, isTeamAvailable, slotKey } from "./tournament-logic";
import { projectLeagueSlots } from "./league-logic";

export interface RepairResult {
  repaired: number;
  unscheduled: number;
}

/**
 * Reacomoda SOLO los partidos puntuales que se pasan en `matchIds` — buscándoles el próximo
 * turno libre y válido cada uno — sin tocar el resto del fixture. A diferencia de
 * `autoScheduleTournament`/`autoScheduleLeague` (que rearman TODO desde cero cada vez, para
 * repartir bien las categorías), esto es para cuando cambia algo puntual (la disponibilidad
 * de un equipo, un turno cancelado) y no querés que se reordenen partidos que no tenían nada
 * que ver. Un partido que no encuentra ningún hueco válido queda sin agendar (se cuenta en
 * `unscheduled`) en vez de forzarlo en cualquier lado.
 */
export async function repairMatches(tournamentId: string, matchIds: string[]): Promise<RepairResult> {
  if (matchIds.length === 0) return { repaired: 0, unscheduled: 0 };

  const [{ data: tournament }, { data: courts }, { data: days }, { data: leagueSlots }, { data: blackouts }, { data: categories }] =
    await Promise.all([
      supabase.from("tournaments").select("default_match_minutes, start_date").eq("id", tournamentId).maybeSingle(),
      supabase.from("courts").select("id").eq("tournament_id", tournamentId).order("name"),
      supabase.from("tournament_days").select("date, start_time, end_time").eq("tournament_id", tournamentId).order("date"),
      supabase.from("horarios_liga").select("court_id, dia_semana, hora_inicio, hora_fin").eq("tournament_id", tournamentId),
      supabase.from("schedule_blackouts").select("date, court_id, hora_inicio").eq("tournament_id", tournamentId),
      supabase.from("categories").select("id").eq("tournament_id", tournamentId),
    ]);

  const categoryIds = (categories ?? []).map((c) => c.id);
  const courtIds = (courts ?? []).map((c) => c.id);
  if (categoryIds.length === 0 || courtIds.length === 0) return { repaired: 0, unscheduled: matchIds.length };

  const duration = Math.max(15, tournament?.default_match_minutes ?? 60);

  const { data: availability } = await supabase
    .from("team_availability")
    .select("team_id, dia_semana, hora_inicio, hora_fin, teams!inner(category_id)")
    .in("teams.category_id", categoryIds);

  const { data: allScheduled } = await supabase
    .from("matches")
    .select("id, stage, court_id, scheduled_at, team1_id, team2_id, winner_id")
    .in("category_id", categoryIds)
    .not("scheduled_at", "is", null);

  const toRepairIds = new Set(matchIds);
  const others = (allScheduled ?? []).filter((m) => !toRepairIds.has(m.id));
  // Un partido que ya se jugó no se toca nunca, aunque lo hayan pasado en la lista.
  const toRepair = (allScheduled ?? []).filter((m) => toRepairIds.has(m.id) && m.winner_id == null);
  if (toRepair.length === 0) return { repaired: 0, unscheduled: 0 };

  const occupied = new Set(others.map((m) => slotKey(m.court_id as string, m.scheduled_at as string)));
  // Qué equipos ya juegan a cada horario exacto (para no ponerlos dos veces al mismo tiempo
  // en canchas distintas).
  const busyAt = new Map<string, Set<string>>();
  for (const m of others) {
    const iso = m.scheduled_at as string;
    const set = busyAt.get(iso) ?? new Set<string>();
    if (m.team1_id) set.add(m.team1_id);
    if (m.team2_id) set.add(m.team2_id);
    busyAt.set(iso, set);
  }
  // Para partidos de torneo (zona/fixture): último horario jugado por equipo, para respetar
  // el descanso mínimo entre partidos.
  const lastPlayed = new Map<string, number>();
  for (const m of others) {
    const ts = new Date(m.scheduled_at as string).getTime();
    if (m.team1_id) lastPlayed.set(m.team1_id, Math.max(lastPlayed.get(m.team1_id) ?? -Infinity, ts));
    if (m.team2_id) lastPlayed.set(m.team2_id, Math.max(lastPlayed.get(m.team2_id) ?? -Infinity, ts));
  }
  const minGapMs = duration * 60000 * 2;

  // Candidatos de torneo: cada horario de los días cargados, cruzado con cada cancha.
  const tournamentSlots = buildDayTimeSlots((days ?? []) as { date: string; start_time: string; end_time: string }[], duration);
  const tournamentCandidates: { courtId: string; iso: string }[] = [];
  for (const iso of tournamentSlots) for (const courtId of courtIds) tournamentCandidates.push({ courtId, iso });

  // Candidatos de liga: se proyectan bastantes semanas — como acá solo hay que ubicar un
  // puñado de partidos puntuales (no todo el fixture), alcanza con una ventana generosa fija
  // en vez de calcularla en base a cuánto falta agendar.
  const leagueCandidates =
    leagueSlots && leagueSlots.length > 0 && tournament?.start_date
      ? projectLeagueSlots(leagueSlots, tournament.start_date, 16, duration).map((o) => ({ courtId: o.courtId, iso: o.date.toISOString() }))
      : [];

  let repaired = 0;
  let unscheduled = 0;

  for (const match of toRepair) {
    const candidates = match.stage === "liga" ? leagueCandidates : tournamentCandidates;
    let placed = false;

    for (const { courtId, iso } of candidates) {
      const key = slotKey(courtId, iso);
      if (occupied.has(key)) continue;
      if (isBlackedOut(blackouts ?? [], courtId, iso)) continue;

      const busy = busyAt.get(iso);
      if (busy && ((match.team1_id && busy.has(match.team1_id)) || (match.team2_id && busy.has(match.team2_id)))) continue;

      if (availability && availability.length > 0) {
        if (match.team1_id && !isTeamAvailable(availability, match.team1_id, iso, duration)) continue;
        if (match.team2_id && !isTeamAvailable(availability, match.team2_id, iso, duration)) continue;
      }

      if (match.stage !== "liga") {
        const ts = new Date(iso).getTime();
        if (match.team1_id && ts - (lastPlayed.get(match.team1_id) ?? -Infinity) < minGapMs) continue;
        if (match.team2_id && ts - (lastPlayed.get(match.team2_id) ?? -Infinity) < minGapMs) continue;
      }

      await supabase.from("matches").update({ court_id: courtId, scheduled_at: iso, auto_scheduled: true }).eq("id", match.id);

      occupied.add(key);
      const busySet = busyAt.get(iso) ?? new Set<string>();
      if (match.team1_id) busySet.add(match.team1_id);
      if (match.team2_id) busySet.add(match.team2_id);
      busyAt.set(iso, busySet);
      const ts = new Date(iso).getTime();
      if (match.team1_id) lastPlayed.set(match.team1_id, Math.max(lastPlayed.get(match.team1_id) ?? -Infinity, ts));
      if (match.team2_id) lastPlayed.set(match.team2_id, Math.max(lastPlayed.get(match.team2_id) ?? -Infinity, ts));

      repaired++;
      placed = true;
      break;
    }

    if (!placed) {
      await supabase.from("matches").update({ court_id: null, scheduled_at: null, auto_scheduled: true }).eq("id", match.id);
      unscheduled++;
    }
  }

  return { repaired, unscheduled };
}
