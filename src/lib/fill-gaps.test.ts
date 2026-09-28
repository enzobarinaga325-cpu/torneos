import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock, type Fixtures } from "./test-utils/supabaseMock";

let current: ReturnType<typeof createSupabaseMock>;
vi.mock("./supabase", () => ({
  get supabase() {
    return current.supabase;
  },
}));

const { fillScheduleGaps } = await import("./fill-gaps");

const TOURNAMENT_ID = "t1";
const COURT = "c1";

function baseFixtures(overrides: Partial<Fixtures> = {}): Fixtures {
  return {
    tournaments: [{ default_match_minutes: 60, start_date: "2026-10-05" }],
    horarios_liga: [{ court_id: COURT, dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "22:00:00" }], // lunes 19,20,21
    schedule_blackouts: [],
    categories: [{ id: "cat1" }],
    team_availability: [],
    team_unavailability: [],
    matches: [],
    ...overrides,
  };
}

function ligaMatch(overrides: Record<string, unknown>) {
  return {
    id: "m", category_id: "cat1", court_id: COURT,
    scheduled_at: null, team1_id: null, team2_id: null, winner_id: null, auto_scheduled: true,
    ...overrides,
  };
}

function writesFor(id: string) {
  return current.writes.filter((w) => w.table === "matches" && (w.filters as { id?: string }).id === id);
}

beforeEach(() => {
  current = createSupabaseMock(baseFixtures());
});

describe("fillScheduleGaps", () => {
  it("rellena un hueco en el medio trayendo el último partido del fixture, sin tocar el resto", () => {
    current = createSupabaseMock(baseFixtures({
      matches: [
        ligaMatch({ id: "mX", team1_id: "X1", team2_id: "X2", scheduled_at: "2026-10-05T22:00:00.000Z" }), // lunes 19hs
        // lunes 20hs queda VACÍO -- el hueco a rellenar
        ligaMatch({ id: "mY", team1_id: "Y1", team2_id: "Y2", scheduled_at: "2026-10-06T00:00:00.000Z" }), // lunes 21hs -- el último del fixture
      ],
    }));

    return fillScheduleGaps(TOURNAMENT_ID).then((result) => {
      expect(result).toEqual({ filled: 1, remainingGaps: 0 });
      expect(writesFor("mX")).toHaveLength(0); // nunca se toca lo que no tenía nada que ver
      const [yWrite] = writesFor("mY");
      expect((yWrite.payload as any).scheduled_at).toBe("2026-10-05T23:00:00.000Z"); // mY pasa a llenar el hueco (20hs)
    });
  });

  it("si ningún partido puede ocupar el hueco, lo deja como está en vez de forzarlo", () => {
    current = createSupabaseMock(baseFixtures({
      matches: [
        ligaMatch({ id: "mX", team1_id: "X1", team2_id: "X2", scheduled_at: "2026-10-05T22:00:00.000Z" }), // 19hs
        // 20hs vacío
        ligaMatch({ id: "mY", team1_id: "X1", team2_id: "Y2", scheduled_at: "2026-10-06T00:00:00.000Z" }), // 21hs -- comparte equipo X1 con mX, mismo día
      ],
    }));

    return fillScheduleGaps(TOURNAMENT_ID).then((result) => {
      // mY no puede ir al hueco de las 20hs: X1 ya juega ese mismo día (a las 19hs, con mX).
      expect(result).toEqual({ filled: 0, remainingGaps: 1 });
      expect(writesFor("mY")).toHaveLength(0);
    });
  });

  it("nunca usa como relleno un partido movido a mano o ya jugado", () => {
    current = createSupabaseMock(baseFixtures({
      matches: [
        ligaMatch({ id: "mX", team1_id: "X1", team2_id: "X2", scheduled_at: "2026-10-05T22:00:00.000Z" }), // 19hs
        // 20hs vacío
        ligaMatch({ id: "mLocked", team1_id: "L1", team2_id: "L2", scheduled_at: "2026-10-06T00:00:00.000Z", auto_scheduled: false }), // 21hs, movido a mano
      ],
    }));

    return fillScheduleGaps(TOURNAMENT_ID).then((result) => {
      expect(result).toEqual({ filled: 0, remainingGaps: 1 });
      expect(writesFor("mLocked")).toHaveLength(0);
    });
  });
});
