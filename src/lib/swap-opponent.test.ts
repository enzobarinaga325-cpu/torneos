import { describe, expect, it } from "vitest";
import type { Match, Team } from "./types";
import { swapOptions } from "./swap-opponent";

// Siempre en hora local, así los tests no dependen de la zona horaria de la máquina.
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).toISOString();

function mk(id: string, t1: string, t2: string, day: number, hour: number, overrides: Partial<Match> = {}): Match {
  return {
    id, category_id: "c1", stage: "liga", zone_id: null, round_name: null, round_order: null, position: 0,
    team1_id: t1, team2_id: t2, court_id: "court1", scheduled_at: at(day, hour), auto_scheduled: true,
    set1_team1: null, set1_team2: null, set2_team1: null, set2_team2: null, set3_team1: null, set3_team2: null,
    winner_id: null, next_match_id: null, next_match_slot: null, created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const teams: Record<string, Team> = Object.fromEntries(
  ["F", "X", "Y", "Z"].map((id) => [id, { id, name: `Pareja ${id}` } as Team]),
);

// F juega contra X el día 5 a las 19 y contra Y el día 6 a las 19.
const base = [mk("A", "F", "X", 5, 19), mk("B", "F", "Y", 6, 19)];
const run = (matches: Match[], avail: any[] = [], unavail: any[] = []) =>
  swapOptions(matches[0], "F", matches, teams, 60, avail, unavail);

describe("swapOptions", () => {
  it("ofrece cambiar a X por Y cuando a nadie le molesta", () => {
    const opts = run(base);
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({ matchId: "B", opponentName: "Pareja Y", scheduledAt: at(6, 19) });
  });

  it("no ofrece el cambio si la pareja que entra ya juega otro partido ese día", () => {
    // Y ya juega contra Z el día 5 (el día del partido A, al que pasaría a jugar).
    expect(run([...base, mk("C", "Y", "Z", 5, 21)])).toEqual([]);
  });

  it("no ofrece el cambio si la pareja que sale ya juega otro partido en el día nuevo", () => {
    // X ya juega contra Z el día 6 (el día del partido B, al que pasaría a jugar).
    expect(run([...base, mk("C", "X", "Z", 6, 21)])).toEqual([]);
  });

  it("cuenta también los partidos ya jugados de ese día", () => {
    expect(run([...base, mk("C", "Y", "Z", 5, 17, { winner_id: "Y", set1_team1: 6, set1_team2: 0 })])).toEqual([]);
  });

  it("un partido de otro día no molesta", () => {
    expect(run([...base, mk("C", "Y", "Z", 7, 19)])).toHaveLength(1);
  });

  it("no ofrece el cambio si la pareja no puede jugar en ese horario", () => {
    // X solo puede los días de semana del día 5 -- el día 6 es otro día de la semana.
    const dowOf5 = new Date(2026, 9, 5).getDay();
    const avail = [{ team_id: "X", dia_semana: dowOf5, hora_inicio: "18:00", hora_fin: "23:00" }];
    expect(run(base, avail)).toEqual([]);
  });

  it("ofrece el cambio si el horario nuevo cae dentro de la disponibilidad", () => {
    const dowOf6 = new Date(2026, 9, 6).getDay();
    const avail = [{ team_id: "X", dia_semana: dowOf6, hora_inicio: "18:00", hora_fin: "23:00" }];
    expect(run(base, avail)).toHaveLength(1);
  });

  it("no ofrece el cambio si la pareja tiene cargada esa fecha como no disponible", () => {
    const y = (d: number) => `2026-10-${String(d).padStart(2, "0")}`;
    expect(run(base, [], [{ team_id: "Y", start_date: y(5), end_date: y(5) }])).toEqual([]);
    expect(run(base, [], [{ team_id: "X", start_date: y(6), end_date: y(6) }])).toEqual([]);
  });

  it("ignora partidos ya jugados, de otra zona o de otra etapa", () => {
    const played = mk("B", "F", "Y", 6, 19, { winner_id: "F" });
    expect(run([base[0], played])).toEqual([]);
    expect(run([base[0], mk("B", "F", "Y", 6, 19, { zone_id: "z2" })])).toEqual([]);
    expect(run([base[0], mk("B", "F", "Y", 6, 19, { stage: "zona" })])).toEqual([]);
  });
});
