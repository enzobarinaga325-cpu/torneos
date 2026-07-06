import { Download, Loader2 } from "lucide-react";
import type { Category, Court, Match, Team } from "@/lib/types";
import { useDownloadImage } from "@/lib/useDownloadImage";
import { localDateStr, todayStr } from "@/lib/format";
import { Button, Badge } from "./ui";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

/** Grilla cancha x horario de todos los partidos agendados un día, para descargar y compartir. */
export function DayGrid({
  date, matches, courts, teamsById, categoriesById, fileName, showDownload = true,
}: {
  date: string;
  matches: Match[];
  courts: Court[];
  teamsById: Record<string, Team>;
  categoriesById: Record<string, Category>;
  fileName: string;
  showDownload?: boolean;
}) {
  const { ref, download, downloading } = useDownloadImage(fileName);
  const isToday = date === todayStr();

  const dayMatches = matches.filter((m) => m.scheduled_at && localDateStr(m.scheduled_at) === date);
  const times = [...new Set(dayMatches.map((m) => m.scheduled_at as string))].sort();

  if (dayMatches.length === 0) {
    return <p className="text-sm text-zinc-500">No hay partidos agendados este día todavía.</p>;
  }

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
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-700">{date}</span>
          {isToday && <Badge color="green">HOY</Badge>}
        </div>
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
                  // Normalmente hay un solo partido por cancha+horario; si hay más de uno
                  // (quedó pisado de una corrida vieja de "Autocompletar horarios"), se
                  // muestran todos para no ocultar ninguno mientras se corrige a mano.
                  const cellMatches = dayMatches.filter((x) => x.scheduled_at === t && x.court_id === c.id);
                  if (cellMatches.length === 0) return <td key={c.id} className="border-l border-zinc-100 p-2" />;
                  return (
                    <td key={c.id} className="border-l border-zinc-100 p-2 align-top">
                      {cellMatches.map((m, i) => {
                        const cat = categoriesById[m.category_id]?.name ?? "";
                        const t1 = m.team1_id ? teamsById[m.team1_id]?.name ?? "?" : "—";
                        const t2 = m.team2_id ? teamsById[m.team2_id]?.name ?? "?" : "—";
                        return (
                          <div key={m.id} className={i > 0 ? "mt-1.5 border-t border-amber-300 pt-1.5" : ""}>
                            <div className="text-[10px] uppercase tracking-wide text-emerald-600">{cat}</div>
                            <div className="font-medium">{t1}</div>
                            <div className="text-zinc-400">vs</div>
                            <div className="font-medium">{t2}</div>
                          </div>
                        );
                      })}
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
