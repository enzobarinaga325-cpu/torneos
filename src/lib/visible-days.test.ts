import { describe, expect, it } from "vitest";
import { PUBLIC_DAYS_AHEAD, VISIBLE_MATCH_DAYS, addDays, firstRescheduleDay, publicUpcomingDays, upcomingMatchDays, visibleUpcomingDays } from "./visible-days";

describe("visible-days", () => {
  it("el público ve hoy (si tiene partidos) y los próximos 2 días con partidos", () => {
    expect(VISIBLE_MATCH_DAYS).toBe(2);
    const days = ["2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12"];
    expect(visibleUpcomingDays(days, "2026-10-05")).toEqual(["2026-10-05", "2026-10-07", "2026-10-09"]);
  });

  it("viernes con partidos: ve viernes, lunes y martes (sábado y domingo sin partidos no cuentan)", () => {
    const days = ["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"];
    expect(visibleUpcomingDays(days, "2026-10-09")).toEqual(["2026-10-09", "2026-10-12", "2026-10-13"]);
  });

  it("si hoy no hay partidos, hoy no cuenta: ve los próximos 2 días con partidos", () => {
    const days = ["2026-10-07", "2026-10-09", "2026-10-12"];
    expect(visibleUpcomingDays(days, "2026-10-06")).toEqual(["2026-10-07", "2026-10-09"]);
    // Sábado sin partidos: lunes y martes.
    expect(visibleUpcomingDays(["2026-10-12", "2026-10-13", "2026-10-14"], "2026-10-10")).toEqual(["2026-10-12", "2026-10-13"]);
  });

  it("los días ya pasados no cuentan como próximos", () => {
    expect(upcomingMatchDays(["2026-10-01", "2026-10-02", "2026-10-06"], "2026-10-05")).toEqual(["2026-10-06"]);
  });

  it("al pasar un día, la ventana avanza al siguiente día con partidos", () => {
    const days = ["2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12"];
    expect(visibleUpcomingDays(days, "2026-10-05")).toEqual(["2026-10-05", "2026-10-07", "2026-10-09"]);
    expect(visibleUpcomingDays(days, "2026-10-06")).toEqual(["2026-10-07", "2026-10-09"]);
    expect(visibleUpcomingDays(days, "2026-10-07")).toEqual(["2026-10-07", "2026-10-09", "2026-10-12"]);
  });

  it("se reacomoda desde el día siguiente al último de los que se ven", () => {
    // Hoy viernes 9 con partidos: protegidos vie 9, lun 12, mar 13 -> se reacomoda desde mié 14.
    const days = ["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-15"];
    expect(firstRescheduleDay(days, "2026-10-09")).toBe("2026-10-14");
    // Si hoy se canceló (sin partidos hoy), hoy no cuenta: protegidos lun 12 y mar 13.
    expect(firstRescheduleDay(["2026-10-12", "2026-10-13", "2026-10-15"], "2026-10-09")).toBe("2026-10-14");
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
    expect(firstRescheduleDay(["2026-12-30", "2026-12-31", "2027-01-02"], "2026-12-30")).toBe("2027-01-03");
  });
});

describe("publicUpcomingDays (lo que ve la web pública)", () => {
  // oct 2026: lun 12, mar 13, mié 14, jue 15, vie 16, sáb 17, dom 18, lun 19
  const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19"];

  it("se ve hoy y mañana, nada más", () => {
    expect(PUBLIC_DAYS_AHEAD).toBe(1);
    expect(publicUpcomingDays(days, "2026-10-13")).toEqual(["2026-10-13", "2026-10-14"]);
  });

  it("el viernes solo se ve el viernes (el sábado no tiene partidos)", () => {
    expect(publicUpcomingDays(days, "2026-10-16")).toEqual(["2026-10-16"]);
  });

  it("el sábado no se ve el lunes; el domingo sí", () => {
    expect(publicUpcomingDays(days, "2026-10-17")).toEqual([]);
    expect(publicUpcomingDays(days, "2026-10-18")).toEqual(["2026-10-19"]);
  });

  it("si hoy no hay partidos, igual se ve mañana", () => {
    expect(publicUpcomingDays(["2026-10-14", "2026-10-15"], "2026-10-13")).toEqual(["2026-10-14"]);
  });
});
