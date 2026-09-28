import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock, type Fixtures } from "./test-utils/supabaseMock";

let current: ReturnType<typeof createSupabaseMock>;
vi.mock("./supabase", () => ({
  get supabase() {
    return current.supabase;
  },
}));

const { checkFixtureHealth } = await import("./fixture-health");

const COURT = "c1";

function baseFixtures(overrides: Partial<Fixtures> = {}): Fixtures {
  return {
    tournaments: [{ start_date: "2026-10-05", default_match_minutes: 60 }],
    horarios_liga: [{ court_id: COURT, dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "22:00:00" }], // lunes 19,20,21
    categories: [{ id: "cat1", name: "Cat Test" }],
    teams: [],
    matches: [],
    ...overrides,
  };
}

function ligaMatch(overrides: Record<string, unknown>) {
  return {
    id: "m", category_id: "cat1", court_id: COURT,
    scheduled_at: null, team1_id: null, team2_id: null, winner_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  current = createSupabaseMock(baseFixtures());
});

describe("checkFixtureHealth", () => {
  it("un fixture sano no reporta ningún problema", () => {
    current = createSupabaseMock(baseFixtures({
      teams: [{ id: "A", name: "Equipo A" }, { id: "B", name: "Equipo B" }],
      matches: [
        ligaMatch({ id: "m1", team1_id: "A", team2_id: "B", scheduled_at: "2026-10-05T22:00:00.000Z" }), // lunes 19hs
      ],
    }));
    return checkFixtureHealth("t1").then((report) => {
      expect(report.ok).toBe(true);
      expect(report.issues).toHaveLength(0);
      expect(report.totalMatches).toBe(1);
    });
  });

  it("detecta partidos sin agendar", () => {
    current = createSupabaseMock(baseFixtures({
      teams: [{ id: "A", name: "Equipo A" }, { id: "B", name: "Equipo B" }],
      matches: [ligaMatch({ id: "m1", team1_id: "A", team2_id: "B", scheduled_at: null })],
    }));
    return checkFixtureHealth("t1").then((report) => {
      expect(report.ok).toBe(false);
      const issue = report.issues.find((i) => i.type === "unscheduled");
      expect(issue?.matchIds).toEqual(["m1"]);
    });
  });

  it("detecta un partido en un horario que ya no está configurado", () => {
    current = createSupabaseMock(baseFixtures({
      teams: [{ id: "A", name: "Equipo A" }, { id: "B", name: "Equipo B" }],
      // 23hs local (02:00Z) cae fuera de la franja configurada (19 a 22hs).
      matches: [ligaMatch({ id: "m1", team1_id: "A", team2_id: "B", scheduled_at: "2026-10-06T02:00:00.000Z" })],
    }));
    return checkFixtureHealth("t1").then((report) => {
      const issue = report.issues.find((i) => i.type === "outside_window");
      expect(issue?.matchIds).toEqual(["m1"]);
    });
  });

  it("detecta dos partidos en el mismo turno exacto (cancha+hora)", () => {
    current = createSupabaseMock(baseFixtures({
      teams: [{ id: "A", name: "Equipo A" }, { id: "B", name: "Equipo B" }, { id: "C", name: "Equipo C" }, { id: "D", name: "Equipo D" }],
      matches: [
        ligaMatch({ id: "m1", team1_id: "A", team2_id: "B", scheduled_at: "2026-10-05T22:00:00.000Z" }),
        ligaMatch({ id: "m2", team1_id: "C", team2_id: "D", scheduled_at: "2026-10-05T22:00:00.000Z" }),
      ],
    }));
    return checkFixtureHealth("t1").then((report) => {
      const issue = report.issues.find((i) => i.type === "collision");
      expect(new Set(issue?.matchIds)).toEqual(new Set(["m1", "m2"]));
    });
  });

  it("detecta una pareja jugando dos veces el mismo día calendario", () => {
    current = createSupabaseMock(baseFixtures({
      teams: [{ id: "A", name: "Equipo A" }, { id: "B", name: "Equipo B" }, { id: "C", name: "Equipo C" }],
      matches: [
        ligaMatch({ id: "m1", team1_id: "A", team2_id: "B", scheduled_at: "2026-10-05T22:00:00.000Z" }), // lunes 19hs
        ligaMatch({ id: "m2", team1_id: "A", team2_id: "C", scheduled_at: "2026-10-05T23:00:00.000Z" }), // lunes 20hs -- mismo día, mismo equipo A
      ],
    }));
    return checkFixtureHealth("t1").then((report) => {
      const issue = report.issues.find((i) => i.type === "same_day");
      expect(new Set(issue?.matchIds)).toEqual(new Set(["m1", "m2"]));
      expect(issue?.detail).toContain("Equipo A");
    });
  });

  it("detecta una pareja jugando a la misma hora en dos canchas", () => {
    current = createSupabaseMock(baseFixtures({
      horarios_liga: [
        { court_id: "c1", dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "22:00:00" },
        { court_id: "c2", dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "22:00:00" },
      ],
      teams: [{ id: "A", name: "Equipo A" }, { id: "B", name: "Equipo B" }, { id: "C", name: "Equipo C" }],
      matches: [
        ligaMatch({ id: "m1", court_id: "c1", team1_id: "A", team2_id: "B", scheduled_at: "2026-10-05T22:00:00.000Z" }),
        ligaMatch({ id: "m2", court_id: "c2", team1_id: "A", team2_id: "C", scheduled_at: "2026-10-05T22:00:00.000Z" }),
      ],
    }));
    return checkFixtureHealth("t1").then((report) => {
      const issue = report.issues.find((i) => i.type === "double_booked");
      expect(new Set(issue?.matchIds)).toEqual(new Set(["m1", "m2"]));
    });
  });
});
