import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Category, Court, Match, Team, Tournament, Zone } from "@/lib/types";
import { formatDateRange, localDateStr, todayStr } from "@/lib/format";
import { matchWinner } from "@/lib/tournament-logic";
import { useSiteBackground } from "@/lib/useSiteBackground";
import { FixtureBracket } from "@/components/FixtureBracket";
import { ZonesView } from "@/components/ZonesView";
import { LeagueStandings } from "@/components/LeagueStandings";
import { DailyFixtureStory } from "@/components/DailyFixtureStory";
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
          const dates = [...new Set((allM ?? []).map((m) => localDateStr(m.scheduled_at as string)))].sort();
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
  const isLiga = tournament?.modalidad === "liga";
  const zoneMatches = matches.filter((m) => m.stage === "zona");
  const fixtureMatches = matches.filter((m) => m.stage === "fixture");
  const ligaMatches = matches.filter((m) => m.stage === "liga");

  const allTeamsById = useMemo(() => Object.fromEntries(allTeams.map((t) => [t.id, t])), [allTeams]);
  const categoriesById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  const availableDays = useMemo(
    () => [...new Set(allMatches.map((m) => localDateStr(m.scheduled_at as string)))].sort(),
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
          <DailyFixtureStory
            tournamentName={tournament.name}
            logoUrl={tournament.logo_url}
            date={selectedDay}
            matches={allMatches}
            courts={courts}
            teamsById={allTeamsById}
            categoriesById={categoriesById}
            fileName={`grilla-${tournament.slug}-${selectedDay}`}
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

          {isLiga ? (
            <div className="flex flex-col gap-6">
              {(zones.length > 0 ? zones : [null]).map((zone) => {
                const zoneTeamIds = zone ? teams.filter((t) => t.zone_id === zone.id).map((t) => t.id) : teams.map((t) => t.id);
                const zoneLigaMatches = zone ? ligaMatches.filter((m) => m.zone_id === zone.id) : ligaMatches;
                if (zone && zoneLigaMatches.length === 0) return null;
                return (
                  <div key={zone?.id ?? "sin-zona"} className="flex flex-col gap-4">
                    {zone && <h2 className="text-base font-semibold">{zone.name}</h2>}
                    <div>
                      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Tabla de posiciones</h2>
                      <LeagueStandings
                        teamIds={zoneTeamIds}
                        matches={zoneLigaMatches}
                        teamsById={teamsById}
                        fileName={`posiciones-${tournament.slug}-${categories.find((c) => c.id === activeCategory)?.name ?? ""}${zone ? `-${zone.name}` : ""}`}
                        showDownload={false}
                      />
                    </div>

                    {zoneLigaMatches.length > 0 && (
                      <div>
                        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Fixture por jornada</h2>
                        <div className="flex flex-col gap-3">
                          {[...new Set(zoneLigaMatches.map((m) => m.round_order))].sort((a, b) => (a ?? 0) - (b ?? 0)).map((ro) => {
                            const roundMatches = zoneLigaMatches.filter((m) => m.round_order === ro);
                            return (
                              <div key={ro} className="rounded-xl border border-zinc-200 bg-white p-4">
                                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{roundMatches[0]?.round_name}</h3>
                                <div className="flex flex-col gap-2">
                                  {roundMatches.map((m) => {
                                    const winner = matchWinner(m);
                                    return (
                                      <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
                                        <div className="flex flex-1 items-center justify-between gap-2 min-w-[180px]">
                                          <span className={winner === 1 ? "font-semibold text-emerald-700" : ""}>
                                            {teamsById[m.team1_id ?? ""]?.name ?? "?"}
                                          </span>
                                          <span className="text-xs text-zinc-400">vs</span>
                                          <span className={winner === 2 ? "font-semibold text-emerald-700" : ""}>
                                            {teamsById[m.team2_id ?? ""]?.name ?? "?"}
                                          </span>
                                        </div>
                                        {m.scheduled_at && (
                                          <span className="shrink-0 font-mono text-xs text-zinc-500">
                                            {new Date(m.scheduled_at).toLocaleString("es-AR", {
                                              weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                                            })}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <>
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
                  {zoneMatches.length > 0 && (
                    <div className="flex flex-col gap-3">
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Partidos por zona</h2>
                      {zones.map((zone) => {
                        const myMatches = zoneMatches.filter((m) => m.zone_id === zone.id);
                        if (myMatches.length === 0) return null;
                        return (
                          <div key={zone.id} className="rounded-xl border border-zinc-200 bg-white p-4">
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{zone.name}</h3>
                            <div className="flex flex-col gap-2">
                              {myMatches.map((m) => {
                                const winner = matchWinner(m);
                                return (
                                  <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
                                    <div className="flex flex-1 items-center justify-between gap-2 min-w-[180px]">
                                      <span className={winner === 1 ? "font-semibold text-emerald-700" : ""}>
                                        {teamsById[m.team1_id ?? ""]?.name ?? "?"}
                                      </span>
                                      <span className="text-xs text-zinc-400">vs</span>
                                      <span className={winner === 2 ? "font-semibold text-emerald-700" : ""}>
                                        {teamsById[m.team2_id ?? ""]?.name ?? "?"}
                                      </span>
                                    </div>
                                    {m.scheduled_at && (
                                      <span className="shrink-0 font-mono text-xs text-zinc-500">
                                        {new Date(m.scheduled_at).toLocaleString("es-AR", {
                                          weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                                        })}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
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
        </>
      )}
    </div>
    </div>
  );
}
