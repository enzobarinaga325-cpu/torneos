import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSupabaseMock, type Fixtures } from "./test-utils/supabaseMock";

// Igual que repair-schedule.test.ts: el cliente de Supabase es un mock en memoria, nada toca la red.
let current: ReturnType<typeof createSupabaseMock>;
vi.mock("./supabase", () => ({
  get supabase() {
    return current.supabase;
  },
}));

// En liga, suspender vuelve a repartir todo lo que viene con "atrasadas primero"
// (`autoScheduleLeague`, que tiene sus propios tests, incluido no tocar los días que se ven).
// Acá solo se verifica que se le pase la posta bien.
const autoScheduleLeague = vi.fn(async (_tournamentId: string) => ({ scheduled: 3, unscheduled: 0 }));
vi.mock("./league-autoschedule", () => ({ autoScheduleLeague: (id: string) => autoScheduleLeague(id) }));

const { cancelDay, cancelTurn } = await import("./blackouts");

const T = "t1";
const COURT = "c1";

const SLOTS = [
  { court_id: COURT, dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "20:00:00" },
  { court_id: COURT, dia_semana: 3, hora_inicio: "19:00:00", hora_fin: "20:00:00" },
];

function match(id: string, scheduledAt: string, t1: string, t2: string, stage = "liga") {
  return { id, category_id: "cat1", stage, court_id: COURT, scheduled_at: scheduledAt, team1_id: t1, team2_id: t2, winner_id: null, auto_scheduled: false };
}

const MATCHES = [
  match("m1", "2026-10-05T22:00:00.000Z", "A", "B"), // lunes 5 (hoy)
  match("m3", "2026-10-12T22:00:00.000Z", "E", "F"), // lunes 12
  match("m4", "2026-10-14T22:00:00.000Z", "G", "H"), // miércoles 14
];

function fixtures(blackouts: Fixtures["x"] = [], matches = MATCHES): Fixtures {
  return {
    tournaments: [{ default_match_minutes: 60, start_date: "2026-10-05" }],
    courts: [{ id: COURT }],
    tournament_days: [],
    horarios_liga: SLOTS,
    schedule_blackouts: blackouts,
    categories: [{ id: "cat1" }],
    team_availability: [],
    team_unavailability: [],
    matches,
  };
}

/** Escrituras a `matches` que alcanzan al partido `id` (por `.eq("id", ...)` o `.in("id", [...])`). */
const writesFor = (id: string) =>
  current.writes.filter((w) => {
    if (w.table !== "matches") return false;
    const f = (w.filters as { id?: string | string[] }).id;
    return Array.isArray(f) ? f.includes(id) : f === id;
  });

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 5, 12, 0), toFake: ["Date"] }); // hoy: lunes 5 de octubre
  autoScheduleLeague.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("cancelDay / cancelTurn en liga: se vuelve a repartir con prioridad a las atrasadas", () => {
  it("cancelar HOY deja el partido suspendido sin horario (y automático) y reparte todo de nuevo", async () => {
    current = createSupabaseMock(fixtures([{ date: "2026-10-05", court_id: null, hora_inicio: null }]));
    const result = await cancelDay(T, "2026-10-05");

    expect(result).toEqual({ unscheduled: 0 });
    const w = writesFor("m1");
    expect(w).toHaveLength(1);
    expect(w[0].payload).toEqual({ court_id: null, scheduled_at: null, auto_scheduled: true });
    expect(writesFor("m3")).toHaveLength(0); // los demás no se tocan acá (los reparte autoScheduleLeague)
    expect(writesFor("m4")).toHaveLength(0);
    expect(autoScheduleLeague).toHaveBeenCalledWith(T);
  });

  it("cancelar un día de más adelante solo libera los partidos de ese día", async () => {
    current = createSupabaseMock(fixtures([{ date: "2026-10-14", court_id: null, hora_inicio: null }]));
    await cancelDay(T, "2026-10-14");

    expect(writesFor("m4")).toHaveLength(1);
    expect(writesFor("m1")).toHaveLength(0);
    expect(writesFor("m3")).toHaveLength(0);
    expect(autoScheduleLeague).toHaveBeenCalledTimes(1);
  });

  it("cancelar un turno puntual también reparte con prioridad", async () => {
    current = createSupabaseMock(fixtures([{ date: "2026-10-05", court_id: COURT, hora_inicio: "19:00:00" }]));
    await cancelTurn(T, { court_id: COURT, scheduled_at: "2026-10-05T22:00:00.000Z" });

    expect(writesFor("m1")).toHaveLength(1);
    expect(writesFor("m3")).toHaveLength(0);
    expect(autoScheduleLeague).toHaveBeenCalledTimes(1);
  });

  it("en torneos por zonas (no liga) sigue reacomodando solo lo suspendido, sin repartir todo", async () => {
    const zonas = [match("z1", "2026-10-05T22:00:00.000Z", "A", "B", "zona")];
    current = createSupabaseMock(fixtures([{ date: "2026-10-05", court_id: null, hora_inicio: null }], zonas));
    await cancelDay(T, "2026-10-05");

    expect(autoScheduleLeague).not.toHaveBeenCalled();
    expect(writesFor("z1").length).toBeGreaterThan(0);
  });
});
