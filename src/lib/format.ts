export function todayStr(): string {
  return localDateStr(new Date());
}

/**
 * "YYYY-MM-DD" en hora LOCAL de quien mira la pantalla, no en UTC. `scheduled_at` se
 * guarda en UTC, y como Argentina está 3 horas atrás, cualquier partido de 21hs en
 * adelante (hora local) cae en el día siguiente en UTC — recortar el string ISO
 * directamente ("2026-07-07T21:00:00Z".slice(0,10)) le erraba el día por eso.
 */
export function localDateStr(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
