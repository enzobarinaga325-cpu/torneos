import type { ScheduleBlackout, TeamAvailability, TeamUnavailability } from "./types";
import { isBlackedOut, isTeamAvailable, isTeamAvailableOnDate, slotKey, type ExistingSchedule, type ScheduleAssignment } from "./tournament-logic";
import { projectLeagueSlots, type CourtSlot, type LeagueMatchInput } from "./league-logic";
import { localDateStr } from "./format";

export type OptimizeOptions = {
  seed?: number;
  /** Cantidad de intentos de mejora. Por defecto se calcula según la cantidad de partidos. */
  iterations?: number;
  /** Tope de tiempo para no trabar la pantalla (se devuelve lo mejor que se encontró hasta ahí). */
  maxMillis?: number;
  /** No agendar nada antes de este día "YYYY-MM-DD" (por ejemplo, hoy). Por defecto, la fecha de inicio. */
  earliestDate?: string;
  /** Partidos ya jugados por cada pareja: las que todavía no jugaron (o jugaron 1) tienen prioridad. */
  playedCounts?: Record<string, number>;
  /**
   * "Atrasadas primero" (por defecto, activado): dentro de cada grupo (cada cola de
   * `categoryQueues` = una zona o una categoría), las parejas que llevan menos partidos juegan
   * primero hasta alcanzar a las que más llevan, y las que van adelante esperan. Una vez que se
   * emparejan, siguen todas juntas. Las parejas que solo pueden jugar un día por semana no
   * marcan el ritmo de su grupo (si no, frenarían a todas las demás).
   */
  catchUp?: boolean;
};

// "Atrasadas primero": castigo por cada partido que juega una pareja llevando ventaja sobre la
// más atrasada de su grupo (al cuadrado de la ventaja), y por cada día que una pareja atrasada
// tarda en jugar los partidos que le faltan para alcanzar a las que más llevan.
const CATCH_UP_LEAD = 1000;
const CATCH_UP_LEAD_ONE = 0.1; // en unidades de CATCH_UP_LEAD: ir 1 adelante cuesta poco
const CATCH_UP_DEFICIT = 30;
const RESTRICTED_DEFICIT_FACTOR = 4;
// Esperas de más de 2 semanas entre partidos: castigo extra fuerte.
const LONG_WAIT_DAYS = 13;
const LONG_WAIT_FACTOR = 60;

const GAP_OK_DAYS = 8; // hasta acá un hueco entre partidos cuesta lo normal
const GAP_LONG_FACTOR = 4; // pasado ese umbral, cada día extra de espera se castiga más fuerte
const UNPLACED_PENALTY = 5000;
// Debutar tarde pesa mucho más que cualquier otro hueco: esperar el primer partido es lo que más molesta.
const DEBUT_FACTOR = 5;
const END_TIEBREAK = 0.02; // a igual regularidad, preferir terminar antes

function gapCost(g: number, longWaits: boolean): number {
  const extra = Math.max(0, g - GAP_OK_DAYS);
  const veryLong = longWaits ? Math.max(0, g - LONG_WAIT_DAYS) : 0;
  return g * g + GAP_LONG_FACTOR * extra * extra + LONG_WAIT_FACTOR * veryLong * veryLong;
}

function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Agenda los partidos de liga para que TODAS las parejas debuten lo antes posible y después
 * jueguen lo más seguido y parejo posible, respetando siempre las reglas duras: solo turnos
 * habilitados de la liga, ningún turno bloqueado, la disponibilidad horaria y los días no
 * disponibles de cada pareja, un solo partido por día por pareja y un solo partido por turno.
 *
 * Primero arma un calendario "greedy" (en cada turno juega el partido cuyas parejas van más
 * atrasadas y hace más que no juegan) y después lo mejora con recocido simulado (intercambios y
 * movidas de partidos) minimizando la suma de los huecos entre partidos de cada pareja al
 * cuadrado, con un castigo extra a los huecos largos y más peso a las parejas que todavía no
 * jugaron. El hueco "cero" de cada pareja es el inicio de la liga, así que debutar tarde también
 * cuesta. Con `catchUp` (por defecto) además prioriza a las parejas atrasadas de cada grupo
 * hasta que alcanzan a las que más partidos llevan (ver `OptimizeOptions.catchUp`).
 *
 * Misma firma y resultado que `buildLeagueSchedule`, pero devuelve un calendario bastante más
 * parejo. Es determinístico: la misma entrada da siempre el mismo calendario (semilla fija).
 */
