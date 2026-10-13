import { describe, expect, it } from "vitest";
import { optimizeLeagueSchedule } from "./league-optimizer";
import { buildLeagueSchedule, roundRobinJourneys, type CourtSlot, type LeagueMatchInput } from "./league-logic";
import { localDateStr } from "./format";

// 2026-09-28 es lunes. Dos canchas, lunes a jueves de 20 a 22 (2 turnos de 60 min por cancha y día).
const START = "2026-09-28";
const SLOTS: CourtSlot[] = [1, 2, 3, 4].flatMap((dia) =>
  ["c1", "c2"].map((court_id) => ({ court_id, dia_semana: dia, hora_inicio: "20:00:00", hora_fin: "22:00:00" })),
);
const DURATION = 60;

function zone(prefix: string, n: number): LeagueMatchInput[] {
  const teams = Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
  return roundRobinJourneys(teams, false).flat().map(([a, b], i) => ({ id: `${prefix}-${i}`, team1_id: a, team2_id: b }));
}

type Result = ReturnType<typeof optimizeLeagueSchedule>;
const FAST = { iterations: 200_000, seed: 7 };

function daysByTeam(queues: LeagueMatchInput[][], res: Result): Map<string, number[]> {
  const byId = new Map(queues.flat().map((m) => [m.id, m]));
  const out = new Map<string, number[]>();
  for (const a of res.assignments) {
    const m = byId.get(a.matchId)!;
    const [y, mo, d] = localDateStr(a.scheduledAt).split("-").map(Number);
    const dn = Date.UTC(y, mo - 1, d) / 86_400_000;
    for (const t of [m.team1_id, m.team2_id]) out.set(t, [...(out.get(t) ?? []), dn]);
  }
  for (const v of out.values()) v.sort((a, b) => a - b);
  return out;
}
const gaps = (days: number[]) => days.slice(1).map((d, i) => d - days[i]);
const sumSq = (m: Map<string, number[]>) => [...m.values()].flatMap(gaps).reduce((s, g) => s + g * g, 0);
const maxGap = (m: Map<string, number[]>) => Math.max(...[...m.values()].flatMap(gaps));

