import { Download, Loader2, Trophy } from "lucide-react";
import type { Match, Team } from "@/lib/types";
import { computeStandings } from "@/lib/tournament-logic";
import { useDownloadImage } from "@/lib/useDownloadImage";
import { Button } from "./ui";

/**
 * Tabla de posiciones de una liga (todos los equipos de la categoría juntos, no hay
 * zonas). Puntos: ganar suma 2; perder en 3 sets suma 1; perder en 2 sets suma 0 (ver
 * `computeStandings`). La tabla se ordena por puntos. Si se pasa `qualifiers`, las
 * primeras N filas (las que hoy estarían clasificando) se pintan de verde.
 */
export function LeagueStandings({
  teamIds, matches, teamsById, fileName, showDownload = true, qualifiers,
}: {
  teamIds: string[];
  matches: Match[];
  teamsById: Record<string, Team>;
  fileName: string;
  showDownload?: boolean;
  /** Cuántas pasan de esta zona (las primeras N se marcan en verde). */
  qualifiers?: number | null;
}) {
  const { ref, download, downloading } = useDownloadImage(fileName);
  const standings = computeStandings(teamIds, matches, { byPoints: true });
  const pasan = qualifiers && qualifiers > 0 ? Math.min(qualifiers, standings.length) : 0;

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
              <tr
                key={s.team_id}
                className={`border-t ${i < pasan ? "border-emerald-100 bg-emerald-50" : "border-zinc-100"} ${i === pasan - 1 && pasan < standings.length ? "border-b-2 border-b-emerald-500" : ""}`}
              >
                <td
                  className={`max-w-[34vw] truncate py-1.5 pr-1.5 font-medium sm:max-w-none ${i < pasan ? "border-l-4 border-l-emerald-500 pl-1.5 text-emerald-800" : "pl-[10px]"}`}
                  title={teamsById[s.team_id]?.name}
                >
                  {i === 0 && <Trophy className="mr-1 inline h-3 w-3 shrink-0 text-amber-500" />}
                  {teamsById[s.team_id]?.name ?? "?"}
                </td>
                <td className="px-1 text-center">{s.played}</td>
                <td className="px-1 text-center">{s.won}</td>
                <td className="px-1 text-center">{s.lost}</td>
                <td className="whitespace-nowrap px-1 text-center">
                  <span className="text-emerald-600">{s.sets_won}</span>-<span className="text-red-500">{s.sets_lost}</span>
                </td>
                <td className="whitespace-nowrap px-1 text-center">
                  <span className="text-emerald-600">{s.games_won}</span>-<span className="text-red-500">{s.games_lost}</span>
                </td>
                <td className="px-1 text-center font-semibold text-emerald-700">{s.points}</td>
              </tr>
            ))}
            {standings.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-center text-zinc-400">Todavía no hay equipos.</td>
              </tr>
            )}
          </tbody>
        </table>
        {pasan > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-[10px] text-zinc-500 sm:text-[11px]">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />
            En verde: puestos de clasificación (pasan {qualifiers} por zona)
          </p>
        )}
      </div>
    </div>
  );
}
