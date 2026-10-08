import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSupabaseMock, type Fixtures } from "./test-utils/supabaseMock";

// Igual que repair-schedule.test.ts: el cliente de Supabase es un mock en memoria, nada toca la red.
let current: ReturnType<typeof createSupabaseMock>;
vi.mock("./supabase", () => ({
  get supabase() {
    return current.supabase;
  },
}));

const { cancelDay, cancelTurn } = await import("./blackouts");

const T = "t1";
const COURT = "c1";

// Liga: lunes y miércoles, un solo turno por día (19hs), una sola cancha.
const SLOTS = [
  { court_id: COURT, dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "20:00:00" },
  { court_id: COURT, dia_semana: 3, hora_inicio: "19:00:00", hora_fin: "20:00:00" },
];

function match(id: string, scheduledAt: string, t1: string, t2: string) {
  return { id, category_id: "cat1", stage: "liga", court_id: COURT, scheduled_at: scheduledAt, team1_id: t1, team2_id: t2, winner_id: null, auto_scheduled: true };
}

// Días con partidos: lunes 5, lunes 12 y miércoles 14. El miércoles 7 tiene el turno LIBRE (sin
// partido): es el lugar más cercano disponible, justo adentro de los días que no hay que tocar --
// si el reacomodo no estuviera protegido, los partidos suspendidos irían a parar ahí.
const MATCHES = [
  match("m1", "2026-10-05T22:00:00.000Z", "A", "B"), // lunes 5 (hoy)
  match("m3", "2026-10-12T22:00:00.000Z", "E", "F"), // lunes 12
  match("m4", "2026-10-14T22:00:00.000Z", "G", "H"), // miércoles 14
];

function fixtures(blackouts: Fixtures["x"] = []): Fixtures {
  return {
    tournaments: [{ default_match_minutes: 60, start_date: "2026-10-05" }],
    courts: [{ id: COURT }],
    tournament_days: [],
    horarios_liga: SLOTS,
    schedule_blackouts: blackouts,
    categories: [{ id: "cat1" }],
    team_availability: [],
    team_unavailability: [],
    matches: MATCHES,
  };
}

const writesFor = (id: string) => current.writes.filter((w) => w.table === "matches" && (w.filters as { id?: string }).id === id);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 5, 12, 0), toFake: ["Date"] }); // hoy: lunes 5 de octubre
});
afterEach(() => {
  vi.useRealTimers();
});

describe("cancelDay / cancelTurn: reacomodan después de los próximos 2 días con partidos", () => {
  it("cancelar HOY manda el partido después de los 2 días que se ven, y no toca los demás", async () => {
    // Sin el partido de hoy, los próximos 2 días con partidos son el lunes 12 y el miércoles 14, así
    // que el partido de hoy solo puede ir desde el 15: al lunes 19 (y NO al miércoles 7, que está libre).
    current = createSupabaseMock(fixtures([{ date: "2026-10-05", court_id: null, hora_inicio: null }]));
    const result = await cancelDay(T, "2026-10-05");

    expect(result).toEqual({ unscheduled: 0 });
    expect((writesFor("m1")[0].payload as any).scheduled_at).toBe("2026-10-19T22:00:00.000Z");
    expect(writesFor("m3")).toHaveLength(0); // lunes 12: lo que la gente ve, intacto
    expect(writesFor("m4")).toHaveLength(0); // miércoles 14: ídem
  });

  it("cancelar un día de más adelante no toca los 2 días que se ven", async () => {
    // Se cancela el miércoles 14. Los 2 días que se ven son el lunes 5 y el lunes 12: no se tocan.
    // El partido del 14 NO puede ir al miércoles 7 (libre, pero antes de esos días): va al lunes 19.
    current = createSupabaseMock(fixtures([{ date: "2026-10-14", court_id: null, hora_inicio: null }]));
    await cancelDay(T, "2026-10-14");

    expect((writesFor("m4")[0].payload as any).scheduled_at).toBe("2026-10-19T22:00:00.000Z");
    expect(writesFor("m1")).toHaveLength(0);
    expect(writesFor("m3")).toHaveLength(0);
  });

  it("cancelar un turno de hoy tampoco cambia los 2 días que se ven", async () => {
    current = createSupabaseMock(fixtures([{ date: "2026-10-05", court_id: COURT, hora_inicio: "19:00:00" }]));
    await cancelTurn(T, { court_id: COURT, scheduled_at: "2026-10-05T22:00:00.000Z" });

    expect((writesFor("m1")[0].payload as any).scheduled_at).toBe("2026-10-19T22:00:00.000Z");
    expect(writesFor("m3")).toHaveLength(0);
  });
});
