import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Trophy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Category, Court, Match, Team, Tournament, Zone } from "@/lib/types";
import { computeStandings, matchWinner } from "@/lib/tournament-logic";
import { formatDateRange, todayStr } from "@/lib/format";
import { useSiteBackground } from "@/lib/useSiteBackground";
import { FixtureBracket } from "@/components/FixtureBracket";
import { ZonesView } from "@/components/ZonesView";
import { DayGrid } from "@/components/DayGrid";
import { Select, Spinner } from "@/components/ui";

export function TournamentDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [tournament, setTournament] = useState<Tournament | null | undefined>(undefined);
  const [categories, setCategories] = useState<Category[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>("");
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

        if (cats && cats.length > 0) {
          const categoryIds = cats.map((c) => c.id);
          const [{ data: allT }, { data: allM }] = await Promise.all([
            supabase.from("teams").select("*").in("category_id", categoryIds),
            supabase.from("matches").select("*").in("category_id", categoryIds).not("scheduled_at", "is", null),
          ]);
          setAllTeams(allT ?? []);
          setAllMatches((allM as Match[]) ?? []);
          const dates = [...new Set((allM ?? []).map((m) => (m.scheduled_at as string).slice(0, 10)))].sort();
          const today = todayStr();
          const preferred = dates.find((d) => d >= today) ?? dates[0];
          if (preferred) setSelectedDay(preferred);
        }
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
  const zoneMatches = matches.filter((m) => m.stage === "zona");
  const fixtureMatches = matches.filter((m) => m.stage === "fixture");

  const allTeamsById = useMemo(() => Object.fromEntries(allTeams.map((t) => [t.id, t])), [allTeams]);
  const categoriesById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  const availableDays = useMemo(
    () => [...new Set(allMatches.map((m) => (m.scheduled_at as string).slice(0, 10)))].sort(),
    [allMatches],
  );

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

      {availableDays.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Grilla del día</h2>
            <Select value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} className="w-auto">
              {availableDays.map((d) => (
                <option key={d} value={d}>{d}{d === todayStr() ? " (hoy)" : ""}</option>
              ))}
            </Select>
          </div>
          <DayGrid
            date={selectedDay}
            matches={allMatches}
            courts={courts}
            teamsById={allTeamsById}
            categoriesById={categoriesById}
            fileName={`grilla-${tournament.slug}-${selectedDay}`}
            showDownload={false}
          />
        </div>
      )}

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
              <ZonesView
                zones={zones}
                teams={teams}
                zoneMatches={zoneMatches}
                teamsById={teamsById}
                fileName={`zonas-${tournament.slug}-${categories.find((c) => c.id === activeCategory)?.name ?? ""}`}
                showDownload={false}
              />
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
                        <PublicMatchLine key={m.id} match={m} teamsById={teamsById} />
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
                showDownload={false}
              />
            </div>
          )}
        </>
      )}
    </div>
    </div>
  );
}

/** Solo equipos y resultado — la cancha y el horario ya se ven arriba, en la grilla del día. */
function PublicMatchLine({ match, teamsById }: { match: Match; teamsById: Record<string, Team> }) {
  const t1 = match.team1_id ? teamsById[match.team1_id]?.name ?? "?" : "—";
  const t2 = match.team2_id ? teamsById[match.team2_id]?.name ?? "?" : "—";
  const played = matchWinner(match) != null;
  const sets = [
    [match.set1_team1, match.set1_team2],
    [match.set2_team1, match.set2_team2],
    [match.set3_team1, match.set3_team2],
  ].filter(([a, b]) => a != null && b != null) as [number, number][];

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
    </div>
  );
}
