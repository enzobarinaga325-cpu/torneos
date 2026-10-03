import type { Match, Team, TeamAvailability, TeamUnavailability } from "./types";
import { localDateStr } from "./format";
import { isTeamAvailable, isTeamAvailableOnDate } from "./tournament-logic";

export type SwapOption = { matchId: string; opponentName: string; scheduledAt: string };

type Availability = Pick<TeamAvailability, "team_id" | "dia_semana" | "hora_inicio" | "hora_fin">[];
type Unavailability = Pick<TeamUnavailability, "team_id" | "start_date" | "end_date">[];

/** true si el equipo ya tiene (aparte de los partidos `ignoreIds`) otro partido ese día calendario. */
function hasOtherMatchOnDay(teamId: string, day: string, matches: Match[], ignoreIds: string[]): boolean {
  return matches.some(
    (m) =>
      !ignoreIds.includes(m.id) &&
      m.scheduled_at != null &&
      (m.team1_id === teamId || m.team2_id === teamId) &&
      localDateStr(m.scheduled_at) === day,
  );
}

export type SwapMatchOption = { matchId: string; match: Match; scheduledAt: string };

/**
 * Partidos con los que se puede intercambiar de lugar `match` COMPLETO (las dos parejas se
 * mudan al horario del otro partido y viceversa). Solo cuentan partidos todavía no jugados y
 * ya agendados, y para que el cambio se ofrezca las parejas de AMBOS partidos tienen que:
 *  - poder jugar en el horario nuevo (disponibilidad semanal),
 *  - no tener cargada esa fecha como no disponible,
 *  - y no terminar con dos partidos el mismo día.
 * En un cuadro eliminatorio solo se cambia con partidos de la misma ronda y categoría, para
 * no desordenar el cruce; en zonas y liga se puede con cualquier categoría. Una pareja que
 * juega los dos partidos ya está en los dos horarios, así que no se la vuelve a chequear.
 */
export function swapMatchOptions(
  match: Match,
  matches: Match[],
  duration: number,
  availability: Availability,
  unavailability: Unavailability,
): SwapMatchOption[] {
  if (match.winner_id != null || !match.scheduled_at || !match.court_id) return [];
  const mine = [match.team1_id, match.team2_id].filter((t): t is string => !!t);
  const options: SwapMatchOption[] = [];

  for (const m of matches) {
    if (
      m.id === match.id ||
      m.winner_id != null ||
      m.scheduled_at == null ||
      m.court_id == null ||
      m.stage !== match.stage ||
      (match.stage === "fixture" && (m.category_id !== match.category_id || m.round_order !== match.round_order))
    ) continue;

    const theirs = [m.team1_id, m.team2_id].filter((t): t is string => !!t);
    const movers = [
      ...mine.filter((t) => !theirs.includes(t)).map((teamId) => ({ teamId, newIso: m.scheduled_at as string })),
      ...theirs.filter((t) => !mine.includes(t)).map((teamId) => ({ teamId, newIso: match.scheduled_at as string })),
    ];
    const ok = movers.every(({ teamId, newIso }) =>
      isTeamAvailable(availability, teamId, newIso, duration) &&
      isTeamAvailableOnDate(unavailability, teamId, newIso) &&
      !hasOtherMatchOnDay(teamId, localDateStr(newIso), matches, [match.id, m.id]),
    );
    if (!ok) continue;

    options.push({ matchId: m.id, match: m, scheduledAt: m.scheduled_at });
  }

  return options.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

/**
 * Para un partido puntual y uno de sus dos equipos (`fixedTeamId`, el que se mantiene fijo),
 * busca los demás partidos todavía no jugados de ESE equipo dentro del mismo grupo
 * (categoría + zona + stage) -- cada uno es candidato a "intercambiar lugar": el rival de
 * ese otro partido pasa a jugar en el horario de este, y viceversa.
 *
 * Solo se ofrece un intercambio si las dos parejas que cambian de horario quedan bien:
 *  - pueden jugar en el horario nuevo (disponibilidad semanal cargada),
 *  - no tienen cargada una fecha en la que no pueden (viajes, etc.),
 *  - y NO terminan con dos partidos el mismo día (cuenta cualquier otro partido ya agendado
 *    de esa pareja, esté jugado o no).
 * El equipo fijo juega exactamente los mismos dos horarios que antes, así que no hace falta
 * volver a chequearlo.
 */
export function swapOptions(
  match: Match,
  fixedTeamId: string | null,
  matches: Match[],
  teamsById: Record<string, Team>,
  duration: number,
  availability: Availability,
  unavailability: Unavailability,
): SwapOption[] {
  if (!fixedTeamId || !match.scheduled_at) return [];
  const movingTeamId = match.team1_id === fixedTeamId ? match.team2_id : match.team1_id;
  const options: SwapOption[] = [];

  for (const m of matches) {
    if (
      m.id === match.id ||
      m.winner_id != null ||
      m.scheduled_at == null ||
      m.court_id == null ||
      m.category_id !== match.category_id ||
      m.zone_id !== match.zone_id ||
      m.stage !== match.stage ||
      (m.team1_id !== fixedTeamId && m.team2_id !== fixedTeamId)
    ) continue;

    const opponentId = m.team1_id === fixedTeamId ? m.team2_id : m.team1_id;
    const opponentName = opponentId ? teamsById[opponentId]?.name : null;
    if (!opponentName) continue;

    // Quien sale de este partido pasa al horario de `m`; quien sale de `m` pasa al de este.
    const movers: { teamId: string; newIso: string; leavingMatchId: string }[] = [];
    if (movingTeamId) movers.push({ teamId: movingTeamId, newIso: m.scheduled_at, leavingMatchId: match.id });
    if (opponentId) movers.push({ teamId: opponentId, newIso: match.scheduled_at, leavingMatchId: m.id });

    const ok = movers.every(({ teamId, newIso, leavingMatchId }) =>
      isTeamAvailable(availability, teamId, newIso, duration) &&
      isTeamAvailableOnDate(unavailability, teamId, newIso) &&
      !hasOtherMatchOnDay(teamId, localDateStr(newIso), matches, [leavingMatchId]),
    );
    if (!ok) continue;

    options.push({ matchId: m.id, opponentName, scheduledAt: m.scheduled_at });
  }

  return options.sort((a, b) => a.opponentName.localeCompare(b.opponentName));
}
