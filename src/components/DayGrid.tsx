import { Download, Loader2 } from "lucide-react";
import type { Category, Court, Match, Team } from "@/lib/types";
import { useDownloadImage } from "@/lib/useDownloadImage";
import { Button } from "./ui";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

/** Grilla cancha x horario de todos los partidos agendados un día, para descargar y compartir. */
export function DayGrid({
  date, matches, courts, teamsById, categoriesById, fileName,
}: {
  date: string;
  matches: Match[];
  courts: Court[];
  teamsById: Record<string, Team>;
  categoriesById: Record<string, Category>;
  fileName: string;
}) {
  const { ref, download, downloading } = useDownloadImage(fileName);

  const dayMatches = matches.filter((m) => m.scheduled_at && m.scheduled_at.slice(0, 10) === date);
  const times = [...new Set(dayMatches.map((m) => m.scheduled_at as string))].sort();

  if (dayMatches.length === 0) {
    return <p className="text-sm text-zinc-500">No hay partidos agendados este día todavía.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="secondary" onClick={download} disabled={downloading}>
          {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Descargar imagen
        </Button>
      </div>
      <div ref={ref} className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-4">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="p-2 text-left text-zinc-400">Hora</th>
              {courts.map((c) => (
                <th key={c.id} className="border-l border-zinc-100 p-2 text-center font-semibold text-zinc-700">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {times.map((t) => (
              <tr key={t} className="border-t border-zinc-100">
                <td className="p-2 font-mono font-medium text-zinc-600">{timeLabel(t)}</td>
                {courts.map((c) => {
                  const m = dayMatches.find((x) => x.scheduled_at === t && x.court_id === c.id);
                  if (!m) return <td key={c.id} className="border-l border-zinc-100 p-2" />;
                  const cat = categoriesById[m.category_id]?.name ?? "";
                  const t1 = m.team1_id ? teamsById[m.team1_id]?.name ?? "?" : "—";
                  const t2 = m.team2_id ? teamsById[m.team2_id]?.name ?? "?" : "—";
                  return (
                    <td key={c.id} className="border-l border-zinc-100 p-2 align-top">
                      <div className="text-[10px] uppercase tracking-wide text-emerald-600">{cat}</div>
                      <div className="font-medium">{t1}</div>
                      <div className="text-zinc-400">vs</div>
                      <div className="font-medium">{t2}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
