import type { Match, ZoneStanding } from "./types";

/** Mezcla un array sin mutar el original (Fisher-Yates). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Reparte equipos en zonas de a `teamsPerZone` (la última zona puede quedar con
 * alguno de más si no divide exacto). Devuelve una propuesta editable, no escribe nada.
 */
export function proposeZones(teamIds: string[], teamsPerZone: number): { name: string; teamIds: string[] }[] {
  const shuffled = shuffle(teamIds);
  const numZones = Math.max(1, Math.round(shuffled.length / teamsPerZone));
  const zones: string[][] = Array.from({ length: numZones }, () => []);
  shuffled.forEach((id, i) => zones[i % numZones].push(id));
  return zones.map((ids, i) => ({ name: `Zona ${String.fromCharCode(65 + i)}`, teamIds: ids }));
}

/** Todos los partidos posibles dentro de una zona (todos contra todos, una vez). */
export function roundRobinPairs(teamIds: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) pairs.push([teamIds[i], teamIds[j]]);
  }
  return pairs;
}

/** Tabla de posiciones de una zona: partidos ganados, luego diferencia de sets. */
export function computeStandings(teamIds: string[], matches: Match[]): ZoneStanding[] {
  const table = new Map<string, ZoneStanding>();
  for (const id of teamIds) table.set(id, { team_id: id, played: 0, won: 0, lost: 0, sets_won: 0, sets_lost: 0, sets_diff: 0 });

  for (const m of matches) {
    if (m.team1_sets == null || m.team2_sets == null || !m.team1_id || !m.team2_id) continue;
    const t1 = table.get(m.team1_id);
    const t2 = table.get(m.team2_id);
    if (!t1 || !t2) continue;
    t1.played++; t2.played++;
    t1.sets_won += m.team1_sets; t1.sets_lost += m.team2_sets;
    t2.sets_won += m.team2_sets; t2.sets_lost += m.team1_sets;
    if (m.team1_sets > m.team2_sets) { t1.won++; t2.lost++; } else { t2.won++; t1.lost++; }
  }
  for (const t of table.values()) t.sets_diff = t.sets_won - t.sets_lost;

  return [...table.values()].sort((a, b) => b.won - a.won || b.sets_diff - a.sets_diff || b.sets_won - a.sets_won);
}

/** Orden de siembra estándar de un cuadro de N (potencia de 2): 1v N, ... clásico de torneos. */
function seedOrder(size: number): number[] {
  if (size === 1) return [1];
  const prev = seedOrder(size / 2);
  const result: number[] = [];
  for (const s of prev) {
    result.push(s);
    result.push(size + 1 - s);
  }
  return result;
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Nombre de la ronda según cuántos equipos entran a jugarla. */
export function roundName(teamsInRound: number): string {
  if (teamsInRound <= 2) return "Final";
  if (teamsInRound === 4) return "Semifinal";
  if (teamsInRound === 8) return "Cuartos de final";
  if (teamsInRound === 16) return "Octavos de final";
  if (teamsInRound === 32) return "Dieciseisavos de final";
  return `Ronda de ${teamsInRound}`;
}

export type BracketMatchPlan = {
  tempId: string;
  roundOrder: number;
  roundNameLabel: string;
  position: number;
  team1_id: string | null;
  team2_id: string | null;
  winner_id: string | null; // ya definido si es un walkover (bye)
  nextTempId: string | null;
  nextSlot: 1 | 2 | null;
};

/**
 * Arma el cuadro completo (todas las rondas) a partir de los clasificados de cada zona,
 * ya ordenados de mejor a peor dentro de su zona (posición 0 = 1° de la zona, etc).
 * Siembra por franja (todos los 1° entre sí, luego todos los 2°, ...) y at ajusta a la
 * potencia de 2 más chica que entre a todos: los que sobran (byes) quedan para las mejores
 * siembras, que avanzan directo a la próxima ronda sin jugar.
 */
export function buildBracket(qualifiersByZone: string[][]): BracketMatchPlan[] {
  const maxPerZone = Math.max(...qualifiersByZone.map((z) => z.length), 0);
  const seeds: string[] = [];
  for (let tier = 0; tier < maxPerZone; tier++) {
    for (const zone of qualifiersByZone) if (zone[tier]) seeds.push(zone[tier]);
  }
  const totalQualifiers = seeds.length;
  if (totalQualifiers < 2) return [];
  const bracketSize = nextPowerOfTwo(totalQualifiers);
  const order = seedOrder(bracketSize); // posición -> N° de siembra (1-indexado)
  const teamBySeed = (seedNum: number): string | null => seeds[seedNum - 1] ?? null;

  const rounds = Math.log2(bracketSize);
  const plans: BracketMatchPlan[][] = [];

  // Ronda 1: arma los partidos reales y decide los byes (avance directo) al toque.
  const round1: BracketMatchPlan[] = [];
  for (let i = 0; i < bracketSize / 2; i++) {
    const seedA = order[i * 2];
    const seedB = order[i * 2 + 1];
    const teamA = teamBySeed(seedA);
    const teamB = teamBySeed(seedB);
    const isBye = !teamA || !teamB;
    round1.push({
      tempId: `r0-${i}`,
      roundOrder: 0,
      roundNameLabel: roundName(bracketSize),
      position: i,
      team1_id: teamA,
      team2_id: teamB,
      winner_id: isBye ? teamA ?? teamB : null,
      nextTempId: null,
      nextSlot: null,
    });
  }
  plans.push(round1);

  // Rondas siguientes: vacías, con el enlace hecho hacia la ronda anterior.
  let teamsInRound = bracketSize / 2;
  for (let r = 1; r < rounds; r++) {
    teamsInRound = teamsInRound / 2;
    const roundPlans: BracketMatchPlan[] = [];
    for (let i = 0; i < Math.max(1, teamsInRound); i++) {
      roundPlans.push({
        tempId: `r${r}-${i}`,
        roundOrder: r,
        roundNameLabel: roundName(teamsInRound * 2),
        position: i,
        team1_id: null,
        team2_id: null,
        winner_id: null,
        nextTempId: null,
        nextSlot: null,
      });
    }
    plans.push(roundPlans);
  }

  // Enlaza cada partido con el de la ronda siguiente (match i y i+1 alimentan al match floor(i/2)).
  for (let r = 0; r < plans.length - 1; r++) {
    for (const m of plans[r]) {
      const nextMatch = plans[r + 1][Math.floor(m.position / 2)];
      m.nextTempId = nextMatch.tempId;
      m.nextSlot = m.position % 2 === 0 ? 1 : 2;
    }
  }

  // Los byes de la ronda 1 avanzan de una a la ronda 2 (se completa acá, no en tiempo real).
  const flat = plans.flat();
  const byTempId = new Map(flat.map((m) => [m.tempId, m]));
  for (const m of round1) {
    if (!m.winner_id || !m.nextTempId) continue;
    const next = byTempId.get(m.nextTempId);
    if (!next) continue;
    if (m.nextSlot === 1) next.team1_id = m.winner_id;
    else next.team2_id = m.winner_id;
  }

  return flat;
}
