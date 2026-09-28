import { supabase } from "./supabase";
import { slotKey } from "./tournament-logic";
import { localDayKey, projectLeagueSlots } from "./league-logic";

export type FixtureIssueType = "unscheduled" | "outside_window" | "collision" | "same_day" | "double_booked";

export interface FixtureIssue {
  type: FixtureIssueType;
  matchIds: string[];
  detail: string;
}

export interface FixtureHealthReport {
  totalMatches: number;
  ok: boolean;
  issues: FixtureIssue[];
}

/**
 * Revisa el fixture de liga de todo el torneo en busca de los mismos problemas que se
 * terminaban encontrando a mano con consultas puntuales: partidos sin agendar, partidos en un
 * horario que ya no está configurado (por ejemplo si se achicó una franja después), dos
 * partidos en el mismo turno exacto, una pareja jugando dos veces el mismo día calendario, o
 * una pareja jugando a la misma hora en dos canchas distintas. Es de solo lectura — nunca
 * mueve ni cambia nada, solo informa.
 */
export async function checkFixtureHealth(tournamentId: string): Promise<FixtureHealthReport> {
  const [{ data: tournament }, { data: leagueSlots }, { data: categories }] = await Promise.all([
    supabase.from("tournaments").select("start_date, default_match_minutes").eq("id", tournamentId).maybeSingle(),
    supabase.from("horarios_liga").select("court_id, dia_semana, hora_inicio, hora_fin").eq("tournament_id", tournamentId),
    supabase.from("categories").select("id, name").eq("tournament_id", tournamentId),
  ]);

  const categoryIds = (categories ?? []).map((c) => c.id);
  if (categoryIds.length === 0) return { totalMatches: 0, ok: true, issues: [] };

  const { data: teams } = await supabase.from("teams").select("id, name").in("category_id", categoryIds);
  const teamName = Object.fromEntries((teams ?? []).map((t) => [t.id, t.name]));

  const { data: matches } = await supabase
    .from("matches")
    .select("id, category_id, court_id, scheduled_at, team1_id, team2_id, winner_id")
    .in("category_id", categoryIds)
    .eq("stage", "liga");

  const all = matches ?? [];
  const scheduled = all.filter((m) => m.scheduled_at);
  const unscheduled = all.filter((m) => !m.scheduled_at && m.team1_id && m.team2_id);

  const issues: FixtureIssue[] = [];

  if (unscheduled.length > 0) {
    issues.push({
      type: "unscheduled",
      matchIds: unscheduled.map((m) => m.id),
      detail: `${unscheduled.length} partido${unscheduled.length === 1 ? "" : "s"} sin agendar.`,
    });
  }

  const duration = Math.max(15, tournament?.default_match_minutes ?? 60);

  if (leagueSlots && leagueSlots.length > 0 && tournament?.start_date) {
    const occ = projectLeagueSlots(leagueSlots, tournament.start_date, 30, duration);
    const validSet = new Set(occ.map((o) => `${o.courtId}|${o.date.toISOString()}`));
    const outside = scheduled.filter((m) => !validSet.has(`${m.court_id}|${new Date(m.scheduled_at as string).toISOString()}`));
    if (outside.length > 0) {
      issues.push({
        type: "outside_window",
        matchIds: outside.map((m) => m.id),
        detail: `${outside.length} partido${outside.length === 1 ? "" : "s"} en un horario que ya no está configurado (revisá si se achicó alguna franja).`,
      });
    }
  }

  const bySlot = new Map<string, string[]>();
  for (const m of scheduled) {
    const key = slotKey(m.court_id as string, m.scheduled_at as string);
    (bySlot.get(key) ?? bySlot.set(key, []).get(key)!).push(m.id);
  }
  const collisions = [...bySlot.values()].filter((ids) => ids.length > 1);
  if (collisions.length > 0) {
    issues.push({
      type: "collision",
      matchIds: collisions.flat(),
      detail: `${collisions.length} turno${collisions.length === 1 ? "" : "s"} con más de un partido a la vez en la misma cancha.`,
    });
  }

  const dayCount = new Map<string, string[]>();
  for (const m of scheduled) {
    const day = localDayKey(m.scheduled_at as string);
    for (const t of [m.team1_id, m.team2_id]) {
      if (!t) continue;
      const key = `${t}|${day}`;
      (dayCount.get(key) ?? dayCount.set(key, []).get(key)!).push(m.id);
    }
  }
  const sameDayGroups = [...dayCount.entries()].filter(([, ids]) => ids.length > 1);
  if (sameDayGroups.length > 0) {
    const sample = sameDayGroups.slice(0, 3).map(([key]) => teamName[key.split("|")[0]] ?? "?").join(", ");
    issues.push({
      type: "same_day",
      matchIds: [...new Set(sameDayGroups.flatMap(([, ids]) => ids))],
      detail: `${sameDayGroups.length} caso${sameDayGroups.length === 1 ? "" : "s"} de una pareja jugando 2 veces el mismo día (ej: ${sample}).`,
    });
  }

  const teamAtTime = new Map<string, string[]>();
  for (const m of scheduled) {
    const iso = new Date(m.scheduled_at as string).toISOString();
    for (const t of [m.team1_id, m.team2_id]) {
      if (!t) continue;
      const key = `${t}|${iso}`;
      (teamAtTime.get(key) ?? teamAtTime.set(key, []).get(key)!).push(m.id);
    }
  }
  const doubleBooked = [...teamAtTime.entries()].filter(([, ids]) => new Set(ids).size > 1);
  if (doubleBooked.length > 0) {
    issues.push({
      type: "double_booked",
      matchIds: [...new Set(doubleBooked.flatMap(([, ids]) => ids))],
      detail: `${doubleBooked.length} caso${doubleBooked.length === 1 ? "" : "s"} de una pareja jugando en dos canchas a la misma hora.`,
    });
  }

  return { totalMatches: all.length, ok: issues.length === 0, issues };
}
