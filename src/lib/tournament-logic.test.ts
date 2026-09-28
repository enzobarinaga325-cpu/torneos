import { describe, it, expect } from "vitest";
import {
  isBlackedOut,
  isTeamAvailable,
  isTeamAvailableOnDate,
  slotKey,
  matchWinner,
  computeStandings,
  buildDayTimeSlots,
  buildSchedule,
  roundRobinPairs,
} from "./tournament-logic";
import type { Match } from "./types";

function makeMatch(overrides: Partial<Match>): Match {
  return {
    id: "m1",
    category_id: "cat1",
    stage: "zona",
    zone_id: null,
    round_name: null,
    round_order: null,
    position: 0,
    team1_id: "t1",
    team2_id: "t2",
    court_id: null,
    scheduled_at: null,
    auto_scheduled: true,
    set1_team1: null, set1_team2: null,
    set2_team1: null, set2_team2: null,
    set3_team1: null, set3_team2: null,
    winner_id: null,
    next_match_id: null,
    next_match_slot: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("slotKey", () => {
  it("normaliza distintos formatos de timestamp al mismo instante", () => {
    // Este fue un bug real en producción: un timestamp leído de Supabase ("+00:00") y uno
    // recién generado con toISOString() ("Z" con milisegundos) representan el mismo instante
    // pero como texto son distintos — slotKey tiene que igualarlos.
    const fromDb = "2026-10-05T22:00:00+00:00";
    const freshlyGenerated = new Date(fromDb).toISOString();
    expect(slotKey("cancha1", fromDb)).toBe(slotKey("cancha1", freshlyGenerated));
  });

  it("distingue canchas distintas al mismo horario", () => {
    const iso = "2026-10-05T22:00:00Z";
    expect(slotKey("cancha1", iso)).not.toBe(slotKey("cancha2", iso));
  });
});

describe("isBlackedOut", () => {
  const iso = "2026-10-05T22:00:00Z"; // Lunes 19:00 en Argentina (UTC-3)

  it("no bloquea nada si no hay blackouts", () => {
    expect(isBlackedOut([], "cancha1", iso)).toBe(false);
  });

  it("bloquea el día entero en todas las canchas cuando court_id y hora_inicio son null", () => {
    const blackouts = [{ date: "2026-10-05", court_id: null, hora_inicio: null }];
    expect(isBlackedOut(blackouts, "cancha1", iso)).toBe(true);
    expect(isBlackedOut(blackouts, "cancha2", iso)).toBe(true);
  });

  it("bloquea solo la cancha indicada", () => {
    const blackouts = [{ date: "2026-10-05", court_id: "cancha1", hora_inicio: null }];
    expect(isBlackedOut(blackouts, "cancha1", iso)).toBe(true);
    expect(isBlackedOut(blackouts, "cancha2", iso)).toBe(false);
  });

  it("bloquea solo el turno puntual indicado", () => {
    const blackouts = [{ date: "2026-10-05", court_id: "cancha1", hora_inicio: "19:00:00" }];
    expect(isBlackedOut(blackouts, "cancha1", iso)).toBe(true);
    const otroTurno = "2026-10-05T23:00:00Z"; // 20:00 local
    expect(isBlackedOut(blackouts, "cancha1", otroTurno)).toBe(false);
  });

  it("no bloquea otro día", () => {
    const blackouts = [{ date: "2026-10-06", court_id: null, hora_inicio: null }];
    expect(isBlackedOut(blackouts, "cancha1", iso)).toBe(false);
  });
});

describe("isTeamAvailable", () => {
  const duration = 60;

  it("un equipo sin ninguna franja cargada no tiene restricción", () => {
    expect(isTeamAvailable([], "equipoA", "2026-10-05T22:00:00Z", duration)).toBe(true);
  });

  it("respeta una franja normal (sin cruzar medianoche)", () => {
    const windows = [{ team_id: "equipoA", dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "22:00:00" }];
    // Lunes 19:00 local -> dentro de la franja
    expect(isTeamAvailable(windows, "equipoA", "2026-10-05T22:00:00Z", duration)).toBe(true);
    // Lunes 22:00 local -> justo en el límite de cierre, un partido de 60' no entra
    expect(isTeamAvailable(windows, "equipoA", "2026-10-06T01:00:00Z", duration)).toBe(false);
    // Martes -> otro día, no aplica la franja del lunes
    expect(isTeamAvailable(windows, "equipoA", "2026-10-06T22:00:00Z", duration)).toBe(false);
  });

  it("un equipo con franja solo se agenda ahí — otro equipo sin franja no se ve afectado", () => {
    const windows = [{ team_id: "equipoA", dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "20:00:00" }];
    expect(isTeamAvailable(windows, "equipoB", "2026-10-06T22:00:00Z", duration)).toBe(true);
  });

  it("una franja que cruza la medianoche sigue perteneciendo al día en que empezó", () => {
    // Lunes 19hs a 00:30hs (cruza medianoche) -> un partido a las 23:30 lunes (00:30 local
    // del martes) sigue siendo válido para la franja de "lunes".
    const windows = [{ team_id: "equipoA", dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "00:30:00" }];
    const madrugadaMartes = "2026-10-06T02:00:00Z"; // 23:00 del lunes en Argentina
    expect(isTeamAvailable(windows, "equipoA", madrugadaMartes, duration)).toBe(true);
  });
});

describe("isTeamAvailableOnDate", () => {
  it("sin rangos cargados, no hay restricción", () => {
    expect(isTeamAvailableOnDate([], "equipoA", "2026-10-05T22:00:00Z")).toBe(true);
  });

  it("bloquea los días dentro del rango, incluyendo los extremos", () => {
    const ranges = [{ team_id: "equipoA", start_date: "2026-10-05", end_date: "2026-10-10" }];
    expect(isTeamAvailableOnDate(ranges, "equipoA", "2026-10-05T13:00:00Z")).toBe(false); // primer día
    expect(isTeamAvailableOnDate(ranges, "equipoA", "2026-10-10T13:00:00Z")).toBe(false); // último día
    expect(isTeamAvailableOnDate(ranges, "equipoA", "2026-10-04T13:00:00Z")).toBe(true); // un día antes
    expect(isTeamAvailableOnDate(ranges, "equipoA", "2026-10-11T13:00:00Z")).toBe(true); // un día después
  });

  it("no afecta a otro equipo", () => {
    const ranges = [{ team_id: "equipoA", start_date: "2026-10-05", end_date: "2026-10-10" }];
    expect(isTeamAvailableOnDate(ranges, "equipoB", "2026-10-05T13:00:00Z")).toBe(true);
  });
});

describe("matchWinner", () => {
  it("nadie ganó todavía si faltan sets", () => {
    expect(matchWinner(makeMatch({ set1_team1: 6, set1_team2: 4 }))).toBeNull();
  });

  it("gana el equipo 1 con 2 sets a 0", () => {
    expect(matchWinner(makeMatch({ set1_team1: 6, set1_team2: 4, set2_team1: 6, set2_team2: 2 }))).toBe(1);
  });

  it("gana el equipo 2 con el tercer set", () => {
    expect(matchWinner(makeMatch({
      set1_team1: 6, set1_team2: 4,
      set2_team1: 3, set2_team2: 6,
      set3_team1: 2, set3_team2: 6,
    }))).toBe(2);
  });

  it("un set empatado no cuenta como ganado por nadie", () => {
    expect(matchWinner(makeMatch({ set1_team1: 6, set1_team2: 6 }))).toBeNull();
  });
});

describe("computeStandings", () => {
  it("ordena por partidos ganados y después por diferencia de sets", () => {
    const matches = [
      makeMatch({ id: "m1", team1_id: "A", team2_id: "B", set1_team1: 6, set1_team2: 0, set2_team1: 6, set2_team2: 0 }),
      makeMatch({ id: "m2", team1_id: "A", team2_id: "C", set1_team1: 6, set1_team2: 4, set2_team1: 3, set2_team2: 6, set3_team1: 6, set3_team2: 4 }),
      makeMatch({ id: "m3", team1_id: "B", team2_id: "C", set1_team1: 6, set1_team2: 2, set2_team1: 6, set2_team2: 2 }),
    ];
    const table = computeStandings(["A", "B", "C"], matches);
    expect(table[0].team_id).toBe("A"); // 2 ganados
    expect(table.map((t) => t.team_id)).toEqual(["A", "B", "C"]);
    expect(table.find((t) => t.team_id === "A")!.won).toBe(2);
    expect(table.find((t) => t.team_id === "B")!.won).toBe(1);
    expect(table.find((t) => t.team_id === "C")!.won).toBe(0);
  });

  it("ignora partidos sin resultado cargado", () => {
    const matches = [makeMatch({ team1_id: "A", team2_id: "B" })];
    const table = computeStandings(["A", "B"], matches);
    expect(table.every((t) => t.played === 0)).toBe(true);
  });
});

describe("roundRobinPairs", () => {
  it("arma todos los cruces posibles una sola vez", () => {
    const pairs = roundRobinPairs(["A", "B", "C"]);
    expect(pairs).toHaveLength(3);
    expect(pairs).toEqual(
      expect.arrayContaining([["A", "B"], ["A", "C"], ["B", "C"]]),
    );
  });
});

describe("buildDayTimeSlots", () => {
  it("genera un turno por cada bloque de duración dentro de la ventana", () => {
    const slots = buildDayTimeSlots([{ date: "2026-10-05", start_time: "19:00", end_time: "22:00" }], 60);
    expect(slots).toHaveLength(3);
  });

  it("arranca un turno mientras el INICIO sea antes del cierre (aunque se pase de largo)", () => {
    // A diferencia de `projectLeagueSlots` (liga), acá el corte es por el horario de
    // ARRANQUE del turno, no por si el turno completo entra antes del cierre -- documenta el
    // comportamiento actual, que es asimétrico a propósito entre torneo y liga.
    const slots = buildDayTimeSlots([{ date: "2026-10-05", start_time: "19:00", end_time: "22:30" }], 60);
    expect(slots).toHaveLength(4); // 19, 20, 21, 22 (empieza a las 22 aunque cierre a las 22:30)
  });
});

describe("buildSchedule", () => {
  const days = [{ date: "2026-10-05", start_time: "19:00", end_time: "23:00" }];

  it("no agenda dos partidos de un mismo equipo al mismo horario", () => {
    const queues = [[
      { id: "m1", team1_id: "A", team2_id: "B" },
      { id: "m2", team1_id: "A", team2_id: "C" },
    ]];
    const { assignments } = buildSchedule(queues, ["cancha1", "cancha2"], days, 60);
    const timesForA = assignments.filter((a) => ["m1", "m2"].includes(a.matchId)).map((a) => a.scheduledAt);
    expect(new Set(timesForA).size).toBe(2); // horarios distintos
  });

  it("respeta el descanso mínimo entre dos partidos del mismo equipo", () => {
    const queues = [[
      { id: "m1", team1_id: "A", team2_id: "B" },
      { id: "m2", team1_id: "A", team2_id: "C" },
      { id: "m3", team1_id: "A", team2_id: "D" },
    ]];
    const { assignments } = buildSchedule(queues, ["cancha1"], days, 60);
    const timesForA = assignments
      .filter((a) => ["m1", "m2", "m3"].includes(a.matchId))
      .map((a) => new Date(a.scheduledAt).getTime())
      .sort((a, b) => a - b);
    for (let i = 1; i < timesForA.length; i++) {
      expect(timesForA[i] - timesForA[i - 1]).toBeGreaterThanOrEqual(120 * 60000); // >= 2 turnos de 60'
    }
  });

  it("no agenda un partido fuera de la franja horaria de un equipo restringido", () => {
    const queues = [[{ id: "m1", team1_id: "A", team2_id: "B" }]];
    // A solo puede jugar los martes -- el único día cargado es un lunes, así que no debería entrar.
    const availability = [{ team_id: "A", dia_semana: 2, hora_inicio: "19:00:00", hora_fin: "22:00:00" }];
    const { assignments, unscheduledCount } = buildSchedule(queues, ["cancha1"], days, 60, [], [], availability);
    expect(assignments).toHaveLength(0);
    expect(unscheduledCount).toBe(1);
  });

  it("no agenda un partido dentro del rango de ausencia de un equipo", () => {
    const queues = [[{ id: "m1", team1_id: "A", team2_id: "B" }]];
    const unavailability = [{ team_id: "A", start_date: "2026-10-05", end_date: "2026-10-05" }];
    const { assignments, unscheduledCount } = buildSchedule(queues, ["cancha1"], days, 60, [], [], [], unavailability);
    expect(assignments).toHaveLength(0);
    expect(unscheduledCount).toBe(1);
  });

  it("respeta un turno cancelado (blackout)", () => {
    const queues = [[{ id: "m1", team1_id: "A", team2_id: "B" }]];
    const blackouts = [{ date: "2026-10-05", court_id: null, hora_inicio: null }];
    const { assignments, unscheduledCount } = buildSchedule(queues, ["cancha1"], days, 60, [], blackouts);
    expect(assignments).toHaveLength(0);
    expect(unscheduledCount).toBe(1);
  });

  it("cuenta como sin agendar lo que no entra en los días cargados", () => {
    const queues = [[
      { id: "m1", team1_id: "A", team2_id: "B" },
      { id: "m2", team1_id: "A", team2_id: "C" },
    ]];
    // Un solo turno posible (18 a 19) y un solo equipo A en ambos partidos -- solo entra uno.
    const oneSlotDay = [{ date: "2026-10-05", start_time: "19:00", end_time: "20:00" }];
    const { assignments, unscheduledCount } = buildSchedule(queues, ["cancha1"], oneSlotDay, 60);
    expect(assignments).toHaveLength(1);
    expect(unscheduledCount).toBe(1);
  });
});
