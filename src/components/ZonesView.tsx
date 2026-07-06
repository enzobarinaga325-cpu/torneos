import { Download, Loader2, Trophy } from "lucide-react";
import type { Match, Team, Zone } from "@/lib/types";
import { computeStandings } from "@/lib/tournament-logic";
import { useDownloadImage } from "@/lib/useDownloadImage";
import { Button } from "./ui";

/** Vista prolija de las zonas (equipos + tabla de posiciones) lista para descargar y compartir. */
export function ZonesView({
  zones, teams, zoneMatches, teamsById, fileName,
}: {
  zones: Zone[];
  teams: Team[];
  zoneMatches: Match[];
  teamsById: Record<string, Team>;
  fileName: string;
}) {
  const { ref, download, downloading } = useDownloadImage(fileName);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="secondary" onClick={download} disabled={downloading}>
          {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Descargar imagen
        </Button>
      </div>
      <div ref={ref} className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {zones.map((zone) => {
            const zoneTeamIds = teams.filter((t) => t.zone_id === zone.id).map((t) => t.id);
            const standings = computeStandings(zoneTeamIds, zoneMatches.filter((m) => m.zone_id === zone.id));
            return (
              <div key={zone.id} className="rounded-lg border border-zinc-200 p-3">
                <h3 className="mb-2 font-semibold">{zone.name}</h3>
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
                        <td className="px-2 text-center">{s.sets_diff > 0 ? `+${s.sets_diff}` : s.sets_diff}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
