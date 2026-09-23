import { Download, Loader2, Trophy } from "lucide-react";
import type { Match, Team } from "@/lib/types";
import { computeStandings } from "@/lib/tournament-logic";
import { useDownloadImage } from "@/lib/useDownloadImage";
import { Button } from "./ui";

/**
 * Tabla de posiciones de una liga (todos los equipos de la categoría juntos, no hay
 * zonas). "Puntos" se calcula como 2 por partido ganado, 0 por perdido — el criterio más
 * común en ligas amateur; si tu liga usa otra puntuación, es el único número que haría
 * falta ajustar acá.
 */
export function LeagueStandings({
  teamIds, matches, teamsById, fileName, showDownload = true,
}: {
  teamIds: string[];
  matches: Match[];
  teamsById: Record<string, Team>;
  fileName: string;
  showDownload?: boolean;
}) {
  const { ref, download, downloading } = useDownloadImage(fileName);
  const standings = computeStandings(teamIds, matches);

  return (
    <div className="flex flex-col gap-3">
      {showDownload && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={download} disabled={downloading}>
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Descargar imagen
          </Button>
        </div>
      )}
      <div ref={ref} className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-4">
        <table className="w-full text-xs">
          <thead className="text-left text-zinc-400">
            <tr>
              <th className="py-1 pr-2">Equipo</th>
              <th className="px-2 text-center">PJ</th>
              <th className="px-2 text-center">PG</th>
              <th className="px-2 text-center">PP</th>
              <th className="px-2 text-center">Sets a favor</th>
              <th className="px-2 text-center">Sets en contra</th>
              <th className="px-2 text-center">Games a favor</th>
              <th className="px-2 text-center">Games en contra</th>
              <th className="px-2 text-center font-semibold text-zinc-600">Puntos</th>
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
                <td className="px-2 text-center">{s.sets_won}</td>
                <td className="px-2 text-center">{s.sets_lost}</td>
                <td className="px-2 text-center">{s.games_won}</td>
                <td className="px-2 text-center">{s.games_lost}</td>
                <td className="px-2 text-center font-semibold text-emerald-700">{s.won * 2}</td>
              </tr>
            ))}
            {standings.length === 0 && (
              <tr>
                <td colSpan={9} className="py-3 text-center text-zinc-400">Todavía no hay equipos.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
