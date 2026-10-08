import { describe, expect, it } from "vitest";
import { VISIBLE_DAYS, addDays, firstRescheduleDay, lastVisibleDay } from "./visible-days";

describe("visible-days", () => {
  it("el público ve hoy y mañana: son 2 días", () => {
    expect(VISIBLE_DAYS).toBe(2);
    expect(lastVisibleDay("2026-10-08")).toBe("2026-10-09");
  });

  it("se reacomoda desde pasado mañana, justo después de los días visibles", () => {
    expect(firstRescheduleDay("2026-10-08")).toBe("2026-10-10");
  });

  it("cruza fin de mes y de año sin problemas", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(firstRescheduleDay("2026-12-31")).toBe("2027-01-02");
    expect(lastVisibleDay("2026-02-28")).toBe("2026-03-01");
  });
});
