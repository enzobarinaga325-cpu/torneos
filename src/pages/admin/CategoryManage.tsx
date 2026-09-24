import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Plus, Shuffle, Trash2, Trophy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Category, Court, Match, Team, Tournament, Zone } from "@/lib/types";
import { buildBracket, computeStandings, matchWinner, proposeZones, roundRobinPairs } from "@/lib/tournament-logic";
import { roundRobinJourneys } from "@/lib/league-logic";
import { toLocalDatetimeInput } from "@/lib/format";
import { autoScheduleTournament } from "@/lib/autoschedule";
import { autoScheduleLeague } from "@/lib/league-autoschedule";
import { FixtureBracket } from "@/components/FixtureBracket";
import { ZonesView } from "@/components/ZonesView";
import { LeagueStandings } from "@/components/LeagueStandings";
import { Button, Card, Input, Label, Select, Spinner } from "@/components/ui";

type Tab = "equipos" | "zonas" | "fixture" | "liga";

export function CategoryManage() {
  const { id: tournamentId, categoryId } = useParams<{ id: string; categoryId: string }>();
  const [tournament, setTournament] = useState<Tournament | null | undefined>(undefined);
  const [category, setCategory] = useState<Category | null | undefined>(undefined);
  const [teams, setTeams] = useState<Team[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [tab, setTab] = useState<Tab>("equipos");

  const [teamName, setTeamName] = useState("");
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState("");
  const [teamsPerZone, setTeamsPerZone] = useState("4");
  const [qualifiersPerZone, setQualifiersPerZone] = useState("2");
  const [idaVuelta, setIdaVuelta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [{ data: tour }, { data: cat }, { data: t }, { data: z }, { data: m }, { data: co }] = await Promise.all([
      supabase.from("tournaments").select("*").eq("id", tournamentId!).maybeSingle(),
      supabase.from("categories").select("*").eq("id", categoryId!).maybeSingle(),
      supabase.from("teams").select("*").eq("category_id", categoryId!).order("name"),
      supabase.from("zones").select("*").eq("category_id", categoryId!).order("position"),
      supabase.from("matches").select("*").eq("category_id", categoryId!).order("round_order").order("position"),
      supabase.from("courts").select("*").eq("tournament_id", tournamentId!).order("name"),
    ]);
    setTournament(tour ?? null);
    setCategory(cat ?? null);
    setTeams(t ?? []);
    setZones(z ?? []);
    setMatches((m as Match[]) ?? []);
    setCourts(co ?? []);
    if (tour) setIdaVuelta(tour.ida_vuelta);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const teamsById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t])), [teams]);
  const isLiga = tournament?.modalidad === "liga";
  const zoneMatches = matches.filter((m) => m.stage === "zona");
  const fixtureMatches = matches.filter((m) => m.stage === "fixture");
  const ligaMatches = matches.filter((m) => m.stage === "liga");
  const hasZoneMatches = zoneMatches.length > 0;
  const hasFixture = fixtureMatches.length > 0;
  const hasLigaMatches = ligaMatches.length > 0;

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

  function startEditTeam(team: Team) {
    setEditingTeamId(team.id);
    setEditingTeamName(team.name);
  }

  async function saveTeamName(teamId: string) {
    const name = editingTeamName.trim();
    if (!name) return;
    await supabase.from("teams").update({ name }).eq("id", teamId);
    setEditingTeamId(null);
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

  /** Solo para liga: las zonas son opcionales ahí, así que se pueden sacar para volver a un
   *  todos-contra-todos único. En modo torneo las zonas son parte necesaria del flujo
   *  zona→fixture, así que no se ofrece quitarlas. */
  async function removeZones() {
    if (!confirm("¿Quitar las zonas de esta categoría? Los equipos vuelven a quedar sin zona y se borran TODOS los partidos de liga ya generados (jugados o no). Después generás de nuevo el fixture como un solo todos-contra-todos.")) return;
    setBusy(true);
    setError(null);
    await supabase.from("zones").delete().eq("category_id", categoryId!);
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
    // Los partidos de zona ya nacen con las dos parejas conocidas, así que se pueden
    // agendar de una sin esperar a que el admin apriete "Autocompletar horarios".
    await autoScheduleTournament(tournamentId!);
    setBusy(false);
    load();
  }

  // ============ FIXTURE ============
  async function generateFixture() {
    const n = Math.max(1, Number(qualifiersPerZone) || 2);
    const unplayed = zoneMatches.some((m) => matchWinner(m) == null);
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
    // La primera ronda ya tiene las dos parejas conocidas (vienen de las zonas): se agenda
    // de una. Las rondas siguientes se van agendando solas a medida que se cargan resultados.
    await autoScheduleTournament(tournamentId!);
    setBusy(false);
    load();
  }

  // ============ LIGA ============
  /**
   * Arma el fixture de liga. Si hay zonas cargadas (opcional, se generan desde "Equipos"),
   * cada zona juega su propio todos-contra-todos por separado, con su propia tabla de
   * posiciones — igual que las zonas del modo torneo, pero sin cuadro eliminatorio después.
   * Sin zonas, es un solo todos-contra-todos entre todos los equipos, como hasta ahora.
   */
  async function generateLeagueFixture() {
    if (teams.length < 2) { setError("Cargá al menos 2 equipos primero."); return; }
    if (hasLigaMatches && !confirm("Ya hay un fixture de liga cargado. Esto lo borra y arma uno nuevo (se pierden los resultados). ¿Seguir?")) return;

    const groups = zones.length > 0
      ? zones.map((zone) => ({ zoneId: zone.id as string | null, teamIds: teams.filter((t) => t.zone_id === zone.id).map((t) => t.id) }))
      : [{ zoneId: null as string | null, teamIds: teams.map((t) => t.id) }];

    const zonasSinEquipos = zones.length > 0 && groups.some((g) => g.teamIds.length < 2);
    if (zonasSinEquipos) { setError("Cada zona necesita al menos 2 equipos para armar su fixture."); return; }

    setBusy(true);
    setError(null);
    await supabase.from("tournaments").update({ ida_vuelta: idaVuelta }).eq("id", tournamentId!);
    await supabase.from("matches").delete().eq("category_id", categoryId!).eq("stage", "liga");

    for (const group of groups) {
      const journeys = roundRobinJourneys(group.teamIds, idaVuelta);
      const idaJornadas = idaVuelta ? journeys.length / 2 : journeys.length;
      for (let j = 0; j < journeys.length; j++) {
        const pairs = journeys[j];
        if (pairs.length === 0) continue;
        const isVuelta = j >= idaJornadas;
        const jornadaNum = isVuelta ? j - idaJornadas + 1 : j + 1;
        const roundName = isVuelta ? `Jornada ${jornadaNum} (vuelta)` : `Jornada ${jornadaNum}`;
        await supabase.from("matches").insert(
          pairs.map(([a, b], i) => ({
            category_id: categoryId,
            stage: "liga",
            zone_id: group.zoneId,
            round_name: roundName,
            round_order: j,
            position: i,
            team1_id: a,
            team2_id: b,
          })),
        );
      }
    }
    // Ya nacen con las dos parejas conocidas: se agendan de una según los horarios
    // semanales de la liga (si ya están cargados).
    await autoScheduleLeague(tournamentId!);
    setBusy(false);
    load();
  }

  // ============ PARTIDOS (comunes a zona, fixture y liga) ============
  async function updateMatchTeam(match: Match, slot: 1 | 2, teamId: string) {
    await supabase.from("matches").update(slot === 1 ? { team1_id: teamId || null } : { team2_id: teamId || null }).eq("id", match.id);
    load();
  }

  /**
   * Cambia la cancha y/o el horario de un partido. Si el destino ya lo ocupa OTRO
   * partido (misma cancha + mismo horario, en cualquier categoría del torneo), ese
   * otro partido pasa directamente a donde estaba este — se intercambian, no quedan
   * dos partidos pisados en el mismo lugar.
   *
   * Antes de mover nada, chequea que ninguno de los dos equipos de este partido quede con
   * dos partidos a la misma hora en canchas distintas (un cruce real: el equipo no puede
   * estar en dos lados a la vez) — puede pasar aunque la cancha+hora destino esté libre,
   * si ese equipo juega otra categoría. Si hay cruce, no se mueve nada y se avisa.
   */
  async function updateMatchSlot(match: Match, patch: { court_id?: string | null; scheduled_at?: string | null }) {
    const newCourtId = "court_id" in patch ? patch.court_id ?? null : match.court_id;
    const newScheduledAt = "scheduled_at" in patch ? patch.scheduled_at ?? null : match.scheduled_at;

    if (newCourtId && newScheduledAt) {
      const teamIds = [match.team1_id, match.team2_id].filter((tid): tid is string => !!tid);

      const { data: sameTime } = teamIds.length > 0
        ? await supabase
            .from("matches")
            .select("id, court_id, team1_id, team2_id")
            .eq("scheduled_at", newScheduledAt)
            .neq("id", match.id)
            .or(teamIds.flatMap((tid) => [`team1_id.eq.${tid}`, `team2_id.eq.${tid}`]).join(","))
        : { data: [] };

      const occupant = (sameTime ?? []).find((m) => m.court_id === newCourtId);
      // Cualquier otro partido de estos equipos a esa hora, en OTRA cancha, es un cruce real
      // y no se arregla intercambiando lugares — hay que elegir otro horario.
      const teamClash = (sameTime ?? []).find((m) => m.id !== occupant?.id);
      if (teamClash) {
        setError("Uno de estos dos equipos ya tiene otro partido agendado a esa misma hora — elegí otro horario o cancha.");
        return;
      }

      if (occupant) {
        // Si este partido ya tenía un lugar antes (no es la primera vez que se agenda), hay
        // que asegurarse de que mandar al que ocupaba el destino hacia ESE lugar viejo
        // tampoco cruce a sus propios equipos con otro partido que ya tengan justo ahí.
        // Si el partido no tenía lugar viejo (se está agendando por primera vez), el que
        // ocupaba el destino simplemente queda sin horario — no hay "lugar viejo" que
        // chequear ni adonde moverlo.
        if (match.scheduled_at) {
          const occupantTeamIds = [occupant.team1_id, occupant.team2_id].filter((tid): tid is string => !!tid);
          const { data: occupantClash } = occupantTeamIds.length > 0
            ? await supabase
                .from("matches")
                .select("id")
                .eq("scheduled_at", match.scheduled_at)
                .neq("id", occupant.id)
                .neq("id", match.id)
                .or(occupantTeamIds.flatMap((tid) => [`team1_id.eq.${tid}`, `team2_id.eq.${tid}`]).join(","))
            : { data: [] };
          if (occupantClash && occupantClash.length > 0) {
            setError("No se puede intercambiar: el partido que ocupa ese lugar tiene un equipo que ya juega a la hora anterior de este partido.");
            return;
          }
        }
        await supabase
          .from("matches")
          .update({ court_id: match.court_id, scheduled_at: match.scheduled_at, auto_scheduled: false })
          .eq("id", occupant.id);
      }
    }

    setError(null);
    // auto_scheduled: false marca que este horario lo eligió el admin a mano, así el
    // auto-agendado de liga nunca lo va a mover cuando después replanifique otras categorías.
    await supabase.from("matches").update({ court_id: newCourtId, scheduled_at: newScheduledAt, auto_scheduled: false }).eq("id", match.id);
    load();
  }

  async function updateMatchCourt(match: Match, courtId: string) {
    await updateMatchSlot(match, { court_id: courtId || null });
  }

  async function updateMatchSchedule(match: Match, isoDatetime: string) {
    await updateMatchSlot(match, { scheduled_at: isoDatetime || null });
  }

  async function saveResult(match: Match, sets: Pick<Match, "set1_team1" | "set1_team2" | "set2_team1" | "set2_team2" | "set3_team1" | "set3_team2">) {
    const winner = matchWinner({ ...match, ...sets });
    if (!winner) { setError("Cargá al menos 2 sets, y que no queden empatados, para definir un ganador."); return; }
    const winner_id = winner === 1 ? match.team1_id : match.team2_id;
    await supabase.from("matches").update({ ...sets, winner_id }).eq("id", match.id);
    if (match.stage === "fixture" && match.next_match_id && winner_id) {
      await supabase
        .from("matches")
        .update(match.next_match_slot === 1 ? { team1_id: winner_id } : { team2_id: winner_id })
        .eq("id", match.next_match_id);
      // Si con este resultado la próxima ronda quedó con las dos parejas definidas
      // (el otro cruce ya se había jugado), se agenda sola, sin esperar a que el
      // admin vuelva a apretar "Autocompletar horarios".
      await autoScheduleTournament(tournamentId!);
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
        {((isLiga ? ["equipos", "liga"] : ["equipos", "zonas", "fixture"]) as Tab[]).map((tKey) => (
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
                {isLiga && zones.length > 0 && (
                  <Button variant="secondary" onClick={removeZones} disabled={busy}>
                    Quitar zonas
                  </Button>
                )}
              </div>
            </div>
            {teams.length === 0 ? (
              <p className="text-xs text-zinc-500">Todavía no cargaste equipos.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {teams.map((team) => (
                  <div key={team.id} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2">
                    {editingTeamId === team.id ? (
                      <form
                        className="flex flex-1 items-center gap-2"
                        onSubmit={(e) => { e.preventDefault(); saveTeamName(team.id); }}
                      >
                        <Input
                          autoFocus
                          value={editingTeamName}
                          onChange={(e) => setEditingTeamName(e.target.value)}
                          className="h-7 py-1 text-sm"
                        />
                        <Button type="submit" className="px-2 py-1 text-xs">Guardar</Button>
                        <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => setEditingTeamId(null)}>
                          Cancelar
                        </Button>
                      </form>
                    ) : (
                      <>
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
                          <button onClick={() => startEditTeam(team)} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100" aria-label={`Editar ${team.name}`}>
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button onClick={() => deleteTeam(team.id)} className="rounded-md p-1.5 text-red-600 hover:bg-zinc-100" aria-label={`Borrar ${team.name}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </>
                    )}
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

              <div>
                <h3 className="mb-2 text-sm font-semibold text-zinc-700">Vista para compartir</h3>
                <ZonesView zones={zones} teams={teams} zoneMatches={zoneMatches} teamsById={teamsById} fileName={`zonas-${category.name}`} />
              </div>

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
                            <th className="px-2 text-center">Dif. games</th>
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
                              <td className="px-2 text-center">{s.games_diff > 0 ? `+${s.games_diff}` : s.games_diff}</td>
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
            <>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-zinc-700">Vista para compartir</h3>
                <FixtureBracket matches={fixtureMatches} teamsById={teamsById} fileName={`fixture-${category.name}`} />
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-zinc-700">Cargar horarios y resultados</h3>
                <div className="flex gap-4 overflow-x-auto pb-2">
                  {[...new Set(fixtureMatches.map((m) => m.round_order))].sort((a, b) => (a ?? 0) - (b ?? 0)).map((ro) => {
                    const roundMatches = fixtureMatches.filter((m) => m.round_order === ro);
                    return (
                      <div key={ro} className="flex min-w-[260px] flex-col gap-2">
                        <h4 className="text-sm font-semibold text-zinc-700">{roundMatches[0]?.round_name}</h4>
                        {roundMatches.map((m) => (
                          <MatchRow key={m.id} match={m} teams={teams} courts={courts} onTeamChange={updateMatchTeam} onCourtChange={updateMatchCourt} onScheduleChange={updateMatchSchedule} onSaveResult={saveResult} compact />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "liga" && (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-wrap items-end justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" checked={idaVuelta} onChange={(e) => setIdaVuelta(e.target.checked)} className="h-4 w-4 rounded border-zinc-300" />
              Ida y vuelta
            </label>
            <Button onClick={generateLeagueFixture} disabled={busy || teams.length < 2}>
              {hasLigaMatches ? "Regenerar fixture de liga" : "Generar fixture de liga"}
            </Button>
          </Card>

          {!hasLigaMatches ? (
            <Card className="text-center text-sm text-zinc-500">Todavía no se generó el fixture de esta liga.</Card>
          ) : zones.length > 0 ? (
            zones.map((zone) => {
              const zoneTeamIds = teams.filter((t) => t.zone_id === zone.id).map((t) => t.id);
              const zoneMatches2 = ligaMatches.filter((m) => m.zone_id === zone.id);
              if (zoneMatches2.length === 0) return null;
              return (
                <div key={zone.id} className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-4">
                  <h3 className="font-semibold">{zone.name}</h3>
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-zinc-700">Tabla de posiciones</h4>
                    <LeagueStandings teamIds={zoneTeamIds} matches={zoneMatches2} teamsById={teamsById} fileName={`posiciones-${category.name}-${zone.name}`} />
                  </div>
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-zinc-700">Fixture por jornada</h4>
                    <div className="flex gap-4 overflow-x-auto pb-2">
                      {[...new Set(zoneMatches2.map((m) => m.round_order))].sort((a, b) => (a ?? 0) - (b ?? 0)).map((ro) => {
                        const roundMatches = zoneMatches2.filter((m) => m.round_order === ro);
                        return (
                          <div key={ro} className="flex min-w-[260px] flex-col gap-2">
                            <h5 className="text-sm font-semibold text-zinc-700">{roundMatches[0]?.round_name}</h5>
                            {roundMatches.map((m) => (
                              <MatchRow key={m.id} match={m} teams={teams} courts={courts} onTeamChange={updateMatchTeam} onCourtChange={updateMatchCourt} onScheduleChange={updateMatchSchedule} onSaveResult={saveResult} compact />
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-zinc-700">Tabla de posiciones</h3>
                <LeagueStandings teamIds={teams.map((t) => t.id)} matches={ligaMatches} teamsById={teamsById} fileName={`posiciones-${category.name}`} />
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-zinc-700">Fixture por jornada</h3>
                <div className="flex gap-4 overflow-x-auto pb-2">
                  {[...new Set(ligaMatches.map((m) => m.round_order))].sort((a, b) => (a ?? 0) - (b ?? 0)).map((ro) => {
                    const roundMatches = ligaMatches.filter((m) => m.round_order === ro);
                    return (
                      <div key={ro} className="flex min-w-[260px] flex-col gap-2">
                        <h4 className="text-sm font-semibold text-zinc-700">{roundMatches[0]?.round_name}</h4>
                        {roundMatches.map((m) => (
                          <MatchRow key={m.id} match={m} teams={teams} courts={courts} onTeamChange={updateMatchTeam} onCourtChange={updateMatchCourt} onScheduleChange={updateMatchSchedule} onSaveResult={saveResult} compact />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type SetsDraft = Pick<Match, "set1_team1" | "set1_team2" | "set2_team1" | "set2_team2" | "set3_team1" | "set3_team2">;

function MatchRow({
  match, teams, courts, onTeamChange, onCourtChange, onScheduleChange, onSaveResult, compact,
}: {
  match: Match;
  teams: Team[];
  courts: Court[];
  onTeamChange: (m: Match, slot: 1 | 2, teamId: string) => void;
  onCourtChange: (m: Match, courtId: string) => void;
  onScheduleChange: (m: Match, iso: string) => void;
  onSaveResult: (m: Match, sets: SetsDraft) => void;
  compact?: boolean;
}) {
  const [sets, setSets] = useState<SetsDraft>({
    set1_team1: match.set1_team1, set1_team2: match.set1_team2,
    set2_team1: match.set2_team1, set2_team2: match.set2_team2,
    set3_team1: match.set3_team1, set3_team2: match.set3_team2,
  });
  const played = matchWinner({ ...match, ...sets }) != null;
  const isBye = !match.team1_id || !match.team2_id;
  // El 3er set solo hace falta si el 1° y el 2° quedaron 1 a 1.
  const set1Winner = sets.set1_team1 != null && sets.set1_team2 != null && sets.set1_team1 !== sets.set1_team2
    ? (sets.set1_team1 > sets.set1_team2 ? 1 : 2) : null;
  const set2Winner = sets.set2_team1 != null && sets.set2_team2 != null && sets.set2_team1 !== sets.set2_team2
    ? (sets.set2_team1 > sets.set2_team2 ? 1 : 2) : null;
  const needsThirdSet = set1Winner != null && set2Winner != null && set1Winner !== set2Winner;

  function setField(field: keyof SetsDraft, raw: string) {
    setSets((s) => ({ ...s, [field]: raw === "" ? null : Number(raw) }));
  }

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
              // key por scheduled_at: si este horario cambia desde afuera (p. ej. porque se
              // intercambió con otro partido al reagendar uno distinto), el input no es
              // controlado (defaultValue), así que sin esto quedaría mostrando la hora vieja
              // hasta recargar la página — parecía que el cambio "no se guardó".
              key={match.scheduled_at ?? "sin-horario"}
              type="datetime-local"
              defaultValue={match.scheduled_at ? toLocalDatetimeInput(match.scheduled_at) : ""}
              onBlur={(e) => onScheduleChange(match, e.target.value ? new Date(e.target.value).toISOString() : "")}
              className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-emerald-500"
            />
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="w-10 shrink-0 text-[10px] uppercase text-zinc-400">Set 1</span>
              <input type="number" min={0} value={sets.set1_team1 ?? ""} onChange={(e) => setField("set1_team1", e.target.value)} className="w-12 rounded-md border border-zinc-300 px-2 py-1 text-center text-xs" />
              <span className="text-zinc-400">-</span>
              <input type="number" min={0} value={sets.set1_team2 ?? ""} onChange={(e) => setField("set1_team2", e.target.value)} className="w-12 rounded-md border border-zinc-300 px-2 py-1 text-center text-xs" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-10 shrink-0 text-[10px] uppercase text-zinc-400">Set 2</span>
              <input type="number" min={0} value={sets.set2_team1 ?? ""} onChange={(e) => setField("set2_team1", e.target.value)} className="w-12 rounded-md border border-zinc-300 px-2 py-1 text-center text-xs" />
              <span className="text-zinc-400">-</span>
              <input type="number" min={0} value={sets.set2_team2 ?? ""} onChange={(e) => setField("set2_team2", e.target.value)} className="w-12 rounded-md border border-zinc-300 px-2 py-1 text-center text-xs" />
            </div>
            {(needsThirdSet || sets.set3_team1 != null || sets.set3_team2 != null) && (
              <div className="flex items-center gap-1.5">
                <span className="w-10 shrink-0 text-[10px] uppercase text-zinc-400">Set 3</span>
                <input type="number" min={0} value={sets.set3_team1 ?? ""} onChange={(e) => setField("set3_team1", e.target.value)} className="w-12 rounded-md border border-zinc-300 px-2 py-1 text-center text-xs" />
                <span className="text-zinc-400">-</span>
                <input type="number" min={0} value={sets.set3_team2 ?? ""} onChange={(e) => setField("set3_team2", e.target.value)} className="w-12 rounded-md border border-zinc-300 px-2 py-1 text-center text-xs" />
              </div>
            )}
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => onSaveResult(match, sets)}>
              {played ? "Actualizar resultado" : "Guardar resultado"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
