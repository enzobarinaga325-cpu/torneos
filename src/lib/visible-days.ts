import { localDateStr } from "./format";

/**
 * Cuántos días de partidos ve el público, contando hoy: hoy y mañana. Esos días ya están
 * "armados" y publicados, así que cuando el admin suspende un día o un partido, lo suspendido
 * se reacomoda recién DESPUÉS de esa ventana (ver `firstRescheduleDay`) -- así nunca se
 * mueven partidos que la gente ya vio.
 */
export const VISIBLE_DAYS = 2;

/** "YYYY-MM-DD" + n días, en calendario local (sin desfasajes de UTC). */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return localDateStr(new Date(y, m - 1, d + n));
}

/** Último día que ve el público, según `today`. Con 2 días: mañana. */
export function lastVisibleDay(today: string): string {
  return addDays(today, VISIBLE_DAYS - 1);
}

/** Primer día en el que se pueden reacomodar partidos suspendidos. Con 2 días: pasado mañana. */
export function firstRescheduleDay(today: string): string {
  return addDays(today, VISIBLE_DAYS);
}
