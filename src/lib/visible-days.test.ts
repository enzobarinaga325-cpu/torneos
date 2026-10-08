import { describe, expect, it } from "vitest";
import { VISIBLE_MATCH_DAYS, addDays, firstRescheduleDay, upcomingMatchDays, visibleUpcomingDays } from "./visible-days";

describe("visible-days", () => {
  it("el público ve los próximos 2 días con partidos", () => {
    expect(VISIBLE_MATCH_DAYS).toBe(2);
    const days = ["2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12"];
    expect(visibleUpcomingDays(days, "2026-10-05")).toEqual(["2026-10-05", "2026-10-07"]);
  });

  it("cuenta días CON partidos, no días de calendario (los huecos sin partidos no cuentan)", () => {
    // Viernes con partidos, sábado y domingo sin nada, lunes con partidos.
    const days = ["2026-10-09", "2026-10-12", "2026-10-14"];
    expect(visibleUpcomingDays(days, "2026-10-09")).toEqual(["2026-10-09", "2026-10-12"]);
  });

  it("si hoy no hay partidos, hoy no cuenta: arranca desde el próximo día con partidos", () => {
    const days = ["2026-10-07", "2026-10-09", "2026-10-12"];
    expect(visibleUpcomingDays(days, "2026-10-06")).toEqual(["2026-10-07", "2026-10-09"]);
  });

  it("los días ya pasados no cuentan como próximos", () => {
    expect(upcomingMatchDays(["2026-10-01", "2026-10-02", "2026-10-06"], "2026-10-05")).toEqual(["2026-10-06"]);
  });

  it("al pasar un día, la ventana avanza al siguiente día con partidos", () => {
    const days = ["2026-10-05", "2026-10-07", "2026-10-09"];
    expect(visibleUpcomingDays(days, "2026-10-05")).toEqual(["2026-10-05", "2026-10-07"]);
    expect(visibleUpcomingDays(days, "2026-10-06")).toEqual(["2026-10-07", "2026-10-09"]);
  });

  it("se reacomoda desde el día siguiente al último de los 2 que se ven", () => {
    const days = ["2026-10-05", "2026-10-07", "2026-10-09"];
    expect(firstRescheduleDay(days, "2026-10-05")).toBe("2026-10-08");
  });

  it("repetidos en el mismo día cuentan una sola vez", () => {
    const days = ["2026-10-05", "2026-10-05", "2026-10-05", "2026-10-07", "2026-10-07"];
    expect(visibleUpcomingDays(days, "2026-10-05")).toEqual(["2026-10-05", "2026-10-07"]);
  });

  it("con un solo día por delante protege ese día; sin ninguno no protege nada", () => {
    expect(firstRescheduleDay(["2026-10-06"], "2026-10-05")).toBe("2026-10-07");
    expect(firstRescheduleDay(["2026-10-01"], "2026-10-05")).toBeUndefined();
    expect(firstRescheduleDay([], "2026-10-05")).toBeUndefined();
  });

  it("cruza fin de mes y de año sin problemas", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(firstRescheduleDay(["2026-12-30", "2026-12-31"], "2026-12-30")).toBe("2027-01-01");
  });
});
