import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSupabaseMock, type Fixtures } from "./test-utils/supabaseMock";

// Igual que blackouts.test.ts: el cliente de Supabase es un mock en memoria, nada toca la red.
let current: ReturnType<typeof createSupabaseMock>;
vi.mock("./supabase", () => ({
  get supabase() {
    return current.supabase;
  },
}));

const { autoScheduleLeague } = await import("./league-autoschedule");

const COURT = "c1";
// Liga: lunes y miércoles a las 19hs, un solo turno por día y una sola cancha.
const SLOTS = [
  { court_id: COURT, dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "20:00:00" },
  { court_id: COURT, dia_semana: 3, hora_inicio: "19:00:00", hora_fin: "20:00:00" },
];

function match(id: string, scheduledAt: string | null, t1: string, t2: string, round: number) {
  return { id, category_id: "cat1", zone_id: null, round_order: round, position: 0, team1_id: t1, team2_id: t2, scheduled_at: scheduledAt, court_id: scheduledAt ? COURT : null, auto_scheduled: true, winner_id: null };
}

// Con el torneo empezado: hay partidos agendados el lunes 5 (hoy), el lunes 12 y el miércoles 14, y tres
// partidos nuevos sin horario. Los 3 días con partidos se ven y NO se tocan; lo nuevo va desde el jueves 15.
const MATCHES = [
  match("p1", "2026-10-05T22:00:00.000Z", "A", "B", 1),
  match("p2", "2026-10-12T22:00:00.000Z", "C", "D", 1),
  match("p3", "2026-10-14T22:00:00.000Z", "E", "F", 1),
  match("u1", null, "A", "C", 2),
  match("u2", null, "B", "D", 2),
  match("u3", null, "E", "G", 2),
];

function fixtures(startDate: string): Fixtures {
  return {
    tournaments: [{ default_match_minutes: 60, start_date: startDate }],
    courts: [{ id: COURT }],
    horarios_liga: SLOTS,
    categories: [{ id: "cat1" }],
    schedule_blackouts: [],
    team_availability: [],
    team_unavailability: [],
    zones: [],
    matches: MATCHES,
  };
}

const matchWrites = () => current.writes.filter((w) => w.table === "matches");
const writesFor = (id: string) => matchWrites().filter((w) => (w.filters as { id?: string }).id === id);
const assigned = (id: string) => writesFor(id).map((w) => w.payload as { scheduled_at?: string | null }).find((p) => p.scheduled_at);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 5, 12, 0), toFake: ["Date"] }); // hoy: lunes 5 de octubre
});
afterEach(() => {
  vi.useRealTimers();
});

describe("autoScheduleLeague", () => {
  it("con el torneo empezado no mueve los días que se ven (hoy + próximos 2 días con partidos) y agenda lo nuevo después", async () => {
    current = createSupabaseMock(fixtures("2026-10-05"));
    const res = await autoScheduleLeague("t1");

    expect(res.unscheduled).toBe(0);
    expect(res.scheduled).toBe(3);
    for (const id of ["p1", "p2", "p3"]) expect(writesFor(id)).toHaveLength(0); // ni se vacían ni se reubican
    for (const id of ["u1", "u2", "u3"]) {
      const day = new Date(assigned(id)!.scheduled_at as string);
      expect(day.getTime()).toBeGreaterThanOrEqual(new Date(2026, 9, 15).getTime()); // desde el jueves 15
    }
  });

  it("con el torneo todavía sin empezar reparte todo de nuevo (no hay nada que la gente haya visto)", async () => {
    current = createSupabaseMock(fixtures("2026-10-19"));
    const res = await autoScheduleLeague("t1");

    expect(res.unscheduled).toBe(0);
    expect(res.scheduled).toBe(6);
    // p1..p3 se vaciaron y se volvieron a agendar, y ninguno quedó antes de la fecha de inicio (lunes 19).
    const reset = matchWrites().find((w) => (w.payload as { scheduled_at: unknown }).scheduled_at === null);
    expect((reset!.filters as { id: string[] }).id.sort()).toEqual(["p1", "p2", "p3"]);
    for (const id of ["p1", "p2", "p3"]) {
      expect(new Date(assigned(id)!.scheduled_at as string).getTime()).toBeGreaterThanOrEqual(new Date(2026, 9, 19).getTime());
    }
  });
});
