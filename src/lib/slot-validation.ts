import type { LeagueSlot, TournamentDay } from "./types";

export interface SlotValidation {
  ok: boolean;
  message?: string;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutos válidos de inicio de partido entre `startHHMM` y `endHHMM`, en pasos de
 *  `durationMinutes` — si la franja cruza la medianoche (fin <= inicio) los valores pueden
 *  superar 1440 (ej. 1470 = 00:30 del día siguiente). */
function slotStarts(startHHMM: string, endHHMM: string, durationMinutes: number): number[] {
  const startMin = timeToMinutes(startHHMM);
  let endMin = timeToMinutes(endHHMM);
  if (endMin <= startMin) endMin += 24 * 60;
  const starts: number[] = [];
  for (let t = startMin; t + durationMinutes <= endMin; t += durationMinutes) starts.push(t);
  return starts;
}

function nearestOptionsMessage(candidateMinutes: number[], targetMinutes: number, suffix: string): SlotValidation {
  if (candidateMinutes.length === 0) return { ok: false, message: `No hay turnos válidos ${suffix}.` };
  const sorted = [...new Set(candidateMinutes)].sort((a, b) => a - b);
  const before = [...sorted].reverse().find((m) => m < targetMinutes);
  const after = sorted.find((m) => m > targetMinutes);
  const options = [before, after].filter((m): m is number => m !== undefined).map(minutesToTime);
  return {
    ok: false,
    message:
      options.length > 0
        ? `Ese horario no coincide con los turnos ${suffix} — probá ${options.join(" o ")}.`
        : `Ese horario no coincide con los turnos ${suffix}.`,
  };
}

/**
 * Valida que `isoDatetime` caiga justo en un turno válido de la cancha `courtId` para una
 * liga, según las franjas semanales cargadas ("Horarios de la liga") y la duración de
 * partido configurada. Si la franja del día anterior cruza la medianoche, sus turnos de
 * madrugada también cuentan como válidos para la fecha elegida.
 */
export function validateLeagueSlotTime(
  isoDatetime: string,
  courtId: string,
  slots: Pick<LeagueSlot, "court_id" | "dia_semana" | "hora_inicio" | "hora_fin">[],
  durationMinutes: number,
): SlotValidation {
  const dt = new Date(isoDatetime);
  const targetMinutes = dt.getHours() * 60 + dt.getMinutes();
  const dow = dt.getDay();
  const prevDow = (dow + 6) % 7;

  const candidates: number[] = [];
  const todaySlot = slots.find((s) => s.court_id === courtId && s.dia_semana === dow);
  if (todaySlot) {
    for (const t of slotStarts(todaySlot.hora_inicio, todaySlot.hora_fin, durationMinutes)) {
      if (t < 24 * 60) candidates.push(t);
    }
  }
  const prevSlot = slots.find((s) => s.court_id === courtId && s.dia_semana === prevDow);
  if (prevSlot) {
    for (const t of slotStarts(prevSlot.hora_inicio, prevSlot.hora_fin, durationMinutes)) {
      if (t >= 24 * 60) candidates.push(t - 24 * 60);
    }
  }

  if (candidates.length === 0) {
    return { ok: false, message: 'Esa cancha no tiene horario de liga cargado ese día — revisá "Horarios de la liga".' };
  }
  if (candidates.includes(targetMinutes)) return { ok: true };
  return nearestOptionsMessage(candidates, targetMinutes, "de esa cancha ese día");
}

/**
 * Igual que `validateLeagueSlotTime`, pero para un torneo (zonas/fixture), donde el horario
 * es uno solo por día para todas las canchas ("Horarios" con fecha de inicio y fin).
 */
export function validateTournamentDaySlotTime(
  isoDatetime: string,
  day: Pick<TournamentDay, "start_time" | "end_time"> | undefined,
  durationMinutes: number,
): SlotValidation {
  if (!day) return { ok: false, message: 'Ese día no tiene horario cargado — revisá "Horarios".' };
  const dt = new Date(isoDatetime);
  const targetMinutes = dt.getHours() * 60 + dt.getMinutes();
  const candidates = slotStarts(day.start_time, day.end_time, durationMinutes).filter((t) => t < 24 * 60);
  if (candidates.includes(targetMinutes)) return { ok: true };
  return nearestOptionsMessage(candidates, targetMinutes, "de ese día");
}
