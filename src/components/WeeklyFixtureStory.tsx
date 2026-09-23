import { Download, Loader2 } from "lucide-react";
import type { Category, Court, Match, Team } from "@/lib/types";
import { useDownloadImage } from "@/lib/useDownloadImage";
import { localDateStr } from "@/lib/format";
import { Button } from "./ui";

const DIA_CORTO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DIA_CORTO[dt.getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

/**
 * Cartel vertical (formato historia de Instagram) con todos los partidos de una semana,
 * agrupados por día y, dentro de cada día, por cancha — para descargar y subir directo.
 */
export function WeeklyFixtureStory({
  tournamentName,
  logoUrl,
  weekDates,
  matches,
  courts,
  teamsById,
  categoriesById,
  fileName,
}: {
  tournamentName: string;
  logoUrl?: string | null;
  weekDates: string[];
  matches: Match[];
  courts: Court[];
  teamsById: Record<string, Team>;
  categoriesById: Record<string, Category>;
  fileName: string;
}) {
  const { ref, download, downloading } = useDownloadImage(fileName);

  const weekMatches = matches.filter((m) => m.scheduled_at && weekDates.includes(localDateStr(m.scheduled_at)));
  if (weekMatches.length === 0) {
    return <p className="text-sm text-zinc-500">No hay partidos agendados esta semana todavía.</p>;
  }

  const activeDays = weekDates.filter((d) => weekMatches.some((m) => localDateStr(m.scheduled_at as string) === d));
  const rangeLabel = `${dayLabel(weekDates[0])} al ${dayLabel(weekDates[weekDates.length - 1])}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="secondary" onClick={download} disabled={downloading}>
          {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Descargar imagen
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200">
        <div ref={ref} className="mx-auto w-[480px] bg-gradient-to-b from-zinc-950 via-zinc-950 to-emerald-950">
          <div className="flex flex-col items-center px-7 pb-6 pt-9">
            {logoUrl && (
              // eslint-disable-next-line jsx-a11y/alt-text
              <img src={logoUrl} crossOrigin="anonymous" alt={tournamentName} className="h-24 w-auto max-w-[70%] object-contain" />
            )}
            <p className={`text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-400 ${logoUrl ? "mt-5" : ""}`}>
              Programación de la semana
            </p>
            {!logoUrl && <h1 className="mt-1.5 text-2xl font-bold leading-tight text-white">{tournamentName}</h1>}
            <p className="mt-1.5 text-xs font-medium tracking-wide text-emerald-100/70">{rangeLabel}</p>
            <div className="mt-5 h-px w-14 bg-emerald-500/50" />
          </div>

          <div className="flex flex-col gap-3.5 px-6 pb-8">
            {activeDays.map((date) => {
              const dayMatches = weekMatches
                .filter((m) => localDateStr(m.scheduled_at as string) === date)
                .sort((a, b) => (a.scheduled_at! < b.scheduled_at! ? -1 : 1));
              const byCourt = courts
                .map((c) => ({ court: c, matches: dayMatches.filter((m) => m.court_id === c.id) }))
                .filter((g) => g.matches.length > 0);
              return (
                <div key={date} className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.25)]">
                  <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-4 py-2.5">
                    <p className="text-sm font-bold uppercase tracking-wide text-white">{dayLabel(date)}</p>
                  </div>
                  <div className="flex flex-col divide-y divide-zinc-100 px-4 py-3">
                    {byCourt.map(({ court, matches: cm }) => (
                      <div key={court.id} className="py-2.5 first:pt-0 last:pb-0">
                        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700">{court.name}</p>
                        <div className="flex flex-col gap-1.5">
                          {cm.map((m) => (
                            <div key={m.id} className="flex items-center gap-2.5">
                              <span className="w-12 shrink-0 rounded-md bg-emerald-50 py-0.5 text-center font-mono text-[11px] font-semibold text-emerald-800">
                                {timeLabel(m.scheduled_at as string)}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[10px] uppercase tracking-wide text-zinc-400">{categoriesById[m.category_id]?.name}</p>
                                <p className="truncate text-[12.5px] font-medium leading-tight text-zinc-800">
                                  {teamsById[m.team1_id ?? ""]?.name ?? "?"} <span className="text-zinc-300">vs</span> {teamsById[m.team2_id ?? ""]?.name ?? "?"}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pb-6 text-center">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-emerald-100/30">{tournamentName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
