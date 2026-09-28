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
      {/* Antes eran 9 columnas separadas (sets/games a favor y en contra cada uno por su
          lado) -- obligaba a hacer scroll de costado en el celular para ver "Puntos". Se
          combinan favor/contra en una sola columna ("12-4") para que entre todo en pantalla
          sin perder ningún dato. `overflow-x-auto` queda como red de seguridad para nombres
          de equipo muy largos, pero ya no debería hacer falta en la mayoría de los casos. */}
      <div ref={ref} className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-3 sm:p-4">
        <table className="w-full text-[11px] sm:text-xs">
          <thead className="text-left text-zinc-400">
            <tr>
              <th className="py-1 pr-1.5">Equipo</th>
              <th className="px-1 text-center">PJ</th>
              <th className="px-1 text-center">PG</th>
              <th className="px-1 text-center">PP</th>
              <th className="px-1 text-center">Sets</th>
              <th className="px-1 text-center">Games</th>
              <th className="px-1 text-center font-semibold text-zinc-600">Pts</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => (
              <tr key={s.team_id} className="border-t border-zinc-100">
                <td className="max-w-[34vw] truncate py-1.5 pr-1.5 font-medium sm:max-w-none" title={teamsById[s.team_id]?.name}>
                  {i === 0 && <Trophy className="mr-1 inline h-3 w-3 shrink-0 text-amber-500" />}
                  {teamsById[s.team_id]?.name ?? "?"}
                </td>
                <td className="px-1 text-center">{s.played}</td>
                <td className="px-1 text-center">{s.won}</td>
                <td className="px-1 text-center">{s.lost}</td>
                <td className="whitespace-nowrap px-1 text-center">{s.sets_won}-{s.sets_lost}</td>
                <td className="whitespace-nowrap px-1 text-center">{s.games_won}-{s.games_lost}</td>
                <td className="px-1 text-center font-semibold text-emerald-700">{s.won * 2}</td>
              </tr>
            ))}
            {standings.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-center text-zinc-400">Todavía no hay equipos.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
