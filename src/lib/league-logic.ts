import type { LeagueSlot } from "./types";
import { slotKey, type ExistingSchedule, type ScheduleAssignment } from "./tournament-logic";

type CourtSlot = Pick<LeagueSlot, "court_id" | "dia_semana" | "hora_inicio" | "hora_fin">;

export const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/**
 * Arma el fixture de una liga (todos contra todos) agrupado en jornadas por el método del
 * círculo: en cada jornada, cada equipo juega como máximo una vez. Si la cantidad de
 * equipos es impar, se agrega un "descanso" virtual — al que le toca contra él, esa jornada
 * libra. Con `idaYVuelta`, se repite el calendario completo con los locales invertidos,
 * como jornadas aparte a continuación de las de ida.
 */
export function roundRobinJourneys(teamIds: string[], idaYVuelta: boolean): [string, string][][] {
  if (teamIds.length < 2) return [];
  const BYE = "__bye__";
  const arr = teamIds.length % 2 === 0 ? [...teamIds] : [...teamIds, BYE];
  const n = arr.length;
  const ida: [string, string][][] = [];

  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== BYE && b !== BYE) pairs.push([a, b]);
    }
    ida.push(pairs);
    // Rota todos los equipos menos el primero (que queda fijo).
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop()!);
    arr.splice(0, arr.length, fixed, ...rest);
  }

  if (!idaYVuelta) return ida;
  const vuelta = ida.map((pairs) => pairs.map(([a, b]) => [b, a] as [string, string]));
  return [...ida, ...vuelta];
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * Convierte las franjas semanales fijas de cada cancha en ocurrencias concretas (cancha +
 * fecha y hora), proyectando `weeksAhead` semanas a partir de `startDate`. Si una franja
 * cruza la medianoche (hora_fin <= hora_inicio), se extiende hasta esa hora del día
 * siguiente — el partido sigue perteneciendo al mismo día de la semana configurado (ej. un
 * horario de las 00:15 de una franja "lunes 19 a 00hs" es, en los hechos, del lunes a la
 * noche).
 */
function projectLeagueSlots(
  slots: CourtSlot[],
  startDate: string,
  weeksAhead: number,
  durationMinutes: number,
): { courtId: string; date: Date }[] {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const base = new Date(sy, sm - 1, sd);
  const occurrences: { courtId: string; date: Date }[] = [];

  for (let w = 0; w < weeksAhead; w++) {
    for (const slot of slots) {
      const daysFromBase = (slot.dia_semana - base.getDay() + 7) % 7;
      const dayDate = new Date(base);
      dayDate.setDate(base.getDate() + daysFromBase + w * 7);

      const startMin = timeToMinutes(slot.hora_inicio);
      let endMin = timeToMinutes(slot.hora_fin);
      if (endMin <= startMin) endMin += 24 * 60; // cruza medianoche

      for (let t = startMin; t + durationMinutes <= endMin; t += durationMinutes) {
        const dt = new Date(dayDate);
        dt.setHours(0, 0, 0, 0);
        dt.setMinutes(t);
        occurrences.push({ courtId: slot.court_id, date: dt });
      }
    }
  }

  occurrences.sort((a, b) => a.date.getTime() - b.date.getTime());
  return occurrences;
}

export type LeagueMatchInput = { id: string; team1_id: string; team2_id: string };

/**
 * Reparte los partidos de liga (ya agrupados por jornada, en orden) entre las franjas
 * semanales habilitadas de cada cancha (cada cancha puede tener su propio horario). Reglas
 * duras: dentro de un mismo horario exacto (aunque sea en canchas distintas) ningún equipo
 * juega dos veces, así que nunca quedan dos partidos superpuestos de la misma pareja ni más
 * de uno por noche. Los partidos de una jornada ya nunca repiten equipo entre sí, así que
 * tienden a entrar todos en la semana que les corresponde; si no entran todos, los que
 * sobran pasan a la semana siguiente sin romper la regla de "un partido por horario por
 * equipo".
 */
export function buildLeagueSchedule(
  journeys: LeagueMatchInput[][],
  slots: CourtSlot[],
  durationMinutes: number,
  startDate: string,
  alreadyScheduled: ExistingSchedule[] = [],
): { assignments: ScheduleAssignment[]; unscheduledCount: number } {
  const allMatches = journeys.flat();
  if (allMatches.length === 0 || slots.length === 0) {
    return { assignments: [], unscheduledCount: allMatches.length };
  }

  const capacityPerWeek = slots.reduce((sum, s) => {
    const startMin = timeToMinutes(s.hora_inicio);
    let endMin = timeToMinutes(s.hora_fin);
    if (endMin <= startMin) endMin += 24 * 60;
    return sum + Math.floor((endMin - startMin) / durationMinutes);
  }, 0);
  // +4 semanas de colchón por si algún partido no entra justo en la semana que le toca.
  const weeksAhead = capacityPerWeek > 0 ? Math.ceil(allMatches.length / capacityPerWeek) + 4 : 0;
  const occurrences = weeksAhead > 0 ? projectLeagueSlots(slots, startDate, weeksAhead, durationMinutes) : [];

  const occupiedCourtSlots = new Set(alreadyScheduled.map((m) => slotKey(m.court_id, m.scheduled_at)));
  const remaining = [...allMatches];
  const assignments: ScheduleAssignment[] = [];

  let i = 0;
  while (i < occurrences.length && remaining.length > 0) {
    // Agrupa todas las ocurrencias (de cualquier cancha) que caen exactamente en el mismo
    // horario, para no dejar que un mismo equipo quede anotado dos veces a la misma hora
    // en canchas distintas.
    const sameTime = occurrences[i].date.getTime();
    const busyThisSlot = new Set<string>();
    while (i < occurrences.length && occurrences[i].date.getTime() === sameTime) {
      const { courtId, date } = occurrences[i];
      i++;
      const iso = date.toISOString();
      if (occupiedCourtSlots.has(slotKey(courtId, iso))) continue;
      const idx = remaining.findIndex((m) => !busyThisSlot.has(m.team1_id) && !busyThisSlot.has(m.team2_id));
      if (idx === -1) continue;
      const match = remaining.splice(idx, 1)[0];
      assignments.push({ matchId: match.id, courtId, scheduledAt: iso });
      busyThisSlot.add(match.team1_id);
      busyThisSlot.add(match.team2_id);
    }
  }

  return { assignments, unscheduledCount: remaining.length };
}
