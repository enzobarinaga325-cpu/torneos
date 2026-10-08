import { supabase } from "./supabase";
import { localDateStr, todayStr } from "./format";
import { repairMatches } from "./repair-schedule";
import { firstRescheduleDay } from "./visible-days";
import type { ScheduleBlackout } from "./types";

export type CancelResult = { unscheduled: number; error?: string };

export async function listBlackouts(tournamentId: string): Promise<ScheduleBlackout[]> {
  const { data } = await supabase
    .from("schedule_blackouts")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("date")
    .order("hora_inicio", { nullsFirst: true });
  return data ?? [];
}

export async function removeBlackout(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("schedule_blackouts").delete().eq("id", id);
  return error ? { error: error.message } : {};
}

/** Ids de los partidos todavía no jugados que caen justo en el hueco que se está por
 *  cancelar — sea porque el auto-agendado los puso ahí o porque el admin los movió a mano. */
async function findMatchesInSlot(tournamentId: string, date: string, courtId: string | null, hora: string | null): Promise<string[]> {
  const { data: categories } = await supabase.from("categories").select("id").eq("tournament_id", tournamentId);
  const categoryIds = (categories ?? []).map((c) => c.id);
  if (categoryIds.length === 0) return [];

  const { data: matches } = await supabase
    .from("matches")
    .select("id, court_id, scheduled_at")
    .in("category_id", categoryIds)
    .is("winner_id", null)
    .not("scheduled_at", "is", null);

  return (matches ?? [])
    .filter((m) => {
      const scheduledAt = m.scheduled_at as string;
      if (localDateStr(scheduledAt) !== date) return false;
      if (courtId && m.court_id !== courtId) return false;
      if (hora) {
        const dt = new Date(scheduledAt);
        const hhmm = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
        if (hora.slice(0, 5) !== hhmm) return false;
      }
      return true;
    })
    .map((m) => m.id);
}

/** Días (YYYY-MM-DD) en los que hay partidos agendados, SIN contar los que se están por
 *  mover: son los días que van a quedar armados después de la suspensión. */
async function matchDaysExcluding(tournamentId: string, excludeIds: string[]): Promise<string[]> {
  const { data: categories } = await supabase.from("categories").select("id").eq("tournament_id", tournamentId);
  const categoryIds = (categories ?? []).map((c) => c.id);
  if (categoryIds.length === 0) return [];
  const { data: matches } = await supabase
    .from("matches")
    .select("id, scheduled_at")
    .in("category_id", categoryIds)
    .not("scheduled_at", "is", null);
  const excluded = new Set(excludeIds);
  return (matches ?? []).filter((m) => !excluded.has(m.id)).map((m) => localDateStr(m.scheduled_at as string));
}

/** Reacomoda lo suspendido recién DESPUÉS de los próximos 2 días con partidos (los que el
 *  público ve): esos días ya están armados y no se tocan, ni para mover partidos ni para
 *  llenar el hueco. Se cuenta sin los partidos que se están moviendo, así si lo suspendido
 *  era uno de esos 2 días, el que lo reemplaza en la vista también queda protegido. */
async function rescheduleAfterVisibleDays(tournamentId: string, affectedIds: string[]) {
  const days = await matchDaysExcluding(tournamentId, affectedIds);
  return repairMatches(tournamentId, affectedIds, { notBefore: firstRescheduleDay(days, todayStr()) });
}

/** Cancela un día entero (o, si se pasa `courtId`, solo esa cancha ese día): ningún partido
 *  se vuelve a agendar ahí de ahora en más. Los partidos que tenía agendados se reacomodan
 *  ellos solos, pero recién después de los próximos 2 días con partidos — el resto del fixture
 *  no se toca. */
export async function cancelDay(tournamentId: string, date: string, courtId: string | null = null): Promise<CancelResult> {
  const { error } = await supabase.from("schedule_blackouts").insert({ tournament_id: tournamentId, date, court_id: courtId, hora_inicio: null });
  if (error) return { unscheduled: 0, error: error.message };
  const affectedIds = await findMatchesInSlot(tournamentId, date, courtId, null);
  const { unscheduled } = await rescheduleAfterVisibleDays(tournamentId, affectedIds);
  return { unscheduled };
}

/** Cancela un turno puntual (cancha + horario exacto de un partido) — el resto del día sigue
 *  jugándose normalmente, y el partido que estaba ahí se reacomoda solo (después de los próximos
 *  2 días con partidos) sin tocar nada más. */
export async function cancelTurn(
  tournamentId: string,
  match: { court_id: string | null; scheduled_at: string | null },
): Promise<CancelResult> {
  if (!match.court_id || !match.scheduled_at) return { unscheduled: 0 };
  const date = localDateStr(match.scheduled_at);
  const dt = new Date(match.scheduled_at);
  const hora = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}:00`;
  const { error } = await supabase.from("schedule_blackouts").insert({ tournament_id: tournamentId, date, court_id: match.court_id, hora_inicio: hora });
  if (error) return { unscheduled: 0, error: error.message };
  const affectedIds = await findMatchesInSlot(tournamentId, date, match.court_id, hora);
  const { unscheduled } = await rescheduleAfterVisibleDays(tournamentId, affectedIds);
  return { unscheduled };
}
