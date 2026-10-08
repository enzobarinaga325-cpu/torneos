import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock, type Fixtures } from "./test-utils/supabaseMock";

// `vi.mock` se hoistea automáticamente arriba de todo el archivo, así que `repairMatches`
// nunca ve el cliente real de Supabase -- todas las lecturas/escrituras van al mock en
// memoria de más abajo. Ningún test acá toca la red ni una base de datos real.
let current: ReturnType<typeof createSupabaseMock>;
vi.mock("./supabase", () => ({
  get supabase() {
    return current.supabase;
  },
}));

const { repairMatches } = await import("./repair-schedule");

const TOURNAMENT_ID = "t1";
const COURT = "c1";

function baseFixtures(overrides: Partial<Fixtures> = {}): Fixtures {
  return {
    tournaments: [{ default_match_minutes: 60, start_date: "2026-10-05" }],
    courts: [{ id: COURT }],
    tournament_days: [],
    horarios_liga: [],
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
    id: "m", category_id: "cat1", stage: "liga", court_id: COURT,
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

describe("repairMatches", () => {
  it("intercambia con el ocupante en vez de dejar un hueco donde estaba", () => {
    current = createSupabaseMock(baseFixtures({
      horarios_liga: [{ court_id: COURT, dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "21:00:00" }], // lunes 19 y 20hs
      team_availability: [{ team_id: "A", dia_semana: 1, hora_inicio: "20:00:00", hora_fin: "21:00:00" }],
      matches: [
        ligaMatch({ id: "mAB", team1_id: "A", team2_id: "B", scheduled_at: "2026-10-05T22:00:00.000Z" }), // lunes 19hs
        ligaMatch({ id: "mCD", team1_id: "C", team2_id: "D", scheduled_at: "2026-10-05T23:00:00.000Z" }), // lunes 20hs
      ],
    }));

    return repairMatches(TOURNAMENT_ID, ["mAB"]).then((result) => {
      expect(result).toEqual({ repaired: 1, unscheduled: 0 });
      const [abWrite] = writesFor("mAB");
      const [cdWrite] = writesFor("mCD");
      expect((abWrite.payload as any).scheduled_at).toBe("2026-10-05T23:00:00.000Z"); // A pasa a las 20hs (su única franja)
      expect((cdWrite.payload as any).scheduled_at).toBe("2026-10-05T22:00:00.000Z"); // C/D hereda el lugar que dejó A
      expect((abWrite.payload as any).auto_scheduled).toBe(true);
      expect((cdWrite.payload as any).auto_scheduled).toBe(true);
    });
  });

  it("nunca ofrece de vuelta un turno que ya no es válido en la configuración actual (regresión)", () => {
    // Bug real: el horario de miércoles se achicó a un solo turno (22hs). mX quedó en un
    // horario viejo (19hs) que ya no existe en la config actual. Al repararlo, NO puede
    // intercambiarse con mY (que sí está en un turno válido, 22hs) porque eso mandaría a mY
    // a un turno inválido -- tiene que caer a un turno libre real en cambio.
    current = createSupabaseMock(baseFixtures({
      horarios_liga: [{ court_id: COURT, dia_semana: 3, hora_inicio: "22:00:00", hora_fin: "23:00:00" }], // miércoles, un solo turno
      matches: [
        ligaMatch({ id: "mX", team1_id: "X1", team2_id: "X2", scheduled_at: "2026-10-07T22:00:00.000Z" }), // miércoles 19hs -- YA NO es válido
        ligaMatch({ id: "mY", team1_id: "Y1", team2_id: "Y2", scheduled_at: "2026-10-08T01:00:00.000Z" }), // miércoles 22hs -- el único turno válido de esta semana
      ],
    }));

    return repairMatches(TOURNAMENT_ID, ["mX"]).then(() => {
      const [yWrite] = writesFor("mY");
      const [xWrite] = writesFor("mX");
      // mY nunca se tocó (no hubo intercambio) -- sigue en su turno válido.
      expect(yWrite).toBeUndefined();
      // mX cae al próximo turno libre real (el miércoles de la semana siguiente), nunca al
      // horario viejo inválido.
      expect((xWrite.payload as any).scheduled_at).not.toBe("2026-10-07T22:00:00.000Z");
      expect((xWrite.payload as any).scheduled_at).toBe("2026-10-15T01:00:00.000Z");
    });
  });

  it("no deja que el partido reparado se autoexima de la regla de un partido por día (regresión)", () => {
    // Bug real: un chequeo pensado solo para que el que se intercambia no se autobloquee
    // terminaba tapando un choque de verdad -- una pareja con OTRO partido real ese mismo
    // día. mM ya juega el lunes a las 20hs (m1, sin tocar); m2 (de la MISMA pareja M) se
    // repara y NUNCA debería terminar el lunes también, tiene que irse al martes.
    current = createSupabaseMock(baseFixtures({
      horarios_liga: [
        { court_id: COURT, dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "23:00:00" }, // lunes 19,20,21,22
        { court_id: COURT, dia_semana: 2, hora_inicio: "19:00:00", hora_fin: "20:00:00" }, // martes 19
      ],
      matches: [
        ligaMatch({ id: "m1", team1_id: "M", team2_id: "N", scheduled_at: "2026-10-05T23:00:00.000Z" }), // lunes 20hs, sin tocar
        ligaMatch({ id: "m2", team1_id: "M", team2_id: "P", scheduled_at: "2026-10-06T00:00:00.000Z" }), // lunes 21hs, a reparar
      ],
    }));

    return repairMatches(TOURNAMENT_ID, ["m2"]).then(() => {
      const [m2Write] = writesFor("m2");
      const newDate = new Date((m2Write.payload as any).scheduled_at);
      expect(newDate.getDay()).not.toBe(1); // nunca lunes de nuevo
      expect((m2Write.payload as any).scheduled_at).toBe("2026-10-06T22:00:00.000Z"); // martes 19hs
    });
  });

  it("nunca mueve ni usa como intercambio un partido que el admin movió a mano", () => {
    current = createSupabaseMock(baseFixtures({
      horarios_liga: [{ court_id: COURT, dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "21:00:00" }],
      team_availability: [{ team_id: "A", dia_semana: 1, hora_inicio: "20:00:00", hora_fin: "21:00:00" }],
      matches: [
        ligaMatch({ id: "mAB", team1_id: "A", team2_id: "B", scheduled_at: "2026-10-05T22:00:00.000Z" }),
        ligaMatch({ id: "mCD", team1_id: "C", team2_id: "D", scheduled_at: "2026-10-05T23:00:00.000Z", auto_scheduled: false }),
      ],
    }));

    return repairMatches(TOURNAMENT_ID, ["mAB"]).then((result) => {
      expect(writesFor("mCD")).toHaveLength(0); // jamás se toca el partido movido a mano
      const [abWrite] = writesFor("mAB");
      // Al no poder intercambiar, cae al próximo turno libre real: la semana siguiente.
      expect((abWrite.payload as any).scheduled_at).toBe("2026-10-12T23:00:00.000Z");
      expect(result.repaired).toBe(1);
    });
  });

  it("si no hay ningún turno válido, el partido queda sin agendar en vez de forzarlo", () => {
    current = createSupabaseMock(baseFixtures({
      horarios_liga: [{ court_id: COURT, dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "20:00:00" }],
      matches: [
        ligaMatch({ id: "mAB", team1_id: "A", team2_id: "B", scheduled_at: "2026-10-05T22:00:00.000Z" }),
      ],
      // Bloquea TODO ese único turno semanal, todas las semanas -- no queda ningún hueco.
      schedule_blackouts: Array.from({ length: 20 }, (_, w) => ({
        date: new Date(2026, 9, 5 + w * 7).toISOString().slice(0, 10),
        court_id: null,
        hora_inicio: null,
      })),
    }));

    return repairMatches(TOURNAMENT_ID, ["mAB"]).then((result) => {
      const [abWrite] = writesFor("mAB");
      expect((abWrite.payload as any).scheduled_at).toBeNull();
      expect((abWrite.payload as any).court_id).toBeNull();
      expect(result.unscheduled).toBe(1);
      expect(result.repaired).toBe(0);
    });
  });
});

describe("repairMatches con notBefore (reacomodar después de los días visibles)", () => {
  const MONDAYS = [{ court_id: COURT, dia_semana: 1, hora_inicio: "19:00:00", hora_fin: "21:00:00" }]; // lunes 19 y 20hs

  it("no usa ningún turno anterior a la fecha, aunque haya uno libre antes", () => {
    current = createSupabaseMock(baseFixtures({
      horarios_liga: MONDAYS,
      matches: [ligaMatch({ id: "mX", team1_id: "X1", team2_id: "X2", scheduled_at: "2026-10-05T22:00:00.000Z" })], // lunes 5, 19hs
    }));

    return repairMatches(TOURNAMENT_ID, ["mX"], { notBefore: "2026-10-12" }).then((result) => {
      const [write] = writesFor("mX");
      expect((write.payload as any).scheduled_at).toBe("2026-10-12T22:00:00.000Z"); // lunes 12, 19hs: el primer turno permitido
      expect(result).toEqual({ repaired: 1, unscheduled: 0 });
    });
  });

  it("sin notBefore sigue usando el turno libre más cercano (comportamiento de siempre)", () => {
    current = createSupabaseMock(baseFixtures({
      horarios_liga: MONDAYS,
      matches: [ligaMatch({ id: "mX", team1_id: "X1", team2_id: "X2", scheduled_at: "2026-10-05T22:00:00.000Z" })],
    }));

    return repairMatches(TOURNAMENT_ID, ["mX"]).then(() => {
      const [write] = writesFor("mX");
      expect(new Date((write.payload as any).scheduled_at).getTime()).toBeLessThan(new Date("2026-10-12T00:00:00.000Z").getTime());
    });
  });

  it("no le regala por intercambio a otro partido el turno que queda libre dentro de los días protegidos", () => {
    // mAB (lunes 5, 19hs) se suspende. Sin notBefore, mCD (lunes 5, 20hs) se cambiaría con él y
    // pasaría a las 19hs -- moviendo un partido de un día que el público ya ve. Con notBefore el
    // lunes 5 no se toca: mCD queda quieto y mAB se va a un turno libre desde el 12.
    current = createSupabaseMock(baseFixtures({
      horarios_liga: MONDAYS,
      team_availability: [{ team_id: "A", dia_semana: 1, hora_inicio: "20:00:00", hora_fin: "21:00:00" }],
      matches: [
        ligaMatch({ id: "mAB", team1_id: "A", team2_id: "B", scheduled_at: "2026-10-05T22:00:00.000Z" }),
        ligaMatch({ id: "mCD", team1_id: "C", team2_id: "D", scheduled_at: "2026-10-05T23:00:00.000Z" }),
      ],
    }));

    return repairMatches(TOURNAMENT_ID, ["mAB"], { notBefore: "2026-10-06" }).then(() => {
      expect(writesFor("mCD")).toHaveLength(0);
      const [abWrite] = writesFor("mAB");
      expect((abWrite.payload as any).scheduled_at).toBe("2026-10-12T23:00:00.000Z"); // lunes 12, 20hs (la única franja de A)
    });
  });

  it("sí intercambia cuando el partido y el turno que deja están fuera de los días protegidos", () => {
    current = createSupabaseMock(baseFixtures({
      horarios_liga: MONDAYS,
      team_availability: [{ team_id: "A", dia_semana: 1, hora_inicio: "20:00:00", hora_fin: "21:00:00" }],
      matches: [
        ligaMatch({ id: "mAB", team1_id: "A", team2_id: "B", scheduled_at: "2026-10-12T22:00:00.000Z" }), // lunes 12, 19hs
        ligaMatch({ id: "mCD", team1_id: "C", team2_id: "D", scheduled_at: "2026-10-12T23:00:00.000Z" }), // lunes 12, 20hs
      ],
    }));

    return repairMatches(TOURNAMENT_ID, ["mAB"], { notBefore: "2026-10-06" }).then(() => {
      const [abWrite] = writesFor("mAB");
      const [cdWrite] = writesFor("mCD");
      expect((abWrite.payload as any).scheduled_at).toBe("2026-10-12T23:00:00.000Z");
      expect((cdWrite.payload as any).scheduled_at).toBe("2026-10-12T22:00:00.000Z");
    });
  });

  it("nunca toca un partido de los días protegidos, aunque se esté reacomodando otro", () => {
    // mKeep está hoy (lunes 5, 19hs) y no se menciona: tiene que quedar exactamente igual.
    current = createSupabaseMock(baseFixtures({
      horarios_liga: MONDAYS,
      matches: [
        ligaMatch({ id: "mKeep", team1_id: "K1", team2_id: "K2", scheduled_at: "2026-10-05T22:00:00.000Z" }),
        ligaMatch({ id: "mMove", team1_id: "M1", team2_id: "M2", scheduled_at: "2026-10-05T23:00:00.000Z" }),
      ],
    }));

    return repairMatches(TOURNAMENT_ID, ["mMove"], { notBefore: "2026-10-07" }).then(() => {
      expect(writesFor("mKeep")).toHaveLength(0);
      expect(writesFor("mMove")).toHaveLength(1);
    });
  });
});
