import { useState } from "react";
import { Download, Loader2, Pencil } from "lucide-react";
import type { Category, Court, Match, Team } from "@/lib/types";
import { useDownloadImage } from "@/lib/useDownloadImage";
import { localDateStr } from "@/lib/format";
import { matchWinner } from "@/lib/tournament-logic";
import { Button } from "./ui";

const DIA_CORTO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

type SetsDraft = Pick<Match, "set1_team1" | "set1_team2" | "set2_team1" | "set2_team2" | "set3_team1" | "set3_team2">;

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DIA_CORTO[dt.getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

function scoreLine(m: Match): string {
  const sets: [number | null, number | null][] = [
    [m.set1_team1, m.set1_team2], [m.set2_team1, m.set2_team2], [m.set3_team1, m.set3_team2],
  ];
  return sets.filter(([a, b]) => a != null && b != null).map(([a, b]) => `${a}-${b}`).join(" ");
}

function MatchRow({
  match, category, team1, team2, editable, onSaveResult,
}: {
  match: Match;
  category?: string;
  team1: string;
  team2: string;
  editable?: boolean;
  onSaveResult?: (m: Match, sets: SetsDraft) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [sets, setSets] = useState<SetsDraft>({
    set1_team1: match.set1_team1, set1_team2: match.set1_team2,
    set2_team1: match.set2_team1, set2_team2: match.set2_team2,
    set3_team1: match.set3_team1, set3_team2: match.set3_team2,
  });
  const winner = matchWinner(match);
  const score = scoreLine(match);

  function setField(field: keyof SetsDraft, raw: string) {
    setSets((s) => ({ ...s, [field]: raw === "" ? null : Number(raw) }));
  }

  function save() {
    onSaveResult?.(match, sets);
    setEditing(false);
  }

  return (
    <div className="py-1">
      <div className="flex items-center gap-2">
        <span className="w-11 shrink-0 rounded-md bg-emerald-50 py-0.5 text-center font-mono text-[10px] font-semibold text-emerald-800">
          {timeLabel(match.scheduled_at as string)}
        </span>
        <div className="min-w-0 flex-1">
          {category && <p className="truncate text-[9px] uppercase tracking-wide text-zinc-400">{category}</p>}
          <p className="truncate text-[11.5px] font-medium leading-tight text-zinc-800">
            <span className={winner === 1 ? "font-bold text-emerald-700" : ""}>{team1}</span>{" "}
            <span className="text-zinc-300">vs</span>{" "}
            <span className={winner === 2 ? "font-bold text-emerald-700" : ""}>{team2}</span>
          </p>
          {score && <p className="font-mono text-[10px] text-zinc-500">{score}</p>}
        </div>
        {editable && (
          <button
            data-html2canvas-ignore="true"
            onClick={() => setEditing((e) => !e)}
            className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-emerald-700"
            aria-label={`Cargar resultado ${team1} vs ${team2}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {editable && editing && (
        <div data-html2canvas-ignore="true" className="ml-[52px] mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 p-2">
          {(["set1", "set2", "set3"] as const).map((s) => (
            <div key={s} className="flex items-center gap-1">
              <input
                type="number" min={0}
                value={sets[`${s}_team1`] ?? ""}
                onChange={(e) => setField(`${s}_team1`, e.target.value)}
                className="w-9 rounded border border-zinc-300 px-1 py-0.5 text-center text-xs"
              />
              <span className="text-zinc-300">-</span>
              <input
                type="number" min={0}
                value={sets[`${s}_team2`] ?? ""}
                onChange={(e) => setField(`${s}_team2`, e.target.value)}
                className="w-9 rounded border border-zinc-300 px-1 py-0.5 text-center text-xs"
              />
            </div>
          ))}
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={save}>
            Guardar
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Grilla vertical de un día (formato historia de Instagram), agrupada por cancha — sirve
 * tanto para ver/cargar resultados (`editable`) como para descargar y compartir. Los
 * controles de carga de resultado llevan `data-html2canvas-ignore` para no aparecer nunca
 * en la imagen exportada, aunque estén dentro del mismo cartel.
 */
export function DailyFixtureStory({
  tournamentName,
  logoUrl,
  date,
  matches,
  courts,
  teamsById,
  categoriesById,
  fileName,
  editable = false,
  onSaveResult,
}: {
  tournamentName: string;
  logoUrl?: string | null;
  date: string;
  matches: Match[];
  courts: Court[];
  teamsById: Record<string, Team>;
  categoriesById: Record<string, Category>;
  fileName: string;
  editable?: boolean;
  onSaveResult?: (m: Match, sets: SetsDraft) => void;
}) {
  const { ref, download, downloading } = useDownloadImage(fileName);

  const dayMatches = matches
    .filter((m) => m.scheduled_at && localDateStr(m.scheduled_at) === date)
    .sort((a, b) => (a.scheduled_at! < b.scheduled_at! ? -1 : 1));
  if (dayMatches.length === 0) {
    return <p className="text-sm text-zinc-500">No hay partidos agendados este día todavía.</p>;
  }

  const byCourt = courts
    .map((c) => ({ court: c, matches: dayMatches.filter((m) => m.court_id === c.id) }))
    .filter((g) => g.matches.length > 0);

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
          <div className="flex flex-col items-center px-7 pb-3 pt-5">
            {logoUrl && (
              // eslint-disable-next-line jsx-a11y/alt-text
              <img src={logoUrl} crossOrigin="anonymous" alt={tournamentName} className="h-14 w-auto max-w-[60%] object-contain" />
            )}
            <p className={`text-[10px] font-semibold uppercase tracking-[0.24em] text-emerald-400 ${logoUrl ? "mt-2" : ""}`}>
              Partidos de hoy
            </p>
            {!logoUrl && <h1 className="mt-1 text-xl font-bold leading-tight text-white">{tournamentName}</h1>}
            <p className="mt-1 text-[11px] font-medium tracking-wide text-emerald-100/70">{dayLabel(date)}</p>
            <div className="mt-2 h-px w-14 bg-emerald-500/50" />
          </div>

          <div className="flex flex-col gap-2 px-5 pb-4">
            <div className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.25)]">
              <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-3.5 py-1.5">
                <p className="text-xs font-bold uppercase tracking-wide text-white">{dayLabel(date)}</p>
              </div>
              <div className="flex flex-col divide-y divide-zinc-100 px-3.5 py-2">
                {byCourt.map(({ court, matches: cm }) => (
                  <div key={court.id} className="py-1.5 first:pt-0 last:pb-0">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">{court.name}</p>
                    <div className="flex flex-col gap-1">
                      {cm.map((m) => (
                        <MatchRow
                          key={m.id}
                          match={m}
                          category={categoriesById[m.category_id]?.name}
                          team1={teamsById[m.team1_id ?? ""]?.name ?? "?"}
                          team2={teamsById[m.team2_id ?? ""]?.name ?? "?"}
                          editable={editable}
                          onSaveResult={onSaveResult}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pb-3 text-center">
            <p className="text-[9px] font-medium uppercase tracking-[0.2em] text-emerald-100/30">{tournamentName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
