import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, MapPin, Trophy, Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Category, Court, Match, Team, Tournament, Zone } from "@/lib/types";
import { computeStandings, matchWinner } from "@/lib/tournament-logic";
import { formatDateRange } from "@/lib/format";
import { useSiteBackground } from "@/lib/useSiteBackground";
import { FixtureBracket } from "@/components/FixtureBracket";
import { Spinner } from "@/components/ui";

function formatSchedule(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function TournamentDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [tournament, setTournament] = useState<Tournament | null | undefined>(undefined);
  const [categories, setCategories] = useState<Category[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const backgroundStyle = useSiteBackground();

  useEffect(() => {
    if (!slug) return;
    supabase
      .from("tournaments")
      .select("*")
      .eq("slug", slug)
      .eq("published", true)
      .maybeSingle()
      .then(async ({ data: t }) => {
        setTournament(t ?? null);
        if (!t) return;
        const [{ data: cats }, { data: co }] = await Promise.all([
          supabase.from("categories").select("*").eq("tournament_id", t.id).order("created_at"),
          supabase.from("courts").select("*").eq("tournament_id", t.id).order("name"),
        ]);
        setCategories(cats ?? []);
        setCourts(co ?? []);
        if (cats && cats.length > 0) setActiveCategory(cats[0].id);
      });
  }, [slug]);

  useEffect(() => {
    if (!activeCategory) return;
    Promise.all([
      supabase.from("teams").select("*").eq("category_id", activeCategory).order("name"),
      supabase.from("zones").select("*").eq("category_id", activeCategory).order("position"),
      supabase.from("matches").select("*").eq("category_id", activeCategory).order("round_order").order("position"),
    ]).then(([{ data: t }, { data: z }, { data: m }]) => {
      setTeams(t ?? []);
      setZones(z ?? []);
      setMatches((m as Match[]) ?? []);
    });
  }, [activeCategory]);

  const teamsById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t])), [teams]);
  const courtsById = useMemo(() => Object.fromEntries(courts.map((c) => [c.id, c])), [courts]);
  const zoneMatches = matches.filter((m) => m.stage === "zona");
  const fixtureMatches = matches.filter((m) => m.stage === "fixture");

  if (tournament === undefined) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (tournament === null) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-lg font-medium">No encontramos este torneo.</p>
        <Link to="/" className="text-sm underline">Volver</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={backgroundStyle}>
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 px-4 py-8">
      <div>
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
          <ArrowLeft className="h-3.5 w-3.5" /> Torneos
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{tournament.name}</h1>
        {tournament.start_date && <p className="text-sm text-zinc-500">{formatDateRange(tournament.start_date, tournament.end_date)}</p>}
      </div>

      {categories.length === 0 ? (
        <p className="text-sm text-zinc-500">Todavía no hay categorías cargadas.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1 text-sm w-fit">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategory(c.id)}
                className={`rounded-md px-3 py-1.5 ${activeCategory === c.id ? "bg-white font-semibold shadow-sm" : "text-zinc-500"}`}
              >
                {c.name}
              </button>
            ))}
          </div>

          {zones.length === 0 ? (
            <p className="text-sm text-zinc-500">Todavía no se armaron las zonas de esta categoría.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Zonas</h2>
              {zones.map((zone) => {
                const zoneTeamIds = teams.filter((t) => t.zone_id === zone.id).map((t) => t.id);
                const standings = computeStandings(zoneTeamIds, zoneMatches.filter((m) => m.zone_id === zone.id));
                const myMatches = zoneMatches.filter((m) => m.zone_id === zone.id);
                return (
                  <div key={zone.id} className="rounded-xl border border-zinc-200 bg-white p-4">
                    <h3 className="mb-2 font-semibold">{zone.name}</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-zinc-400">
                          <tr>
                            <th className="py-1 pr-2">Equipo</th>
                            <th className="px-2 text-center">PJ</th>
                            <th className="px-2 text-center">G</th>
                            <th className="px-2 text-center">P</th>
                            <th className="px-2 text-center">Dif.</th>
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
                              <td className="px-2 text-center">{s.sets_diff > 0 ? `+${s.sets_diff}` : s.sets_diff}/{s.games_diff > 0 ? `+${s.games_diff}` : s.games_diff}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex flex-col gap-1.5">
                      {myMatches.map((m) => (
                        <PublicMatchLine key={m.id} match={m} teamsById={teamsById} courtsById={courtsById} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {fixtureMatches.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Fixture</h2>
              <FixtureBracket
                matches={fixtureMatches}
                teamsById={teamsById}
                fileName={`fixture-${tournament.slug}-${categories.find((c) => c.id === activeCategory)?.name ?? ""}`}
              />
            </div>
          )}
        </>
      )}
    </div>
    </div>
  );
}

function PublicMatchLine({ match, teamsById, courtsById }: { match: Match; teamsById: Record<string, Team>; courtsById: Record<string, Court> }) {
  const t1 = match.team1_id ? teamsById[match.team1_id]?.name ?? "?" : "—";
  const t2 = match.team2_id ? teamsById[match.team2_id]?.name ?? "?" : "—";
  const played = matchWinner(match) != null;
  const sets = [
    [match.set1_team1, match.set1_team2],
    [match.set2_team1, match.set2_team2],
    [match.set3_team1, match.set3_team2],
  ].filter(([a, b]) => a != null && b != null) as [number, number][];
  const schedule = formatSchedule(match.scheduled_at);
  const court = match.court_id ? courtsById[match.court_id]?.name : null;

  if (!match.team1_id || !match.team2_id) {
    return <p className="text-xs text-zinc-400">{t1 !== "—" ? t1 : t2} — pase directo</p>;
  }

  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className={match.winner_id === match.team1_id ? "font-semibold text-emerald-700" : ""}>{t1}</span>
        {played && <span className="font-mono text-xs">{sets.map(([a]) => a).join(" ")}</span>}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={match.winner_id === match.team2_id ? "font-semibold text-emerald-700" : ""}>{t2}</span>
        {played && <span className="font-mono text-xs">{sets.map(([, b]) => b).join(" ")}</span>}
      </div>
      {(schedule || court) && (
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
          {schedule && (
            <span className="flex items-center gap-0.5">
              <Clock className="h-3 w-3" /> {schedule}
            </span>
          )}
          {court && (
            <span className="flex items-center gap-0.5">
              <MapPin className="h-3 w-3" /> {court}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
