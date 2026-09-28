import { useState } from "react";
import { Download, Loader2, Pencil } from "lucide-react";
import type { Category, Court, Match, Team } from "@/lib/types";
import { useStoryDownload } from "@/lib/useStoryDownload";
import { localDateStr, toLocalDatetimeInput } from "@/lib/format";
import { matchWinner } from "@/lib/tournament-logic";
import { Button, Select } from "./ui";
import fixtureBackground from "@/assets/fixture-background.png";

const DIA_CORTO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

type SetsDraft = Pick<Match, "set1_team1" | "set1_team2" | "set2_team1" | "set2_team2" | "set3_team1" | "set3_team2">;

function timeLabel(iso: string): string {
  // Formato 24hs (ej. "19:00") en vez de "07:00 p. m." -- ese sufijo obligaba a partir el
  // horario en dos líneas dentro de una columna angosta, que quedaba apretado y feo.
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
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
  match, category, team1, team2, courts, editable, onSaveResult, onCourtChange, onScheduleChange, onCancelTurn,
}: {
  match: Match;
  category?: string;
  team1: string;
  team2: string;
  courts: Court[];
  editable?: boolean;
  onSaveResult?: (m: Match, sets: SetsDraft) => void;
  onCourtChange?: (m: Match, courtId: string) => void;
  onScheduleChange?: (m: Match, iso: string) => void;
  onCancelTurn?: (m: Match) => void;
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
    <div className="relative py-1.5 text-center">
      <span className="text-[13px] font-extrabold leading-none text-emerald-300">
        {timeLabel(match.scheduled_at as string)}
      </span>
      {category && <p className="mt-0.5 break-words text-[9px] font-medium uppercase tracking-wide text-white/45">{category}</p>}
      <p className={`mt-0.5 break-words text-[12.5px] leading-tight ${winner === 1 ? "font-bold text-emerald-300" : "font-semibold text-white"}`}>
        {team1}
      </p>
      <p className={`break-words text-[12.5px] leading-tight ${winner === 2 ? "font-bold text-emerald-300" : "font-semibold text-white"}`}>
        <span className="font-normal text-white/35">vs </span>{team2}
      </p>
      {score && <p className="mt-0.5 font-mono text-[10px] text-white/55">{score}</p>}
      {editable && (
        <button
          data-html2canvas-ignore="true"
          onClick={() => setEditing((e) => !e)}
          className="absolute right-0 top-1.5 shrink-0 rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-emerald-300"
          aria-label={`Cargar resultado ${team1} vs ${team2}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}

      {editable && editing && (
        <div data-html2canvas-ignore="true" className="mt-1.5 flex flex-col gap-2 rounded-lg bg-zinc-50 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Select
              value={match.court_id ?? ""}
              onChange={(e) => onCourtChange?.(match, e.target.value)}
              className="w-24 shrink-0 py-1 text-xs"
            >
              <option value="">Cancha</option>
              {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <input
              key={match.scheduled_at ?? "sin-horario"}
              type="datetime-local"
              defaultValue={match.scheduled_at ? toLocalDatetimeInput(match.scheduled_at) : ""}
              onBlur={(e) => onScheduleChange?.(match, e.target.value ? new Date(e.target.value).toISOString() : "")}
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-emerald-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            {onCancelTurn && (
              <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => onCancelTurn(match)}>
                Cancelar turno
              </Button>
            )}
          </div>
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
  date,
  matches,
  courts,
  teamsById,
  categoriesById,
  fileName,
  editable = false,
  onSaveResult,
  onCourtChange,
  onScheduleChange,
  onCancelTurn,
  showDownload = true,
}: {
  tournamentName: string;
  date: string;
  matches: Match[];
  courts: Court[];
  teamsById: Record<string, Team>;
  categoriesById: Record<string, Category>;
  fileName: string;
  editable?: boolean;
  onSaveResult?: (m: Match, sets: SetsDraft) => void;
  onCourtChange?: (m: Match, courtId: string) => void;
  onScheduleChange?: (m: Match, iso: string) => void;
  onCancelTurn?: (m: Match) => void;
  showDownload?: boolean;
}) {
  const { headerRef, contentRef, footerRef, download, downloading } = useStoryDownload(fileName, {
    width: 1080,
    height: 1920,
    fallbackColor: "#0b1730",
    backgroundImageUrl: fixtureBackground,
  });

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
      {showDownload && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={download} disabled={downloading}>
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Descargar imagen
          </Button>
        </div>
      )}

      <div className="mx-auto w-full max-w-[480px]">
        <div
          className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1730] bg-top bg-no-repeat shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
          style={{ backgroundImage: `url(${fixtureBackground})`, backgroundSize: "100% auto" }}
        >
          {/* padding-top en % (no px fijo): así el texto siempre cae debajo del logo del
              fondo sea cual sea el ancho real de la tarjeta -- las % de padding-top se
              calculan sobre el ancho del contenedor, igual que el alto de la imagen de
              fondo (bg-size: 100% auto), así los dos escalan siempre juntos. */}
          <div ref={headerRef} className="flex flex-col items-center px-7 pb-3 pt-[35%]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-emerald-400">
              Partidos
            </p>
            <p className="mt-1 text-[11px] font-medium tracking-wide text-emerald-100/70">{dayLabel(date)}</p>
            <div className="mt-2 h-px w-14 bg-emerald-500/50" />
          </div>

          <div ref={contentRef} className="flex flex-col gap-2 px-7 pb-4 [text-shadow:0_1px_4px_rgba(0,0,0,0.65)]">
            {byCourt.map(({ court, matches: cm }) => (
              <div key={court.id} className="flex flex-col gap-0.5">
                <div className="flex items-center justify-center gap-2.5">
                  <div className="h-px w-8 bg-white/25" />
                  <p className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-emerald-300">{court.name}</p>
                  <div className="h-px w-8 bg-white/25" />
                </div>
                <div className="flex flex-col divide-y divide-white/10">
                  {cm.map((m) => (
                    <MatchRow
                      key={m.id}
                      match={m}
                      category={categoriesById[m.category_id]?.name}
                      team1={teamsById[m.team1_id ?? ""]?.name ?? "?"}
                      team2={teamsById[m.team2_id ?? ""]?.name ?? "?"}
                      courts={courts}
                      editable={editable}
                      onSaveResult={onSaveResult}
                      onCourtChange={onCourtChange}
                      onScheduleChange={onScheduleChange}
                      onCancelTurn={onCancelTurn}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div ref={footerRef} className="pb-3 text-center">
            <p className="text-[9px] font-medium uppercase tracking-[0.2em] text-emerald-100/30">{tournamentName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