export function optimizeLeagueSchedule(
  categoryQueues: LeagueMatchInput[][],
  slots: CourtSlot[],
  durationMinutes: number,
  startDate: string,
  alreadyScheduled: ExistingSchedule[] = [],
  blackouts: Pick<ScheduleBlackout, "date" | "court_id" | "hora_inicio">[] = [],
  availability: Pick<TeamAvailability, "team_id" | "dia_semana" | "hora_inicio" | "hora_fin">[] = [],
  unavailability: Pick<TeamUnavailability, "team_id" | "start_date" | "end_date">[] = [],
  options: OptimizeOptions = {},
): { assignments: ScheduleAssignment[]; unscheduledCount: number } {
  const matches = categoryQueues.flat();
  const N = matches.length;
  if (N === 0 || slots.length === 0) return { assignments: [], unscheduledCount: N };

  // ---------- turnos disponibles ----------
  const capacityPerWeek = slots.reduce((sum, s) => {
    const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
    const start = toMin(s.hora_inicio);
    let end = toMin(s.hora_fin);
    if (end <= start) end += 24 * 60;
    return sum + Math.floor((end - start) / durationMinutes);
  }, 0);
  if (capacityPerWeek <= 0) return { assignments: [], unscheduledCount: N };
  const startDn = dayNumber(startDate);
  const earliest = options.earliestDate && options.earliestDate > startDate ? options.earliestDate : startDate;
  const lateWeeks = Math.max(0, Math.ceil((dayNumber(earliest) - startDn) / 7));
  const weeksAhead = Math.ceil(N / capacityPerWeek) + 4 + lateWeeks;

  const occupied = new Set(alreadyScheduled.map((m) => slotKey(m.court_id, m.scheduled_at)));
  type Slot = { courtId: string; iso: string; dn: number };
  const sl: Slot[] = [];
  for (const o of projectLeagueSlots(slots, startDate, weeksAhead, durationMinutes)) {
    const iso = o.date.toISOString();
    const day = localDateStr(iso);
    if (day < earliest) continue;
    if (occupied.has(slotKey(o.courtId, iso))) continue;
    if (isBlackedOut(blackouts, o.courtId, iso)) continue;
    sl.push({ courtId: o.courtId, iso, dn: dayNumber(day) });
  }
  const S = sl.length;

  // ---------- parejas y días ya ocupados ----------
  const teamIdx = new Map<string, number>();
  const teamOf = (id: string) => {
    let i = teamIdx.get(id);
    if (i === undefined) { i = teamIdx.size; teamIdx.set(id, i); }
    return i;
  };
  const t1 = matches.map((m) => teamOf(m.team1_id));
  const t2 = matches.map((m) => teamOf(m.team2_id));
  const fixedDays: number[][] = [];
  for (const m of alreadyScheduled) {
    for (const id of [m.team1_id, m.team2_id]) {
      if (!id) continue;
      const t = teamOf(id);
      (fixedDays[t] ??= []).push(dayNumber(localDateStr(m.scheduled_at)));
    }
  }
  const T = teamIdx.size;
  for (let t = 0; t < T; t++) fixedDays[t] ??= [];
  const teamIds = [...teamIdx.keys()];
  const matchesOfTeam: number[][] = Array.from({ length: T }, () => []);
  for (let k = 0; k < N; k++) { matchesOfTeam[t1[k]].push(k); matchesOfTeam[t2[k]].push(k); }
  const played = options.playedCounts ?? {};
  const weight = teamIds.map((id) => { const c = played[id] ?? 0; return c === 0 ? 2 : c === 1 ? 1.5 : 1; });
  // El "partido cero" de cada pareja que todavía no jugó es el inicio de la liga: debutar tarde cuesta.
  const anchor = teamIds.map((id) => (played[id] ?? 0) === 0);

  // ---------- factibilidad de cada partido en cada turno ----------
  const feasCache = new Map<number, boolean>();
  const feas = (k: number, s: number): boolean => {
    const key = k * (S + 1) + s;
    let v = feasCache.get(key);
    if (v === undefined) {
      const iso = sl[s].iso;
      v = [matches[k].team1_id, matches[k].team2_id].every(
        (id) => isTeamAvailable(availability, id, iso, durationMinutes) && isTeamAvailableOnDate(unavailability, id, iso),
      );
      feasCache.set(key, v);
    }
    return v;
  };

  const slotOf = new Array<number>(N).fill(-1);
  const matchAt = new Array<number>(S).fill(-1);

  const dayTaken = (k: number, dn: number): boolean => {
    for (const t of [t1[k], t2[k]]) {
      if (fixedDays[t].includes(dn)) return true;
      for (const j of matchesOfTeam[t]) if (j !== k && slotOf[j] >= 0 && sl[slotOf[j]].dn === dn) return true;
    }
    return false;
  };

  // ---------- "atrasadas primero": grupos, cuántos lleva cada pareja y quién va atrás ----------
  const catchUp = options.catchUp ?? true;
  const earliestDn = dayNumber(earliest);
  const groupOf: number[] = [];
  categoryQueues.forEach((q, g) => q.forEach(() => groupOf.push(g)));
  const G = categoryQueues.length;
  const groupOfTeam = new Array<number>(T).fill(-1);
  for (let k = 0; k < N; k++) { groupOfTeam[t1[k]] = groupOf[k]; groupOfTeam[t2[k]] = groupOf[k]; }
  const teamsOfGroup: number[][] = Array.from({ length: G }, () => []);
  for (let t = 0; t < T; t++) if (groupOfTeam[t] >= 0) teamsOfGroup[groupOfTeam[t]].push(t);
  // Partidos que cada pareja ya tiene antes de la fecha desde la que se reparte (jugados o fijos).
  const initCnt = fixedDays.map((ds) => ds.filter((d) => d < earliestDn).length);
  // Partidos fijos (jugados o movidos a mano) que caen dentro de lo que se reparte, por grupo.
  const lockedInWindow: { dn: number; a: number; b: number }[][] = Array.from({ length: G }, () => []);
  for (const m of alreadyScheduled) {
    if (!m.team1_id || !m.team2_id) continue;
    const dn = dayNumber(localDateStr(m.scheduled_at));
    if (dn < earliestDn) continue;
    const a = teamIdx.get(m.team1_id)!, b = teamIdx.get(m.team2_id)!;
    const g = groupOfTeam[a] >= 0 ? groupOfTeam[a] : groupOfTeam[b];
    if (g >= 0) lockedInWindow[g].push({ dn, a, b });
  }
  const placeable = matches.map((_, k) => { for (let s = 0; s < S; s++) if (feas(k, s)) return true; return false; });
  const remInit = new Array<number>(T).fill(0);
  for (let g = 0; g < G; g++) for (const e of lockedInWindow[g]) { remInit[e.a]++; remInit[e.b]++; }
  for (let k = 0; k < N; k++) if (placeable[k]) { remInit[t1[k]]++; remInit[t2[k]]++; }
  // Parejas que solo pueden jugar un día de la semana: no marcan el ritmo de su grupo.
  const restricted = teamIds.map((id) => {
    const days = new Set<number>();
    for (const s of sl) {
      if (isTeamAvailable(availability, id, s.iso, durationMinutes)) days.add(new Date(s.iso).getDay());
      if (days.size > 1) return false;
    }
    return days.size <= 1;
  });
  const groupMax = teamsOfGroup.map((ts) => ts.filter((t) => !restricted[t]).reduce((x, t) => Math.max(x, initCnt[t]), 0));
  const matchesOfGroup: number[][] = Array.from({ length: G }, () => []);
  for (let k = 0; k < N; k++) matchesOfGroup[groupOf[k]].push(k);

  const groupCost = (g: number): number => {
    if (!catchUp) return 0;
    const ev = [...lockedInWindow[g]];
    for (const k of matchesOfGroup[g]) if (slotOf[k] >= 0) ev.push({ dn: sl[slotOf[k]].dn, a: t1[k], b: t2[k] });
    ev.sort((x, y) => x.dn - y.dn);
    const ts = teamsOfGroup[g];
    const cnt = new Map(ts.map((t) => [t, initCnt[t]]));
    const rem = new Map(ts.map((t) => [t, remInit[t]]));
    let lead = 0;
    let deficit = 0;
    let i = 0;
    while (i < ev.length) {
      const dn = ev[i].dn;
      let zmin = Infinity;
      for (const t of ts) if (!restricted[t] && rem.get(t)! > 0 && cnt.get(t)! < zmin) zmin = cnt.get(t)!;
      let j = i;
      while (j < ev.length && ev[j].dn === dn) {
        const vsRestricted = restricted[ev[j].a] || restricted[ev[j].b];
        for (const t of [ev[j].a, ev[j].b]) {
          const c = cnt.get(t) ?? 0;
          if (c < groupMax[g]) deficit += (restricted[t] ? RESTRICTED_DEFICIT_FACTOR : 1) * (dn - earliestDn);
          if (restricted[t]) continue;
          const l = c - zmin;
          // Llevar 1 de ventaja es normal (alguien tiene que jugar primero); 2 o más, no.
          if (l > 0 && !vsRestricted) lead += l === 1 ? CATCH_UP_LEAD_ONE : l * l;
        }
        j++;
      }
      for (let q = i; q < j; q++) for (const t of [ev[q].a, ev[q].b]) { cnt.set(t, (cnt.get(t) ?? 0) + 1); rem.set(t, (rem.get(t) ?? 0) - 1); }
      i = j;
    }
    return CATCH_UP_LEAD * lead + CATCH_UP_DEFICIT * deficit;
  };

  // ---------- 1) calendario inicial "greedy": juegan primero las parejas más atrasadas y las que hace más que no juegan ----------
  const lastDn = teamIds.map((_, t) => {
    const past = fixedDays[t].filter((d) => d <= (sl[0]?.dn ?? startDn));
    return past.length ? Math.max(...past) : startDn;
  });
  const cntNow = initCnt.slice();
  const behind = (t: number) => (catchUp && groupOfTeam[t] >= 0 ? Math.max(0, groupMax[groupOfTeam[t]] - cntNow[t]) : 0);
  let remaining = N;
  const unplaced = new Set<number>(matches.map((_, k) => k));
  for (let s = 0; s < S && remaining > 0; s++) {
    let best = -1;
    let bestScore = -Infinity;
    for (const k of unplaced) {
      if (!feas(k, s) || dayTaken(k, sl[s].dn)) continue;
      const score = 10 * (behind(t1[k]) + behind(t2[k])) + (sl[s].dn - lastDn[t1[k]]) + (sl[s].dn - lastDn[t2[k]]);
      if (score > bestScore) { bestScore = score; best = k; }
    }
    if (best < 0) continue;
    slotOf[best] = s;
    matchAt[s] = best;
    lastDn[t1[best]] = lastDn[t2[best]] = sl[s].dn;
    cntNow[t1[best]]++; cntNow[t2[best]]++;
    unplaced.delete(best);
    remaining--;
  }

  // ---------- 2) mejora por recocido simulado ----------
  const teamCost = (t: number): number => {
    const days = [...fixedDays[t]];
    if (anchor[t]) days.push(startDn);
    for (const k of matchesOfTeam[t]) if (slotOf[k] >= 0) days.push(sl[slotOf[k]].dn);
    days.sort((a, b) => a - b);
    let c = 0;
    for (let i = 1; i < days.length; i++) c += gapCost(days[i] - days[i - 1], catchUp) * (i === 1 && anchor[t] ? DEBUT_FACTOR : 1);
    return c * weight[t];
  };
  const matchCost = (k: number): number =>
    slotOf[k] >= 0 ? END_TIEBREAK * (sl[slotOf[k]].dn - startDn) : placeable[k] ? UNPLACED_PENALTY * (catchUp ? 10 : 1) : UNPLACED_PENALTY;
  /** Costo de las parejas y los grupos que tocan los partidos `ks` (para comparar antes/después de una movida). */
  const localCost = (ks: number[]): number => {
    const teams = new Set<number>();
    const groups = new Set<number>();
    for (const k of ks) { teams.add(t1[k]); teams.add(t2[k]); groups.add(groupOf[k]); }
    let c = 0;
    for (const t of teams) c += teamCost(t);
    for (const g of groups) c += groupCost(g);
    for (const k of ks) c += matchCost(k);
    return c;
  };

  const rnd = mulberry32(options.seed ?? 1);
  const iterations = options.iterations ?? Math.min(2_500_000, Math.max(200_000, N * 6000));
  const maxMillis = options.maxMillis ?? 3000;
  const t0 = Date.now();

  let cur = 0;
  for (let t = 0; t < T; t++) cur += teamCost(t);
  for (let g = 0; g < G; g++) cur += groupCost(g);
  for (let k = 0; k < N; k++) cur += matchCost(k);
  let best = cur;
  let bestSlotOf = slotOf.slice();
  const free: number[] = [];
  for (let s = 0; s < S; s++) if (matchAt[s] === -1) free.push(s);
  const freePos = new Map(free.map((s, p) => [s, p]));
  const T0 = 40;
  const T1 = 0.08;

  for (let it = 0; it < iterations; it++) {
    if ((it & 4095) === 0 && Date.now() - t0 > maxMillis) break;
    const temp = T0 * Math.pow(T1 / T0, it / iterations);
    const a = Math.floor(rnd() * N);
    if (rnd() < 0.75 || free.length === 0) {
      const b = Math.floor(rnd() * N);
      if (a === b) continue;
      const sa = slotOf[a];
      const sb = slotOf[b];
      if (sa < 0 || sb < 0 || !feas(a, sb) || !feas(b, sa)) continue;
      const before = localCost([a, b]);
      slotOf[a] = sb; slotOf[b] = sa; matchAt[sa] = b; matchAt[sb] = a;
      const clash = dayTaken(a, sl[sb].dn) || dayTaken(b, sl[sa].dn);
      const d = clash ? 0 : localCost([a, b]) - before;
      if (clash || (d > 0 && rnd() >= Math.exp(-d / temp))) {
        slotOf[a] = sa; slotOf[b] = sb; matchAt[sa] = a; matchAt[sb] = b;
        continue;
      }
      cur += d;
    } else {
      const sf = free[Math.floor(rnd() * free.length)];
      const sa = slotOf[a];
      if (!feas(a, sf)) continue;
      const before = localCost([a]);
      slotOf[a] = sf; matchAt[sf] = a; if (sa >= 0) matchAt[sa] = -1;
      const clash = dayTaken(a, sl[sf].dn);
      const d = clash ? 0 : localCost([a]) - before;
      if (clash || (d > 0 && rnd() >= Math.exp(-d / temp))) {
        slotOf[a] = sa; matchAt[sf] = -1; if (sa >= 0) matchAt[sa] = a;
        continue;
      }
      // el turno que dejó `a` queda libre y el que ocupó deja de estarlo
      const p = freePos.get(sf)!;
      if (sa >= 0) { free[p] = sa; freePos.set(sa, p); } else { const last = free.pop()!; if (last !== sf) { free[p] = last; freePos.set(last, p); } }
      freePos.delete(sf);
      cur += d;
    }
    if (cur < best) { best = cur; bestSlotOf = slotOf.slice(); }
  }

  const assignments: ScheduleAssignment[] = [];
  let unscheduledCount = 0;
  for (let k = 0; k < N; k++) {
    const s = bestSlotOf[k];
    if (s < 0) { unscheduledCount++; continue; }
    assignments.push({ matchId: matches[k].id, courtId: sl[s].courtId, scheduledAt: sl[s].iso });
  }
  return { assignments, unscheduledCount };
}
