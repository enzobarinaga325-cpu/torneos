import { describe, it, expect } from "vitest";
import { roundRobinJourneys, localDayKey, projectLeagueSlots, buildLeagueSchedule } from "./league-logic";

describe("roundRobinJourneys", () => {
  it("con equipos pares, cada jornada tiene a todos jugando exactamente una vez", () => {
    const journeys = roundRobinJourneys(["A", "B", "C", "D"], false);
    expect(journeys).toHaveLength(3); // n-1 jornadas
    for (const jornada of journeys) {
      const teamsInJornada = jornada.flat();
      expect(new Set(teamsInJornada).size).toBe(teamsInJornada.length); // nadie repetido
      expect(teamsInJornada).toHaveLength(4); // todos juegan
    }
  });

  it("con equipos impares, alguien libra cada jornada (el bye no genera partido)", () => {
    const journeys = roundRobinJourneys(["A", "B", "C"], false);
    expect(journeys).toHaveLength(3); // n=4 con el bye virtual -> 3 jornadas
    for (const jornada of journeys) {
      expect(jornada).toHaveLength(1); // 1 partido real, el otro cruce es contra el bye
    }
  });

  it("cada pareja de equipos se enfrenta exactamente una vez en el todos-contra-todos (ida)", () => {
    const teams = ["A", "B", "C", "D", "E"];
    const journeys = roundRobinJourneys(teams, false);
    const allPairs = journeys.flat().map(([a, b]) => [a, b].sort().join("-"));
    const expectedPairs = new Set<string>();
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) expectedPairs.add([teams[i], teams[j]].sort().join("-"));
    }
    expect(new Set(allPairs)).toEqual(expectedPairs);
    expect(allPairs).toHaveLength(expectedPairs.size); // sin repetidos
  });

  it("ida y vuelta duplica las jornadas con los locales invertidos", () => {
    const teams = ["A", "B", "C", "D"];
    const soloIda = roundRobinJourneys(teams, false);
    const idaYVuelta = roundRobinJourneys(teams, true);
    expect(idaYVuelta).toHaveLength(soloIda.length * 2);
    const vuelta = idaYVuelta.slice(soloIda.length);
    expect(vuelta).toEqual(soloIda.map((j) => j.map(([a, b]) => [b, a])));
  });
});

describe("localDayKey", () => {
  it("da la misma clave para dos horarios del mismo día calendario", () => {
    const manana = new Date(2026, 9, 5, 9, 0);
    const noche = new Date(2026, 9, 5, 23, 30);
    expect(localDayKey(manana)).toBe(localDayKey(noche));
  });

  it("da distinta clave para días distintos", () => {
    expect(localDayKey(new Date(2026, 9, 5, 23, 0))).not.toBe(localDayKey(new Date(2026, 9, 6, 0, 0)));
  });
});

describe("projectLeagueSlots", () => {
  it("proyecta un turno por cancha en el día de la semana configurado", () => {
    // 2026-09-28 es un lunes.
    const slots = [{ court_id: "cancha1", dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "21:00:00" }];
    const occ = projectLeagueSlots(slots, "2026-09-28", 1, 60);
    expect(occ).toHaveLength(2); // 19:00 y 20:00
    expect(occ[0].date.getDay()).toBe(1); // lunes
  });

  it("una franja que cruza la medianoche genera turnos de madrugada del día siguiente", () => {
    const slots = [{ court_id: "cancha1", dia_semana: 5, hora_inicio: "23:00:00", hora_fin: "01:00:00" }];
    const occ = projectLeagueSlots(slots, "2026-09-28", 1, 60);
    expect(occ).toHaveLength(2); // 23:00 y 00:00
    const hours = occ.map((o) => o.date.getHours()).sort((a, b) => a - b);
    expect(hours).toEqual([0, 23]);
  });

  it("proyecta la cantidad de semanas pedida", () => {
    const slots = [{ court_id: "cancha1", dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "20:00:00" }];
    const occ = projectLeagueSlots(slots, "2026-09-28", 3, 60);
    expect(occ).toHaveLength(3); // un turno por semana, 3 semanas
  });
});

