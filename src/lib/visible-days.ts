import { localDateStr } from "./format";

/**
 * Cuántos DÍAS CON PARTIDOS ve el público DESPUÉS de hoy (más hoy, si hoy hay partidos, y todos
 * los ya jugados). Cuenta días que de verdad tienen partidos agendados, no días de calendario:
 * el sábado y el domingo sin partidos no cuentan. Ej.: hoy viernes con partidos -> ve viernes,
 * lunes y martes. Esos días son los que ya están "armados", y cuando
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

/**
 * Los días con partidos que el público ve: hoy (si tiene partidos) más los próximos
 * VISIBLE_MATCH_DAYS días con partidos. Hoy no gasta ninguno de los 2.
 */
export function visibleUpcomingDays(matchDates: Iterable<string>, today: string): string[] {
  const upcoming = upcomingMatchDays(matchDates, today);
  const hasToday = upcoming[0] === today;
  return upcoming.slice(0, VISIBLE_MATCH_DAYS + (hasToday ? 1 : 0));
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
