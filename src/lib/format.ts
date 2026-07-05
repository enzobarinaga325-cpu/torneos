function formatDay(dateStr: string): { day: number; month: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return { day: d, month: dt.toLocaleDateString("es-AR", { month: "long" }) };
}

/** "9 al 12 de julio de 2026", o un solo día si no hay fecha de fin (o son iguales). */
export function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = formatDay(start);
  const year = start.slice(0, 4);
  if (!end || end === start) return `${s.day} de ${s.month} de ${year}`;
  const e = formatDay(end);
  if (s.month === e.month) return `${s.day} al ${e.day} de ${s.month} de ${year}`;
  return `${s.day} de ${s.month} al ${e.day} de ${e.month} de ${year}`;
}
