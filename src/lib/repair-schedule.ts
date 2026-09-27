import { supabase } from "./supabase";
import { buildDayTimeSlots, isBlackedOut, isTeamAvailable, slotKey } from "./tournament-logic";
import { localDayKey, projectLeagueSlots } from "./league-logic";

export interface RepairResult {
  repaired: number;
  unscheduled: number;
}

type RepairMatch = {
  id: string;
  stage: string;
  court_id: string | null;
  scheduled_at: string | null;
  team1_id: string | null;
  team2_id: string | null;
  winner_id: string | null;
  auto_scheduled: boolean;
};

/**
 * Reacomoda SOLO los partidos puntuales que se pasan en `matchIds` — buscándoles el próximo
 * turno válido cada uno — sin tocar el resto del fixture. A diferencia de
 * `autoScheduleTournament`/`autoScheduleLeague` (que rearman TODO desde cero cada vez, para
 * repartir bien las categorías), esto es para cuando cambia algo puntual (la disponibilidad
 * de un equipo, un turno cancelado) y no querés que se reordenen partidos que no tenían nada
 * que ver.
 *
 * Para no dejar nunca un hueco vacío donde estaba el partido reacomodado, primero busca un
 * turno ocupado por OTRO partido con el que se pueda INTERCAMBIAR lugares (ese otro partido
 * pasa a ocupar el lugar que el nuestro dejó libre, validando que a él tampoco le rompa nada
 * — disponibilidad, día bloqueado, cruce de equipos, descanso mínimo). Solo si no encuentra
 * ningún compañero de intercambio válido, cae al comportamiento anterior de buscar un turno
 * libre. Un partido manualmente movido por el admin (`auto_scheduled: false`) o ya jugado
 * nunca se toca, ni siquiera como parte de un intercambio. Si ni intercambio ni turno libre
 * aparecen, el partido queda sin agendar (se cuenta en `unscheduled`) en vez de forzarlo.
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
    .select("id, stage, court_id, scheduled_at, team1_id, team2_id, winner_id, auto_scheduled")
    .in("category_id", categoryIds)
    .not("scheduled_at", "is", null);

  // Normaliza el formato del timestamp apenas se lee de la base ("...+00:00") a uno
  // canónico ("....000Z") — el mismo que generan los candidatos nuevos con
  // `.toISOString()` — para que comparar por igualdad de string (busyAt, busyDay) funcione
  // bien de entrada. `slotKey` ya normaliza por su cuenta, pero acá conviene hacerlo una
  // sola vez arriba de todo en vez de en cada lugar que arma una clave.
  const normalized: RepairMatch[] = (allScheduled ?? []).map((m) => ({
    ...m,
    scheduled_at: m.scheduled_at ? new Date(m.scheduled_at as string).toISOString() : null,
  }));

  const toRepairIds = new Set(matchIds);
  const committed = normalized.filter((m) => !toRepairIds.has(m.id));
  // Un partido que ya se jugó no se toca nunca, aunque lo hayan pasado en la lista.
  const toRepair = normalized.filter((m) => toRepairIds.has(m.id) && m.winner_id == null);
  if (toRepair.length === 0) return { repaired: 0, unscheduled: 0 };

  const bySlot = new Map<string, RepairMatch>();
  for (const m of committed) bySlot.set(slotKey(m.court_id as string, m.scheduled_at as string), m);

  // Qué equipos ya juegan a cada horario exacto (para no ponerlos dos veces al mismo tiempo
  // en canchas distintas).
  const busyAt = new Map<string, Set<string>>();
  for (const m of committed) {
    const iso = m.scheduled_at as string;
    const set = busyAt.get(iso) ?? new Set<string>();
    if (m.team1_id) set.add(m.team1_id);
    if (m.team2_id) set.add(m.team2_id);
    busyAt.set(iso, set);
  }
  // Para partidos de liga: qué días ya tiene ocupados cada equipo — no juega dos veces el
  // mismo día calendario a menos que el admin lo haya movido a mano.
  const busyDay = new Map<string, Set<string>>();
  for (const m of committed) {
    if (m.stage !== "liga") continue;
    const day = localDayKey(m.scheduled_at as string);
    if (m.team1_id) (busyDay.get(m.team1_id) ?? busyDay.set(m.team1_id, new Set()).get(m.team1_id)!).add(day);
    if (m.team2_id) (busyDay.get(m.team2_id) ?? busyDay.set(m.team2_id, new Set()).get(m.team2_id)!).add(day);
  }
  // Para partidos de torneo (zona/fixture): todos los horarios ya jugados por equipo, para
  // respetar el descanso mínimo entre partidos — guardado como arreglo (no el último nomás)
  // porque un intercambio puede mover un partido para atrás en el tiempo, no solo para
  // adelante, y ahí sí importa qué tenía el equipo agendado DESPUÉS también.
  const teamTimestamps = new Map<string, number[]>();
  for (const m of committed) {
    const ts = new Date(m.scheduled_at as string).getTime();
    if (m.team1_id) (teamTimestamps.get(m.team1_id) ?? teamTimestamps.set(m.team1_id, []).get(m.team1_id)!).push(ts);
    if (m.team2_id) (teamTimestamps.get(m.team2_id) ?? teamTimestamps.set(m.team2_id, []).get(m.team2_id)!).push(ts);
  }
  const minGapMs = duration * 60000 * 2;

  function minGapOk(teamId: string, targetTs: number, excludeTs: number | null): boolean {
    const arr = teamTimestamps.get(teamId);
    if (!arr) return true;
    for (const t of arr) {
      if (t === excludeTs) continue;
      if (Math.abs(t - targetTs) < minGapMs) return false;
    }
    return true;
  }

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

  /** ¿Puede `teamId` jugar en `iso` sin cruzarse con otro partido, sin superar un partido
   *  por día (liga) y sin violar el descanso mínimo (torneo)? `excludeTs`: el horario propio
   *  que este equipo está dejando (para no chocar contra sí mismo). `excludeDay`: el día que
   *  este equipo está dejando libre — si coincide con el día de `iso` (típico en un
   *  intercambio dentro de la misma semana), no cuenta como que "ya tiene partido ese día",
   *  porque ESE partido es justamente el que se está moviendo. */
  function teamFits(teamId: string | null, stage: string, iso: string, excludeTs: number | null, excludeDay: string | null = null): boolean {
    if (!teamId) return true;
    if (busyAt.get(iso)?.has(teamId)) return false;
    if (stage === "liga") {
      const day = localDayKey(iso);
      if (day !== excludeDay && busyDay.get(teamId)?.has(day)) return false;
    } else if (!minGapOk(teamId, new Date(iso).getTime(), excludeTs)) {
      return false;
    }
    return true;
  }

  function fitsAvailability(teamId: string | null, iso: string): boolean {
    if (!teamId || !availability || availability.length === 0) return true;
    return isTeamAvailable(availability, teamId, iso, duration);
  }

  function markSlot(m: RepairMatch, courtId: string, iso: string) {
    m.court_id = courtId;
    m.scheduled_at = iso;
    bySlot.set(slotKey(courtId, iso), m);
    const set = busyAt.get(iso) ?? new Set<string>();
    if (m.team1_id) set.add(m.team1_id);
    if (m.team2_id) set.add(m.team2_id);
    busyAt.set(iso, set);
    if (m.stage === "liga") {
      const day = localDayKey(iso);
      if (m.team1_id) (busyDay.get(m.team1_id) ?? busyDay.set(m.team1_id, new Set()).get(m.team1_id)!).add(day);
      if (m.team2_id) (busyDay.get(m.team2_id) ?? busyDay.set(m.team2_id, new Set()).get(m.team2_id)!).add(day);
    }
    const ts = new Date(iso).getTime();
    if (m.team1_id) (teamTimestamps.get(m.team1_id) ?? teamTimestamps.set(m.team1_id, []).get(m.team1_id)!).push(ts);
    if (m.team2_id) (teamTimestamps.get(m.team2_id) ?? teamTimestamps.set(m.team2_id, []).get(m.team2_id)!).push(ts);
    committed.push(m);
  }

  /** Saca el rastro de `m` de sus turnos viejos (`oldCourtId`/`oldIso`) antes de reubicarlo a
   *  un nuevo lugar — para que el turno viejo quede libre de verdad para quien lo herede. */
  function unmarkSlot(m: RepairMatch, oldCourtId: string, oldIso: string) {
    bySlot.delete(slotKey(oldCourtId, oldIso));
    const set = busyAt.get(oldIso);
    if (set) {
      if (m.team1_id) set.delete(m.team1_id);
      if (m.team2_id) set.delete(m.team2_id);
    }
    if (m.stage === "liga") {
      const day = localDayKey(oldIso);
      if (m.team1_id) busyDay.get(m.team1_id)?.delete(day);
      if (m.team2_id) busyDay.get(m.team2_id)?.delete(day);
    }
    const ts = new Date(oldIso).getTime();
    for (const teamId of [m.team1_id, m.team2_id]) {
      if (!teamId) continue;
      const arr = teamTimestamps.get(teamId);
      if (!arr) continue;
      const idx = arr.indexOf(ts);
      if (idx !== -1) arr.splice(idx, 1);
    }
  }

  let repaired = 0;
  let unscheduled = 0;

  for (const match of toRepair) {
    const candidates = match.stage === "liga" ? leagueCandidates : tournamentCandidates;
    const originalCourtId = match.court_id;
    const originalIso = match.scheduled_at;
    const ownOldTs = originalIso ? new Date(originalIso).getTime() : null;
    const ownOldDay = originalIso ? localDayKey(originalIso) : null;

    let freeTarget: { courtId: string; iso: string } | null = null;
    let swapTarget: { courtId: string; iso: string; occupant: RepairMatch } | null = null;

    for (const { courtId, iso } of candidates) {
      if (isBlackedOut(blackouts ?? [], courtId, iso)) continue;
      if (!fitsAvailability(match.team1_id, iso) || !fitsAvailability(match.team2_id, iso)) continue;

      const occupant = bySlot.get(slotKey(courtId, iso));

      if (!occupant) {
        if (!teamFits(match.team1_id, match.stage, iso, ownOldTs, ownOldDay) || !teamFits(match.team2_id, match.stage, iso, ownOldTs, ownOldDay)) continue;
        if (!freeTarget) freeTarget = { courtId, iso };
        continue; // sigue buscando un intercambio antes de conformarse con un hueco libre
      }

      if (swapTarget) continue; // ya encontramos un intercambio válido, no hace falta seguir
      if (occupant.auto_scheduled === false) continue; // el admin lo movió a mano, no se toca
      if (occupant.winner_id != null) continue; // ya se jugó
      if (!originalCourtId || !originalIso) continue; // no tiene un lugar viejo para ofrecerle

      if (!teamFits(match.team1_id, match.stage, iso, ownOldTs, ownOldDay) || !teamFits(match.team2_id, match.stage, iso, ownOldTs, ownOldDay)) continue;

      // ¿El que ocupa este lugar puede pasar al que nuestro partido está por dejar libre?
      if (isBlackedOut(blackouts ?? [], originalCourtId, originalIso)) continue;
      if (!fitsAvailability(occupant.team1_id, originalIso) || !fitsAvailability(occupant.team2_id, originalIso)) continue;
      const occupantOldTs = new Date(iso).getTime();
      const occupantOldDay = localDayKey(iso);
      if (!teamFits(occupant.team1_id, occupant.stage, originalIso, occupantOldTs, occupantOldDay) || !teamFits(occupant.team2_id, occupant.stage, originalIso, occupantOldTs, occupantOldDay)) continue;

      swapTarget = { courtId, iso, occupant };
    }

    if (swapTarget) {
      const { courtId, iso, occupant } = swapTarget;
      unmarkSlot(occupant, courtId, iso);
      await Promise.all([
        supabase.from("matches").update({ court_id: courtId, scheduled_at: iso, auto_scheduled: true }).eq("id", match.id),
        supabase.from("matches").update({ court_id: originalCourtId, scheduled_at: originalIso, auto_scheduled: true }).eq("id", occupant.id),
      ]);
      markSlot(match, courtId, iso);
      markSlot(occupant, originalCourtId as string, originalIso as string);
      repaired++;
    } else if (freeTarget) {
      await supabase.from("matches").update({ court_id: freeTarget.courtId, scheduled_at: freeTarget.iso, auto_scheduled: true }).eq("id", match.id);
      markSlot(match, freeTarget.courtId, freeTarget.iso);
      repaired++;
    } else {
      await supabase.from("matches").update({ court_id: null, scheduled_at: null, auto_scheduled: true }).eq("id", match.id);
      unscheduled++;
    }
  }

  return { repaired, unscheduled };
}