describe("optimizeLeagueSchedule", () => {
  it("cumple las reglas duras: un partido por turno y un solo partido por día por pareja", () => {
    const queues = [zone("A", 8), zone("B", 7), zone("C", 6)];
    const res = optimizeLeagueSchedule(queues, SLOTS, DURATION, START, [], [], [], [], FAST);
    expect(res.unscheduledCount).toBe(0);
    expect(res.assignments).toHaveLength(28 + 21 + 15);
    const slotKeys = res.assignments.map((a) => `${a.courtId}|${a.scheduledAt}`);
    expect(new Set(slotKeys).size).toBe(slotKeys.length);
    for (const days of daysByTeam(queues, res).values()) expect(new Set(days).size).toBe(days.length);
  });

  it("todas las parejas debutan lo antes posible (en los primeros días de juego)", () => {
    const queues = [zone("A", 6), zone("B", 6), zone("C", 6)]; // 18 parejas -> 9 partidos alcanzan para que todas debuten
    const res = optimizeLeagueSchedule(queues, SLOTS, DURATION, START, [], [], [], [], FAST);
    const firstDays = [...daysByTeam(queues, res).values()].map((d) => d[0]);
    const playDays = [...new Set([...daysByTeam(queues, res).values()].flat())].sort((a, b) => a - b);
    // Cada día de juego tiene 4 turnos: 9 partidos de debut entran en los primeros 3 días de juego.
    const lastDebut = Math.max(...firstDays);
    expect(playDays.indexOf(lastDebut)).toBeLessThanOrEqual(2);
  });

  it("deja un calendario más parejo que el reparto anterior (menor suma de huecos al cuadrado y menor peor hueco)", () => {
    const queues = [zone("A", 8), zone("B", 8), zone("C", 7)];
    const base = buildLeagueSchedule(queues, SLOTS, DURATION, START);
    const opt = optimizeLeagueSchedule(queues, SLOTS, DURATION, START, [], [], [], [], FAST);
    const dBase = daysByTeam(queues, base);
    const dOpt = daysByTeam(queues, opt);
    expect(sumSq(dOpt)).toBeLessThan(sumSq(dBase));
    expect(maxGap(dOpt)).toBeLessThanOrEqual(maxGap(dBase));
  });

  it("respeta la disponibilidad horaria: una pareja que solo puede los jueves juega solo los jueves", () => {
    const queues = [zone("A", 6)];
    const availability = [{ team_id: "A1", dia_semana: 4, hora_inicio: "20:00:00", hora_fin: "22:00:00" }];
    const res = optimizeLeagueSchedule(queues, SLOTS, DURATION, START, [], [], availability, [], FAST);
    expect(res.unscheduledCount).toBe(0);
    const byId = new Map(queues[0].map((m) => [m.id, m]));
    const mine = res.assignments.filter((a) => [byId.get(a.matchId)!.team1_id, byId.get(a.matchId)!.team2_id].includes("A1"));
    expect(mine).toHaveLength(5);
    for (const a of mine) expect(new Date(a.scheduledAt).getDay()).toBe(4);
  });

  it("respeta los días no disponibles y los turnos bloqueados", () => {
    const queues = [zone("A", 4)];
    const unavailability = [{ team_id: "A2", start_date: "2026-09-28", end_date: "2026-09-30" }];
    const blackouts = [{ date: "2026-10-01", court_id: null, hora_inicio: null }];
    const res = optimizeLeagueSchedule(queues, SLOTS, DURATION, START, [], blackouts, [], unavailability, FAST);
    const byId = new Map(queues[0].map((m) => [m.id, m]));
    for (const a of res.assignments) {
      const day = localDateStr(a.scheduledAt);
      expect(day).not.toBe("2026-10-01");
      const m = byId.get(a.matchId)!;
      if (m.team1_id === "A2" || m.team2_id === "A2") expect(day >= "2026-10-01").toBe(true);
    }
  });

  it("no pisa lo ya agendado (jugado o a mano) ni pone a una pareja dos veces ese día", () => {
    const queues = [zone("A", 4)];
    const iso = (d: number, h: number) => new Date(2026, 8, d, h, 0).toISOString();
    const locked = [{ court_id: "c1", scheduled_at: iso(28, 20), team1_id: "A1", team2_id: "ZZ" }];
    const res = optimizeLeagueSchedule(queues, SLOTS, DURATION, START, locked, [], [], [], FAST);
    expect(res.assignments.some((a) => a.courtId === "c1" && a.scheduledAt === iso(28, 20))).toBe(false);
    const byId = new Map(queues[0].map((m) => [m.id, m]));
    for (const a of res.assignments) {
      const m = byId.get(a.matchId)!;
      if (localDateStr(a.scheduledAt) === "2026-09-28") expect([m.team1_id, m.team2_id]).not.toContain("A1");
    }
  });

  it("si un partido no tiene ningún turno que les sirva a las dos parejas, queda sin agendar", () => {
    const queues = [zone("A", 3)];
    const availability = [
      { team_id: "A1", dia_semana: 1, hora_inicio: "20:00:00", hora_fin: "22:00:00" },
      { team_id: "A2", dia_semana: 2, hora_inicio: "20:00:00", hora_fin: "22:00:00" },
    ];
    const res = optimizeLeagueSchedule(queues, SLOTS, DURATION, START, [], [], availability, [], FAST);
    expect(res.unscheduledCount).toBe(1); // A1 vs A2 nunca coinciden
    expect(res.assignments).toHaveLength(2);
  });

  it("no agenda nada antes de la fecha mínima", () => {
    const queues = [zone("A", 6)];
    const res = optimizeLeagueSchedule(queues, SLOTS, DURATION, START, [], [], [], [], { ...FAST, earliestDate: "2026-10-12" });
    expect(res.unscheduledCount).toBe(0);
    for (const a of res.assignments) expect(localDateStr(a.scheduledAt) >= "2026-10-12").toBe(true);
  });

  it("es determinístico: misma entrada, mismo calendario", () => {
    const queues = [zone("A", 6), zone("B", 5)];
    const a = optimizeLeagueSchedule(queues, SLOTS, DURATION, START, [], [], [], [], FAST);
    const b = optimizeLeagueSchedule(queues, SLOTS, DURATION, START, [], [], [], [], FAST);
    expect(b).toEqual(a);
  });

  it("sin partidos o sin franjas devuelve vacío", () => {
    expect(optimizeLeagueSchedule([], SLOTS, DURATION, START)).toEqual({ assignments: [], unscheduledCount: 0 });
    expect(optimizeLeagueSchedule([zone("A", 3)], [], DURATION, START).unscheduledCount).toBe(3);
  });
});
