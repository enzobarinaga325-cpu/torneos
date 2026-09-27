import { supabase } from "./supabase";
import { localDateStr } from "./format";
import { autoScheduleTournament } from "./autoschedule";
import { autoScheduleLeague } from "./league-autoschedule";
import type { ScheduleBlackout } from "./types";

export type CancelResult = { unscheduled: number; error?: string };

/** Corre los dos auto-agendados (torneo y liga) y devuelve un solo resultado combinado —
 *  se usa después de cancelar, para poder avisar si algún partido no encontró dónde
 *  reacomodarse en vez de dejarlo colgado en silencio. */
async function rescheduleAll(tournamentId: string): Promise<CancelResult> {
  const [t, l] = await Promise.all([autoScheduleTournament(tournamentId), autoScheduleLeague(tournamentId)]);
  return {
    unscheduled: (t.unscheduled ?? 0) + (l.unscheduled ?? 0),
    error: t.error || l.error,
  };
}

export async function listBlackouts(tournamentId: string): Promise<ScheduleBlackout[]> {
  const { data } = await supabase
    .from("schedule_blackouts")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("date")
    .order("hora_inicio", { nullsFirst: true });
  return data ?? [];
}

export async function removeBlackout(id: string): Promise<void> {
  await supabase.from("schedule_blackouts").delete().eq("id", id);
}

/** Libera (vuelve a "sin agendar") los partidos todavía no jugados que cayeran en el hueco
 *  que se está por cancelar — sea porque el auto-agendado los puso ahí o porque el admin los
 *  movió a mano — para que el próximo "Autocompletar horarios" los reacomode solo, sin
 *  perderlos. Nunca toca un partido que ya tiene resultado cargado. */
async function freeUpMatches(tournamentId: string, date: string, courtId: string | null, hora: string | null): Promise<void> {
  const { data: categories } = await supabase.from("categories").select("id").eq("tournament_id", tournamentId);
  const categoryIds = (categories ?? []).map((c) => c.id);
  if (categoryIds.length === 0) return;

  const { data: matches } = await supabase
    .from("matches")
    .select("id, court_id, scheduled_at")
    .in("category_id", categoryIds)
    .is("winner_id", null)
    .not("scheduled_at", "is", null);

  const toFree = (matches ?? [])
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

  if (toFree.length > 0) {
    await supabase.from("matches").update({ court_id: null, scheduled_at: null, auto_scheduled: true }).in("id", toFree);
  }
}

/** Cancela un día entero (o, si se pasa `courtId`, solo esa cancha ese día): ningún partido
 *  se vuelve a agendar ahí de ahora en más, y los que ya estaban se reacomodan solos en el
 *  próximo turno libre. */
export async function cancelDay(tournamentId: string, date: string, courtId: string | null = null): Promise<CancelResult> {
  await supabase.from("schedule_blackouts").insert({ tournament_id: tournamentId, date, court_id: courtId, hora_inicio: null });
  await freeUpMatches(tournamentId, date, courtId, null);
  return rescheduleAll(tournamentId);
}

/** Cancela un turno puntual (cancha + horario exacto de un partido) — el resto del día sigue
 *  jugándose normalmente. */
export async function cancelTurn(
  tournamentId: string,
  match: { court_id: string | null; scheduled_at: string | null },
): Promise<CancelResult> {
  if (!match.court_id || !match.scheduled_at) return { unscheduled: 0 };
  const date = localDateStr(match.scheduled_at);
  const dt = new Date(match.scheduled_at);
  const hora = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}:00`;
  await supabase.from("schedule_blackouts").insert({ tournament_id: tournamentId, date, court_id: match.court_id, hora_inicio: hora });
  await freeUpMatches(tournamentId, date, match.court_id, hora);
  return rescheduleAll(tournamentId);
}