describe("buildLeagueSchedule", () => {
  const slots = [{ court_id: "cancha1", dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "23:00:00" }];
  const startDate = "2026-09-28"; // lunes

  it("nunca agenda dos partidos de un mismo equipo el mismo día calendario", () => {
    const queue = [
      { id: "m1", team1_id: "A", team2_id: "B" },
      { id: "m2", team1_id: "A", team2_id: "C" },
    ];
    const { assignments } = buildLeagueSchedule([queue], slots, 60, startDate);
    const daysForA = assignments
      .filter((a) => ["m1", "m2"].includes(a.matchId))
      .map((a) => a.scheduledAt.slice(0, 10));
    expect(new Set(daysForA).size).toBe(2); // cada uno en un día distinto
  });

  it("respeta los partidos ya agendados a mano al calcular qué día ya ocupa cada equipo", () => {
    const queue = [{ id: "m1", team1_id: "A", team2_id: "B" }];
    // A ya tiene un partido agendado el lunes 28/09 a mano -- el nuevo partido de A no puede
    // caer ESE MISMO día calendario, aunque sea a otra hora.
    const alreadyScheduled = [{ court_id: "cancha1", scheduled_at: "2026-09-28T22:00:00.000Z", team1_id: "A", team2_id: "X" }];
    const { assignments } = buildLeagueSchedule([queue], slots, 60, startDate, alreadyScheduled);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].scheduledAt.slice(0, 10)).not.toBe("2026-09-28");
  });

  it("no agenda un partido dentro del rango de ausencia de un equipo", () => {
    const queue = [{ id: "m1", team1_id: "A", team2_id: "B" }];
    // A no puede jugar ningún lunes de las primeras 2 semanas -- el próximo lunes disponible
    // para él cae en la 3ra semana.
    const unavailability = [{ team_id: "A", start_date: "2026-09-28", end_date: "2026-10-05" }];
    const { assignments, unscheduledCount } = buildLeagueSchedule([queue], slots, 60, startDate, [], [], [], unavailability);
    expect(unscheduledCount).toBe(0);
    expect(assignments[0].scheduledAt.slice(0, 10)).toBe("2026-10-12");
  });

  it("no agenda un partido fuera de la franja horaria de un equipo restringido", () => {
    const queue = [{ id: "m1", team1_id: "A", team2_id: "B" }];
    // A solo puede jugar los martes -- la única franja cargada es de lunes.
    const availability = [{ team_id: "A", dia_semana: 2, hora_inicio: "19:00:00", hora_fin: "22:00:00" }];
    const { assignments, unscheduledCount } = buildLeagueSchedule([queue], slots, 60, startDate, [], [], availability);
    expect(assignments).toHaveLength(0);
    expect(unscheduledCount).toBe(1);
  });

  it("va rotando entre categorías en vez de vaciar una antes de tocar la otra", () => {
    const catA = [{ id: "a1", team1_id: "A1", team2_id: "A2" }, { id: "a2", team1_id: "A3", team2_id: "A4" }];
    const catB = [{ id: "b1", team1_id: "B1", team2_id: "B2" }];
    const { assignments } = buildLeagueSchedule([catA, catB], slots, 60, startDate);
    // El primer turno que se llena debería tomar un partido de la categoría A (primera en la
    // rotación) y el segundo turno (mismo horario, misma cancha no alcanza -- pero la
    // siguiente ocurrencia cronológica) debería alternar hacia la categoría B en vez de
    // agotar la cola de A primero.
    const order = assignments.map((a) => (a.matchId.startsWith("a") ? "A" : "B"));
    expect(order[0]).toBe("A");
    expect(order).toContain("B");
  });
});
