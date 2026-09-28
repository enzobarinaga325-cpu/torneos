/**
 * Reemplazo mínimo de `supabase` para tests: nunca toca la red ni una base de datos real.
 * Cada tabla se sirve desde `fixtures` (vos controlás exactamente qué devuelve cada select,
 * así que ignora los filtros .eq/.in/.not/.order — total, en el test ya sembraste los datos
 * ya filtrados). Los `.update()` se registran en `writes` para poder verificar qué se
 * escribió, sin escribir nada de verdad en ningún lado.
 */
export type Fixtures = Record<string, unknown[]>;
export type RecordedWrite = { table: string; type: "insert" | "update" | "delete"; payload: unknown; filters: Record<string, unknown> };

export function createSupabaseMock(fixtures: Fixtures) {
  const writes: RecordedWrite[] = [];

  function makeQuery(table: string) {
    const filters: Record<string, unknown> = {};
    let singleMode = false;
    let pendingWrite: { type: "insert" | "update" | "delete"; payload: unknown } | null = null;

    // Tipado laxo a propósito: esto imita apenas la porción de la interfaz fluida de
    // supabase-js que usan `repair-schedule.ts`/`fill-gaps.ts` (encadenar filtros y, al
    // final, poder hacerle `await`), no el tipo genérico completo de `PromiseLike`.
    const query: any = {
      select: () => query,
      eq: (col: string, val: unknown) => { filters[col] = val; return query; },
      in: (col: string, vals: unknown) => { filters[col] = vals; return query; },
      not: () => query,
      is: () => query,
      order: () => query,
      maybeSingle: () => { singleMode = true; return query; },
      update: (payload: unknown) => { pendingWrite = { type: "update", payload }; return query; },
      insert: (payload: unknown) => { pendingWrite = { type: "insert", payload }; return query; },
      delete: () => { pendingWrite = { type: "delete", payload: null }; return query; },
      then: (resolve: (v: { data: unknown; error: null }) => void) => {
        if (pendingWrite) {
          writes.push({ table, ...pendingWrite, filters: { ...filters } });
          resolve({ data: null, error: null });
          return;
        }
        const rows = fixtures[table] ?? [];
        resolve({ data: singleMode ? (rows[0] ?? null) : rows, error: null });
      },
    };
    return query;
  }

  const supabase = { from: (table: string) => makeQuery(table) };
  return { supabase, writes };
}
