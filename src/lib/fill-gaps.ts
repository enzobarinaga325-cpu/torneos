import { supabase } from "./supabase";
import { isBlackedOut, isTeamAvailable, isTeamAvailableOnDate, slotKey } from "./tournament-logic";
import { localDayKey, projectLeagueSlots } from "./league-logic";

export interface FillGapsResult {
  filled: number;
  remainingGaps: number;
}

type LigaMatch = {
  id: string;
  court_id: string | null;
  scheduled_at: string | null;
  team1_id: string | null;
  team2_id: string | null;
  winner_id: string | null;
  auto_scheduled: boolean;
};

/**
 * Rellena los huecos que hayan quedado en la grilla de la liga (turnos habilitados, dentro
 * del rango que ya tiene partidos, que quedaron sin nadie) SIN reordenar el resto del
 * fixture. Para cada hueco, de más temprano a más tarde, busca el partido agendado MÁS
 * TARDE de todos (el último del fixture) que pueda jugarse ahí sin problema, y lo trae —
 * así el fixture se acorta desde el final en vez de reacomodarse entero. Un partido ya
 * jugado o movido a mano (`auto_scheduled: false`) nunca se toca ni se usa para rellenar.
 * Si ningún partido puede ocupar un hueco (por disponibilidad, día ya jugado, etc.), ese
 * hueco queda como está — se cuenta en `remainingGaps` en vez de forzar algo.
 */
