import { describe, expect, it } from "vitest";
import { isWithinLeagueSlot } from "./slot-validation";

// Fechas armadas en hora local, igual que las ve la grilla.
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();

// Miércoles 21/10/2026: Cancha 1 sólo es de la liga de 21 a 23; Cancha 2 de 19 a 00.
// Martes: Cancha 1 de 20:30 a 00:30 (cruza la medianoche).
const slots = [
  { court_id: "c1", dia_semana: 3, hora_inicio: "21:00:00", hora_fin: "23:00:00" },
  { court_id: "c2", dia_semana: 3, hora_inicio: "19:00:00", hora_fin: "00:00:00" },
  { court_id: "c1", dia_semana: 2, hora_inicio: "20:30:00", hora_fin: "00:30:00" },
];

describe("isWithinLeagueSlot", () => {
  it("es de la liga si el partido entra completo en la franja de esa cancha", () => {
    expect(isWithinLeagueSlot(at(2026, 10, 21, 21), "c1", slots, 60)).toBe(true);
    expect(isWithinLeagueSlot(at(2026, 10, 21, 22), "c1", slots, 60)).toBe(true);
    expect(isWithinLeagueSlot(at(2026, 10, 21, 19), "c2", slots, 60)).toBe(true);
    expect(isWithinLeagueSlot(at(2026, 10, 21, 23), "c2", slots, 60)).toBe(true);
  });

  it("fuera de la franja de esa cancha es turno fijo, aunque otra cancha juegue a esa hora", () => {
    expect(isWithinLeagueSlot(at(2026, 10, 21, 19), "c1", slots, 60)).toBe(false);
    expect(isWithinLeagueSlot(at(2026, 10, 21, 20), "c1", slots, 60)).toBe(false);
    expect(isWithinLeagueSlot(at(2026, 10, 21, 22, 30), "c1", slots, 60)).toBe(false); // no termina antes de las 23
  });

  it("cuenta la madrugada de una franja del día anterior que cruza la medianoche", () => {
    expect(isWithinLeagueSlot(at(2026, 10, 21, 0, 0), "c1", slots, 30)).toBe(true); // martes 20:30 a 00:30
    expect(isWithinLeagueSlot(at(2026, 10, 21, 0, 0), "c1", slots, 60)).toBe(false);
  });

  it("sin franja cargada ese día, nada es de la liga", () => {
    expect(isWithinLeagueSlot(at(2026, 10, 22, 21), "c1", slots, 60)).toBe(false);
  });
});
