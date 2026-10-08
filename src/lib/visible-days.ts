import { localDateStr } from "./format";

/**
 * Cuántos DÍAS CON PARTIDOS ve el público de lo que viene (más todos los ya jugados). Cuenta
 * días que de verdad tienen partidos agendados, no días de calendario: si hoy hay partidos,
 * mañana no y pasado sí, ve hoy y pasado. Esos días son los que ya están "armados", y cuando
 * el admin suspende un día o un partido, lo suspendido se reacomoda recién DESPUÉS de esos
 * (ver `firstRescheduleDay`) -- así nunca se mueve nada que la gente ya vio.
 */
export const VISIBLE_MATCH_DAYS = 2;

/** "YYYY-MM-DD" + n días, en calendario local (sin desfasajes de UTC). */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return localDateStr(new Date(y, m - 1, d + n));
}

/** Días con partidos de hoy en adelante, sin repetir y en orden. */
export function upcomingMatchDays(matchDates: Iterable<string>, today: string): string[] {
  return [...new Set(matchDates)].filter((d) => d >= today).sort();
}

/** Los próximos días con partidos que el público ve (hoy incluido si tiene partidos). */
export function visibleUpcomingDays(matchDates: Iterable<string>, today: string): string[] {
  return upcomingMatchDays(matchDates, today).slice(0, VISIBLE_MATCH_DAYS);
}

/**
 * Primer día en el que se pueden reacomodar partidos suspendidos: el día siguiente al último
 * de los que el público ve. `undefined` si no queda ningún día con partidos por delante (no
 * hay nada armado que proteger).
 */
export function firstRescheduleDay(matchDates: Iterable<string>, today: string): string | undefined {
  const visible = visibleUpcomingDays(matchDates, today);
  return visible.length === 0 ? undefined : addDays(visible[visible.length - 1], 1);
}