export async function fillScheduleGaps(tournamentId: string): Promise<FillGapsResult> {
  const [{ data: tournament }, { data: leagueSlots }, { data: blackouts }, { data: categories }] = await Promise.all([
    supabase.from("tournaments").select("default_match_minutes, start_date").eq("id", tournamentId).maybeSingle(),
    supabase.from("horarios_liga").select("court_id, dia_semana, hora_inicio, hora_fin").eq("tournament_id", tournamentId),
    supabase.from("schedule_blackouts").select("date, court_id, hora_inicio").eq("tournament_id", tournamentId),
    supabase.from("categories").select("id").eq("tournament_id", tournamentId),
  ]);

  const categoryIds = (categories ?? []).map((c) => c.id);
  if (categoryIds.length === 0 || !leagueSlots || leagueSlots.length === 0 || !tournament?.start_date) {
    return { filled: 0, remainingGaps: 0 };
  }

  const duration = Math.max(15, tournament.default_match_minutes ?? 60);

  const { data: availability } = await supabase
    .from("team_availability")
    .select("team_id, dia_semana, hora_inicio, hora_fin, teams!inner(category_id)")
    .in("teams.category_id", categoryIds);

  const { data: unavailability } = await supabase
    .from("team_unavailability")
    .select("team_id, start_date, end_date, teams!inner(category_id)")
    .in("teams.category_id", categoryIds);

  const { data: allMatches } = await supabase
    .from("matches")
    .select("id, court_id, scheduled_at, team1_id, team2_id, winner_id, auto_scheduled")
    .in("category_id", categoryIds)
    .eq("stage", "liga")
    .not("scheduled_at", "is", null);

  const committed: LigaMatch[] = (allMatches ?? []).map((m) => ({
    ...m,
    scheduled_at: m.scheduled_at ? new Date(m.scheduled_at as string).toISOString() : null,
  }));
  if (committed.length === 0) return { filled: 0, remainingGaps: 0 };

  const bySlot = new Map<string, LigaMatch>();
  for (const m of committed) bySlot.set(slotKey(m.court_id as string, m.scheduled_at as string), m);

  const busyAt = new Map<string, Set<string>>();
  const busyDay = new Map<string, Set<string>>();
  for (const m of committed) {
    const iso = m.scheduled_at as string;
    const set = busyAt.get(iso) ?? new Set<string>();
    if (m.team1_id) set.add(m.team1_id);
    if (m.team2_id) set.add(m.team2_id);
    busyAt.set(iso, set);
    const day = localDayKey(iso);
    if (m.team1_id) (busyDay.get(m.team1_id) ?? busyDay.set(m.team1_id, new Set()).get(m.team1_id)!).add(day);
    if (m.team2_id) (busyDay.get(m.team2_id) ?? busyDay.set(m.team2_id, new Set()).get(m.team2_id)!).add(day);
  }

  function fitsAvailability(teamId: string | null, iso: string): boolean {
    if (!teamId) return true;
    if (unavailability && unavailability.length > 0 && !isTeamAvailableOnDate(unavailability, teamId, iso)) return false;
    if (!availability || availability.length === 0) return true;
    return isTeamAvailable(availability, teamId, iso, duration);
  }

  // ¿Puede `teamId` pasar a `iso`, ignorando su propio compromiso actual (`excludeIso` — el
  // turno que va a dejar libre si se lo mueve)?
  function teamFits(teamId: string | null, iso: string, excludeIso: string | null): boolean {
    if (!teamId) return true;
    if (busyAt.get(iso)?.has(teamId)) return false;
    const day = localDayKey(iso);
    const excludeDay = excludeIso ? localDayKey(excludeIso) : null;
    if (day !== excludeDay && busyDay.get(teamId)?.has(day)) return false;
    return true;
  }

  function unmark(m: LigaMatch) {
    const iso = m.scheduled_at as string;
    bySlot.delete(slotKey(m.court_id as string, iso));
    busyAt.get(iso)?.delete(m.team1_id ?? "");
    busyAt.get(iso)?.delete(m.team2_id ?? "");
    const day = localDayKey(iso);
    if (m.team1_id) busyDay.get(m.team1_id)?.delete(day);
    if (m.team2_id) busyDay.get(m.team2_id)?.delete(day);
  }

  function mark(m: LigaMatch, courtId: string, iso: string) {
    m.court_id = courtId;
    m.scheduled_at = iso;
    bySlot.set(slotKey(courtId, iso), m);
    const set = busyAt.get(iso) ?? new Set<string>();
    if (m.team1_id) set.add(m.team1_id);
    if (m.team2_id) set.add(m.team2_id);
    busyAt.set(iso, set);
    const day = localDayKey(iso);
    if (m.team1_id) (busyDay.get(m.team1_id) ?? busyDay.set(m.team1_id, new Set()).get(m.team1_id)!).add(day);
    if (m.team2_id) (busyDay.get(m.team2_id) ?? busyDay.set(m.team2_id, new Set()).get(m.team2_id)!).add(day);
  }

  const horizon = Math.max(...committed.map((m) => new Date(m.scheduled_at as string).getTime()));

  // Proyecta bastantes semanas para cubrir el horizonte actual del fixture.
  const weeksAhead = Math.max(4, Math.ceil((horizon - new Date(tournament.start_date).getTime()) / (7 * 24 * 3600 * 1000)) + 2);
  const candidates = projectLeagueSlots(leagueSlots, tournament.start_date, weeksAhead, duration)
    .map((o) => ({ courtId: o.courtId, iso: o.date.toISOString() }))
    .filter((c) => new Date(c.iso).getTime() <= horizon);

  const gaps = candidates.filter((c) => !isBlackedOut(blackouts ?? [], c.courtId, c.iso) && !bySlot.has(slotKey(c.courtId, c.iso)));

  // Candidatos donantes: partidos movibles, del último al primero (para achicar la cola en
  // vez de reordenar el medio del fixture).
  const donorsPool = committed
    .filter((m) => m.auto_scheduled !== false && m.winner_id == null)
    .sort((a, b) => new Date(b.scheduled_at as string).getTime() - new Date(a.scheduled_at as string).getTime());

  let filled = 0;
  let remainingGaps = 0;

  for (const gap of gaps) {
    if (isBlackedOut(blackouts ?? [], gap.courtId, gap.iso) || bySlot.has(slotKey(gap.courtId, gap.iso))) continue; // ya se llenó como efecto de un movimiento anterior

    let donor: LigaMatch | null = null;
    for (const candidate of donorsPool) {
      const donorIso = candidate.scheduled_at as string;
      if (new Date(donorIso).getTime() <= new Date(gap.iso).getTime()) break; // no tiene sentido traer algo de más temprano o del mismo turno
      if (!fitsAvailability(candidate.team1_id, gap.iso) || !fitsAvailability(candidate.team2_id, gap.iso)) continue;
      if (!teamFits(candidate.team1_id, gap.iso, donorIso) || !teamFits(candidate.team2_id, gap.iso, donorIso)) continue;
      donor = candidate;
      break;
    }

    if (!donor) {
      remainingGaps++;
      continue;
    }

    donorsPool.splice(donorsPool.indexOf(donor), 1);
    unmark(donor);
    await supabase.from("matches").update({ court_id: gap.courtId, scheduled_at: gap.iso }).eq("id", donor.id);
    mark(donor, gap.courtId, gap.iso);
    filled++;
  }

  return { filled, remainingGaps };
}
