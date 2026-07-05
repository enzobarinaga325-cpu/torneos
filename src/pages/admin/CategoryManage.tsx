import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Shuffle, Trash2, Trophy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Category, Court, Match, Team, Zone } from "@/lib/types";
import { buildBracket, computeStandings, proposeZones, roundRobinPairs } from "@/lib/tournament-logic";
import { Button, Card, Input, Label, Select, Spinner } from "@/components/ui";

type Tab = "equipos" | "zonas" | "fixture";

export function CategoryManage() {
  const { id: tournamentId, categoryId } = useParams<{ id: string; categoryId: string }>();
  const [category, setCategory] = useState<Category | null | undefined>(undefined);
  const [teams, setTeams] = useState<Team[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [tab, setTab] = useState<Tab>("equipos");

  const [teamName, setTeamName] = useState("");
  const [teamsPerZone, setTeamsPerZone] = useState("4");
  const [qualifiersPerZone, setQualifiersPerZone] = useState("2");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [{ data: cat }, { data: t }, { data: z }, { data: m }, { data: co }] = await Promise.all([
      supabase.from("categories").select("*").eq("id", categoryId!).maybeSingle(),
      supabase.from("teams").select("*").eq("category_id", categoryId!).order("name"),
      supabase.from("zones").select("*").eq("category_id", categoryId!).order("position"),
      supabase.from("matches").select("*").eq("category_id", categoryId!).order("round_order").order("position"),
      supabase.from("courts").select("*").eq("tournament_id", tournamentId!).order("name"),
    ]);
    setCategory(cat ?? null);
    setTeams(t ?? []);
    setZones(z ?? []);
    setMatches((m as Match[]) ?? []);
    setCourts(co ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const teamsById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t])), [teams]);
  const zoneMatches = matches.filter((m) => m.stage === "zona");
  const fixtureMatches = matches.filter((m) => m.stage === "fixture");
  const hasZoneMatches = zoneMatches.length > 0;
  const hasFixture = fixtureMatches.length > 0;

  // ============ EQUIPOS ============
  async function addTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) return;
    setError(null);
    const { error } = await supabase.from("teams").insert({ category_id: categoryId, name: teamName.trim() });
    if (error) { setError(error.message); return; }
    setTeamName("");
    load();
  }

  async function deleteTeam(teamId: string) {
    if (!confirm("¿Borrar este equipo? Si ya tiene partidos cargados, se van a borrar también.")) return;
    await supabase.from("teams").delete().eq("id", teamId);
    load();
  }

  async function assignZone(teamId: string, zoneId: string) {
    await supabase.from("teams").update({ zone_id: zoneId || null }).eq("id", teamId);
    load();
  }

  // ============ ZONAS ============
  async function generateZones() {
    const size = Math.max(2, Number(teamsPerZone) || 4);
    if (teams.length < 2) { setError("Cargá al menos 2 equipos primero."); return; }
    setBusy(true);
    setError(null);
    // Limpia zonas previas (y sus partidos de zona) antes de proponer de nuevo.
    await supabase.from("zones").delete().eq("category_id", categoryId!);
    const proposal = proposeZones(teams.map((t) => t.id), size);
    for (let i = 0; i < proposal.length; i++) {
      const { data: zone } = await supabase
        .from("zones")
        .insert({ category_id: categoryId, name: proposal[i].name, position: i })
        .select()
        .single();
      if (zone) {
        await supabase.from("teams").update({ zone_id: zone.id }).in("id", proposal[i].teamIds);
      }
    }
    setBusy(false);
    load();
  }

  async function generateZoneMatches() {
    if (zones.length === 0) { setError("Generá las zonas primero."); return; }
    if (hasZoneMatches && !confirm("Ya hay partidos de zona cargados. Esto los borra y genera de nuevo (se pierden los resultados). ¿Seguir?")) return;
    setBusy(true);
    setError(null);
    await supabase.from("matches").delete().eq("category_id", categoryId!).eq("stage", "zona");
    for (const zone of zones) {
      const zoneTeamIds = teams.filter((t) => t.zone_id === zone.id).map((t) => t.id);
      const pairs = roundRobinPairs(zoneTeamIds);
      if (pairs.length === 0) continue;
      await supabase.from("matches").insert(
        pairs.map(([a, b], i) => ({
          category_id: categoryId,
          stage: "zona",
          zone_id: zone.id,
          position: i,
          team1_id: a,
          team2_id: b,
        })),
      );
    }
    setBusy(false);
    load();
  }

  // ============ FIXTURE ============
  async function generateFixture() {
    const n = Math.max(1, Number(qualifiersPerZone) || 2);
    const unplayed = zoneMatches.some((m) => m.team1_sets == null || m.team2_sets == null);
    if (unplayed && !confirm("Todavía hay partidos de zona sin resultado cargado. ¿Generar el fixture igual con lo que hay?")) return;
    if (hasFixture && !confirm("Ya existe un fixture. Esto lo borra y arma uno nuevo. ¿Seguir?")) return;

    const qualifiersByZone = zones.map((zone) => {
      const zoneTeamIds = teams.filter((t) => t.zone_id === zone.id).map((t) => t.id);
      const standings = computeStandings(zoneTeamIds, zoneMatches.filter((m) => m.zone_id === zone.id));
      return standings.slice(0, n).map((s) => s.team_id);
    });
    const plan = buildBracket(qualifiersByZone);
    if (plan.length === 0) { setError("Hacen falta al menos 2 equipos clasificados para armar el fixture."); return; }

    setBusy(true);
    setError(null);
    await supabase.from("matches").delete().eq("category_id", categoryId!).eq("stage", "fixture");

    const tempToRealId = new Map<string, string>();
    for (const m of plan) {
      const { data } = await supabase
        .from("matches")
        .insert({
          category_id: categoryId,
          stage: "fixture",
          round_name: m.roundNameLabel,
          round_order: m.roundOrder,
          position: m.position,
          team1_id: m.team1_id,
          team2_id: m.team2_id,
          winner_id: m.winner_id,
        })
        .select()
        .single();
      if (data) tempToRealId.set(m.tempId, data.id);
    }
    for (const m of plan) {
      if (!m.nextTempId) continue;
      const realId = tempToRealId.get(m.tempId);
      const nextRealId = tempToRealId.get(m.nextTempId);
      if (!realId || !nextRealId) continue;
      await supabase.from("matches").update({ next_match_id: nextRealId, next_match_slot: m.nextSlot }).eq("id", realId);
    }
    setBusy(false);
    load();
  }

  // ============ PARTIDOS (comunes a zona y fixture) ============
  async function updateMatchTeam(match: Match, slot: 1 | 2, teamId: string) {
    await supabase.from("matches").update(slot === 1 ? { team1_id: teamId || null } : { team2_id: teamId || null }).eq("id", match.id);
    load();
  }

  async function updateMatchCourt(match: Match, courtId: string) {
    await supabase.from("matches").update({ court_id: courtId || null }).eq("id", match.id);
    load();
  }

  async function updateMatchSchedule(match: Match, isoDatetime: string) {
    await supabase.from("matches").update({ scheduled_at: isoDatetime || null }).eq("id", match.id);
    load();
  }

  async function saveResult(match: Match, s1: number, s2: number) {
    if (s1 === s2) { setError("El partido no puede terminar empatado en sets."); return; }
    const winner_id = s1 > s2 ? match.team1_id : match.team2_id;
    await supabase.from("matches").update({ team1_sets: s1, team2_sets: s2, winner_id }).eq("id", match.id);
    if (match.stage === "fixture" && match.next_match_id && winner_id) {
      await supabase
        .from("matches")
        .update(match.next_match_slot === 1 ? { team1_id: winner_id } : { team2_id: winner_id })
        .eq("id", match.next_match_id);
    }
    load();
  }

  if (category === undefined) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (category === null) return <p className="text-sm text-zinc-500">No se encontró la categoría.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to={`/admin/torneos/${tournamentId}`} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
          <ArrowLeft className="h-3.5 w-3.5" /> Torneo
        </Link>
        <h1 className="mt-1 text-lg font-semibold">{category.name}</h1>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm w-fit">
        {(["equipos", "zonas", "fixture"] as Tab[]).map((tKey) => (
          <button
            key={tKey}
            onClick={() => setTab(tKey)}
            className={`rounded-md px-3 py-1.5 capitalize ${tab === tKey ? "bg-white font-semibold shadow-sm" : "text-zinc-500"}`}
          >
            {tKey}
          </button>
        ))}
      </div>

      {tab === "equipos" && (
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Agregar equipo</h2>
            <form onSubmit={addTeam} className="flex items-end gap-3">
              <div className="flex-1">
                <Label>Nombre de la pareja</Label>
                <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Juan Pérez / Martina Gómez" />
              </div>
              <Button type="submit">
                <Plus className="h-3.5 w-3.5" /> Agregar
              </Button>
            </form>
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-sm font-semibold">Equipos ({teams.length})</h2>
              <div className="flex items-end gap-2">
                <div className="w-40">
                  <Label>Equipos por zona</Label>
                  <Input type="number" min={2} value={teamsPerZone} onChange={(e) => setTeamsPerZone(e.target.value)} />
                </div>
                <Button onClick={generateZones} disabled={busy}>
                  <Shuffle className="h-3.5 w-3.5" /> Generar zonas
                </Button>
              </div>
            </div>
            {teams.length === 0 ? (
              <p className="text-xs text-zinc-500">Todavía no cargaste equipos.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {teams.map((team) => (
                  <div key={team.id} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2">
                    <span className="text-sm">{team.name}</span>
                    <div className="flex items-center gap-2">
                      {zones.length > 0 && (
                        <select
                          value={team.zone_id ?? ""}
                          onChange={(e) => assignZone(team.id, e.target.value)}
                          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs"
                        >
                          <option value="">Sin zona</option>
                          {zones.map((z) => (
                            <option key={z.id} value={z.id}>{z.name}</option>
                          ))}
                        </select>
                      )}
                      <button onClick={() => deleteTeam(team.id)} className="rounded-md p-1.5 text-red-600 hover:bg-zinc-100" aria-label={`Borrar ${team.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "zonas" && (
        <div className="flex flex-col gap-4">
          {zones.length === 0 ? (
            <Card className="text-center text-sm text-zinc-500">Generá las zonas desde la pestaña "Equipos" primero.</Card>
          ) : (
            <>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-zinc-600">
                  {zones.length} zona{zones.length === 1 ? "" : "s"} · movés equipos entre zonas desde la pestaña Equipos.
                </p>
                <Button onClick={generateZoneMatches} disabled={busy}>
                  {hasZoneMatches ? "Regenerar partidos de zona" : "Generar partidos de zona"}
                </Button>
              </Card>

              {zones.map((zone) => {
                const zoneTeamIds = teams.filter((t) => t.zone_id === zone.id).map((t) => t.id);
                const standings = computeStandings(zoneTeamIds, zoneMatches.filter((m) => m.zone_id === zone.id));
                const myMatches = zoneMatches.filter((m) => m.zone_id === zone.id);
                return (
                  <Card key={zone.id} className="flex flex-col gap-3">
                    <h3 className="font-semibold">{zone.name}</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-zinc-400">
                          <tr>
                            <th className="py-1 pr-2">Equipo</th>
                            <th className="px-2 text-center">PJ</th>
                            <th className="px-2 text-center">G</th>
                            <th className="px-2 text-center">P</th>
                            <th className="px-2 text-center">Dif. sets</th>
                          </tr>
                        </thead>
                        <tbody>
                          {standings.map((s, i) => (
                            <tr key={s.team_id} className="border-t border-zinc-100">
                              <td className="py-1.5 pr-2 font-medium">
                                {i === 0 && <Trophy className="mr-1 inline h-3 w-3 text-amber-500" />}
                                {teamsById[s.team_id]?.name ?? "?"}
                              </td>
                              <td className="px-2 text-center">{s.played}</td>
                              <td className="px-2 text-center">{s.won}</td>
                              <td className="px-2 text-center">{s.lost}</td>
                              <td className="px-2 text-center">{s.sets_diff > 0 ? `+${s.sets_diff}` : s.sets_diff}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex flex-col gap-2">
                      {myMatches.map((m) => (
                        <MatchRow key={m.id} match={m} teams={teams} courts={courts} onTeamChange={updateMatchTeam} onCourtChange={updateMatchCourt} onScheduleChange={updateMatchSchedule} onSaveResult={saveResult} />
                      ))}
                    </div>
                  </Card>
                );
              })}
            </>
          )}
        </div>
      )}

      {tab === "fixture" && (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-52">
              <Label>Equipos que clasifican por zona</Label>
              <Input type="number" min={1} value={qualifiersPerZone} onChange={(e) => setQualifiersPerZone(e.target.value)} />
            </div>
            <Button onClick={generateFixture} disabled={busy || zones.length === 0}>
              {hasFixture ? "Regenerar fixture" : "Generar fixture"}
            </Button>
          </Card>

          {!hasFixture ? (
            <Card className="text-center text-sm text-zinc-500">Todavía no se generó el fixture.</Card>
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-2">
              {[...new Set(fixtureMatches.map((m) => m.round_order))].sort((a, b) => (a ?? 0) - (b ?? 0)).map((ro) => {
                const roundMatches = fixtureMatches.filter((m) => m.round_order === ro);
                return (
                  <div key={ro} className="flex min-w-[260px] flex-col gap-2">
                    <h3 className="text-sm font-semibold text-zinc-700">{roundMatches[0]?.round_name}</h3>
                    {roundMatches.map((m) => (
                      <MatchRow key={m.id} match={m} teams={teams} courts={courts} onTeamChange={updateMatchTeam} onCourtChange={updateMatchCourt} onScheduleChange={updateMatchSchedule} onSaveResult={saveResult} compact />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MatchRow({
  match, teams, courts, onTeamChange, onCourtChange, onScheduleChange, onSaveResult, compact,
}: {
  match: Match;
  teams: Team[];
  courts: Court[];
  onTeamChange: (m: Match, slot: 1 | 2, teamId: string) => void;
  onCourtChange: (m: Match, courtId: string) => void;
  onScheduleChange: (m: Match, iso: string) => void;
  onSaveResult: (m: Match, s1: number, s2: number) => void;
  compact?: boolean;
}) {
  const [s1, setS1] = useState(match.team1_sets ?? 0);
  const [s2, setS2] = useState(match.team2_sets ?? 0);
  const played = match.team1_sets != null && match.team2_sets != null;
  const isBye = !match.team1_id || !match.team2_id;

  return (
    <div className={`rounded-lg border border-zinc-200 p-2.5 ${compact ? "text-xs" : "text-sm"}`}>
      <div className="grid grid-cols-2 gap-2">
        <Select value={match.team1_id ?? ""} onChange={(e) => onTeamChange(match, 1, e.target.value)} className={match.winner_id === match.team1_id ? "font-bold text-emerald-700" : ""}>
          <option value="">—</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Select value={match.team2_id ?? ""} onChange={(e) => onTeamChange(match, 2, e.target.value)} className={match.winner_id === match.team2_id ? "font-bold text-emerald-700" : ""}>
          <option value="">—</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </div>

      {isBye ? (
        <p className="mt-1.5 text-center text-[11px] text-zinc-400">Pase directo</p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Select value={match.court_id ?? ""} onChange={(e) => onCourtChange(match, e.target.value)}>
              <option value="">Cancha</option>
              {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <input
              type="datetime-local"
              defaultValue={match.scheduled_at ? match.scheduled_at.slice(0, 16) : ""}
              onBlur={(e) => onScheduleChange(match, e.target.value ? new Date(e.target.value).toISOString() : "")}
              className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-emerald-500"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input type="number" min={0} value={s1} onChange={(e) => setS1(Number(e.target.value))} className="w-14 rounded-md border border-zinc-300 px-2 py-1 text-center text-xs" />
            <span className="text-zinc-400">-</span>
            <input type="number" min={0} value={s2} onChange={(e) => setS2(Number(e.target.value))} className="w-14 rounded-md border border-zinc-300 px-2 py-1 text-center text-xs" />
            <Button variant="secondary" className="flex-1 px-2 py-1 text-xs" onClick={() => onSaveResult(match, s1, s2)}>
              {played ? "Actualizar resultado" : "Guardar resultado"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
