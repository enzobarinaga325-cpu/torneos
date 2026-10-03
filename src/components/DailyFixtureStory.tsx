import { useState } from "react";
import { ArrowLeftRight, Ban, Download, ImagePlus, Loader2, Pencil } from "lucide-react";
import type { Category, Court, Match, Team } from "@/lib/types";
import { useStoryDownload } from "@/lib/useStoryDownload";
import { useDesignScale } from "@/lib/useDesignScale";
import type { TeamAvailability, TeamUnavailability } from "@/lib/types";
import { localDateStr, toLocalDatetimeInput } from "@/lib/format";
import { matchWinner } from "@/lib/tournament-logic";
import { swapMatchOptions, swapOptions } from "@/lib/swap-opponent";
import type { SwapMatchOption, SwapOption } from "@/lib/swap-opponent";
import { Button, Select } from "./ui";
import ordenDeJuegoBackground from "@/assets/orden-de-juego-background.jpg";

const DIA_LARGO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// Todas las medidas de este cartel están pensadas para un diseño de referencia de 480px de
// ancho -- exactamente 1080/2.25 -- porque la descarga (useStoryDownload) siempre captura a
// 1080px físicos de ancho. El contenido real vive fijo a este ancho (ver `useDesignScale`) y
// se escala visualmente para entrar en pantallas más angostas, así las proporciones del
// diseño (fondo, tipografía, espaciados) salen siempre exactas sin importar el dispositivo.
const DESIGN_WIDTH = 480;
const HORA_COL_WIDTH = 65; // px de referencia
const WINNER_COLOR = "#34D399"; // el único verde permitido en esta grilla: marca quién ganó

type SetsDraft = Pick<Match, "set1_team1" | "set1_team2" | "set2_team1" | "set2_team2" | "set3_team1" | "set3_team2">;

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "Lunes 28 de septiembre" -- sin año, día completo (no abreviado). */
function fullDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const month = dt.toLocaleDateString("es-AR", { month: "long" });
  return `${DIA_LARGO[dt.getDay()]} ${d} de ${month}`;
}

function scoreLine(m: Match): string {
  const sets: [number | null, number | null][] = [
    [m.set1_team1, m.set1_team2], [m.set2_team1, m.set2_team2], [m.set3_team1, m.set3_team2],
  ];
  return sets.filter(([a, b]) => a != null && b != null).map(([a, b]) => `${a}-${b}`).join(" ");
}

/** Un jugador por renglón -- separa "Beta Sosa/ Andrea Garcia" en sus dos nombres. */
function splitPlayers(teamName: string): string[] {
  return teamName.split("/").map((p) => p.trim()).filter(Boolean);
}

// Página estática propia (public/resultado.html) -- no un artifact externo de claude.ai, así
// no hace falta estar logueado ahí ni depender de un link aparte.
const RESULT_BACKGROUND_PAGE_URL = "/resultado.html";

/** Zonas y liga en celeste, cruces (octavos/cuartos/semis) en verde, la final en dorado --
 * así se distingue de un vistazo en qué instancia se jugó. La liga no tiene cruces ni final,
 * así que todos sus partidos van con el mismo color que una zona. */
function resultBackgroundTheme(match: Match): "azul" | "verde" | "dorado" {
  if (match.stage !== "fixture") return "azul";
  return match.round_name === "Final" ? "dorado" : "verde";
}

/** Abre el generador de fondos para resultados (historias de Instagram) con la categoría, las
 * parejas y el resultado ya cargados -- al admin solo le queda subir la foto de los jugadores. */
function resultBackgroundUrl(match: Match, category: string | undefined, team1: string, team2: string, tournamentName: string): string {
  const params = new URLSearchParams({
    cat: category ?? "",
    p1: team1,
    p2: team2,
    s11: match.set1_team1?.toString() ?? "",
    s21: match.set1_team2?.toString() ?? "",
    s12: match.set2_team1?.toString() ?? "",
    s22: match.set2_team2?.toString() ?? "",
    s13: match.set3_team1?.toString() ?? "",
    s23: match.set3_team2?.toString() ?? "",
    foot: tournamentName,
    theme: resultBackgroundTheme(match),
  });
  return `${RESULT_BACKGROUND_PAGE_URL}?${params.toString()}`;
}

/** Rosa para categorías de damas, celeste para caballeros -- gris para cualquier otro caso. */
function categoryColor(name?: string): string {
  if (!name) return "#96A2BC";
  const n = name.toLowerCase();
  if (n.includes("dama")) return "#FF96B9";
  if (n.includes("caballero")) return "#78A8FF";
  return "#96A2BC";
}

/** "Nombre de la pareja (2026-10-09 19:00hs)" -- así se ve en qué horario jugaría la nueva pareja hoy. */
function swapLabel(o: SwapOption): string {
  return `${o.opponentName} (${localDateStr(o.scheduledAt)} ${timeLabel(o.scheduledAt)}hs)`;
}

/** "A/B vs C/D · Categoría (2026-10-09 19:00hs)" -- el partido con el que se cambiaría de lugar. */
function swapMatchLabel(o: SwapMatchOption, teamsById: Record<string, Team>, categoriesById: Record<string, Category>): string {
  const m = o.match;
  const name = (id: string | null) => (id ? teamsById[id]?.name : null) ?? "?";
  const cat = categoriesById[m.category_id]?.name;
  return `${name(m.team1_id)} vs ${name(m.team2_id)}${cat ? ` · ${cat}` : ""} (${localDateStr(o.scheduledAt)} ${timeLabel(o.scheduledAt)}hs)`;
}

function MatchCell({
  match, category, team1, team2, courts, editable, onSaveResult, onSlotChange, onCancelTurn,
  allMatches, teamsById, onSwapOpponent, teamAvailability, teamUnavailability, matchDurationMinutes,
  tournamentName, categoriesById,
}: {
  match: Match;
  category?: string;
  team1: string;
  team2: string;
  courts: Court[];
  editable?: boolean;
  onSaveResult?: (m: Match, sets: SetsDraft) => void;
  onSlotChange?: (m: Match, patch: { courtId: string | null; iso: string | null }) => void;
  onCancelTurn?: (m: Match) => void;
  allMatches?: Match[];
  teamsById?: Record<string, Team>;
  onSwapOpponent?: (m: Match, otherMatch: Match) => void;
  teamAvailability?: Pick<TeamAvailability, "team_id" | "dia_semana" | "hora_inicio" | "hora_fin">[];
  teamUnavailability?: Pick<TeamUnavailability, "team_id" | "start_date" | "end_date">[];
  matchDurationMinutes?: number;
  tournamentName?: string;
  categoriesById?: Record<string, Category>;
}) {
  const [editing, setEditing] = useState(false);
  const [swappingWhole, setSwappingWhole] = useState(false);
  const [sets, setSets] = useState<SetsDraft>({
    set1_team1: match.set1_team1, set1_team2: match.set1_team2,
    set2_team1: match.set2_team1, set2_team2: match.set2_team2,
    set3_team1: match.set3_team1, set3_team2: match.set3_team2,
  });
  // Cancha y horario NO se guardan solos al tocarlos -- si cambiar la cancha guardara al
  // toque, se intercambiaba de inmediato con el partido que ya estuviera en esa cancha a la
  // hora VIEJA (todavía sin actualizar), antes de llegar a elegir la hora nueva. Se juntan
  // los dos cambios acá y se mandan juntos recién al tocar "Confirmar cambio".
  const [draftCourtId, setDraftCourtId] = useState(match.court_id ?? "");
  const [draftDatetime, setDraftDatetime] = useState(match.scheduled_at ? toLocalDatetimeInput(match.scheduled_at) : "");
  const winner = matchWinner(match);
  const score = scoreLine(match);
  const catColor = categoryColor(category);

  // Rivales con los que se puede intercambiar: dejando fijo UN equipo, el otro lado de este
  // partido pasa a jugar en el horario de ese otro partido (y el rival de ese otro partido
  // termina acá) -- así el admin cambia el rival eligiendo un nombre, sin ir a buscar la
  // fecha a mano.
  const canSwap = Boolean(editable && allMatches && teamsById && onSwapOpponent);
  const duration = matchDurationMinutes ?? 60;
  const avail = teamAvailability ?? [];
  const unavail = teamUnavailability ?? [];
  // team1 queda fijo -- estas son las parejas que podrían pasar a jugar en el lugar de team2.
  const optionsToReplaceTeam2 = canSwap ? swapOptions(match, match.team1_id, allMatches!, teamsById!, duration, avail, unavail) : [];
  // team2 queda fijo -- estas son las parejas que podrían pasar a jugar en el lugar de team1.
  const optionsToReplaceTeam1 = canSwap ? swapOptions(match, match.team2_id, allMatches!, teamsById!, duration, avail, unavail) : [];

  // Opciones para cambiar este partido ENTERO de lugar con otro (solo se calcula con el panel abierto).
  const wholeMatchOptions = canSwap && swappingWhole ? swapMatchOptions(match, allMatches!, duration, avail, unavail) : [];

  function swapWhole(matchId: string) {
    const other = allMatches?.find((m) => m.id === matchId);
    if (other) onSwapOpponent?.(match, other);
    setSwappingWhole(false);
  }

  function swap(matchId: string) {
    const other = allMatches?.find((m) => m.id === matchId);
    if (other) onSwapOpponent?.(match, other);
  }

  function openEditing() {
    setDraftCourtId(match.court_id ?? "");
    setDraftDatetime(match.scheduled_at ? toLocalDatetimeInput(match.scheduled_at) : "");
    setEditing(true);
  }

  function setField(field: keyof SetsDraft, raw: string) {
    setSets((s) => ({ ...s, [field]: raw === "" ? null : Number(raw) }));
  }

  function save() {
    onSaveResult?.(match, sets);
    setEditing(false);
  }

  function confirmSlotChange() {
    onSlotChange?.(match, { courtId: draftCourtId || null, iso: draftDatetime ? new Date(draftDatetime).toISOString() : null });
    setEditing(false);
  }

  return (
    <div className="relative min-h-[128px] py-3 pl-[13px] pr-2">
      {category && (
        <p className="flex items-center gap-1.5 text-[8.5px] font-bold uppercase tracking-[1.1px]" style={{ color: catColor }}>
          <span className="inline-block h-[4.5px] w-[4.5px] shrink-0 rounded-full" style={{ backgroundColor: catColor }} />
          {category}
        </p>
      )}
      <div
        className={`mt-1 leading-[17px] ${winner === 1 ? "font-bold" : "font-semibold text-white"}`}
        style={winner === 1 ? { color: WINNER_COLOR } : undefined}
      >
        {splitPlayers(team1).map((p, i) => <p key={i} className="text-[14px]">{p}</p>)}
      </div>
      <p className="text-[8px] font-medium" style={{ color: "#96A2BC" }}>vs</p>
      <div
        className={`leading-[17px] ${winner === 2 ? "font-bold" : "font-semibold text-white"}`}
        style={winner === 2 ? { color: WINNER_COLOR } : undefined}
      >
        {splitPlayers(team2).map((p, i) => <p key={i} className="text-[14px]">{p}</p>)}
      </div>
      {score && <p className="mt-0.5 text-[9px] font-medium" style={{ color: "#96A2BC" }}>{score}</p>}
      {editable && (
        <div data-html2canvas-ignore="true" className="absolute right-1 top-1 flex items-center gap-0.5">
          {!winner && onCancelTurn && (
            // Botón directo, sin tener que abrir antes el lápiz -- el "Cancelar turno" que ya
            // estaba adentro del panel de edición quedaba escondido entre los inputs de sets,
            // costaba encontrarlo. Este actúa igual (mismo `onCancelTurn`, con su confirm()
            // desde TournamentManage), solo que es visible siempre.
            <button
              onClick={() => onCancelTurn(match)}
              className="shrink-0 rounded-md p-1 text-white/40 hover:bg-red-500/20 hover:text-red-300"
              aria-label={`Cancelar turno ${team1} vs ${team2}`}
            >
              <Ban className="h-3.5 w-3.5" />
            </button>
          )}
          {winner && (
            // Una vez cargado el resultado, abre el generador de fondos para historias de
            // Instagram con la categoría, las parejas y el resultado ya cargados -- al admin
            // solo le queda subir la foto de los jugadores.
            <button
              onClick={() => window.open(resultBackgroundUrl(match, category, team1, team2, tournamentName ?? ""), "_blank", "noopener")}
              className="shrink-0 rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white"
              aria-label={`Generar imagen de resultado ${team1} vs ${team2}`}
            >
              <ImagePlus className="h-3.5 w-3.5" />
            </button>
          )}
          {canSwap && !winner && (
            <button
              onClick={() => setSwappingWhole((v) => !v)}
              className="shrink-0 rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white"
              aria-label={`Cambiar partido completo ${team1} vs ${team2}`}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => (editing ? setEditing(false) : openEditing())}
            className="shrink-0 rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white"
            aria-label={`Cargar resultado ${team1} vs ${team2}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {canSwap && !winner && swappingWhole && (
        // Cambia ESTE partido completo (las dos parejas) de lugar con otro: solo aparecen los que
        // le sirven a las cuatro parejas por horario y fechas, y sin que ninguna juegue 2 el mismo día.
        <div data-html2canvas-ignore="true" className="mt-1.5 flex flex-col gap-1.5 rounded-lg bg-zinc-50 p-2">
          <span className="text-[10px] text-zinc-500">Cambiar este partido de lugar con:</span>
          {wholeMatchOptions.length > 0 ? (
            <Select value="" onChange={(e) => e.target.value && swapWhole(e.target.value)} className="min-w-0 py-1 text-xs">
              <option value="">elegir partido</option>
              {wholeMatchOptions.map((o) => <option key={o.matchId} value={o.matchId}>{swapMatchLabel(o, teamsById!, categoriesById ?? {})}</option>)}
            </Select>
          ) : (
            <p className="text-[10px] text-zinc-500">No hay ningún partido con el que se pueda cambiar sin romper horarios ni repetir día.</p>
          )}
        </div>
      )}

      {editable && editing && (
        <div data-html2canvas-ignore="true" className="mt-1.5 flex flex-col gap-2 rounded-lg bg-zinc-50 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Select
              value={draftCourtId}
              onChange={(e) => setDraftCourtId(e.target.value)}
              className="w-24 shrink-0 py-1 text-xs"
            >
              <option value="">Cancha</option>
              {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <input
              type="datetime-local"
              value={draftDatetime}
              onChange={(e) => setDraftDatetime(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-emerald-500"
            />
            <Button variant="secondary" className="shrink-0 px-2 py-1 text-xs" onClick={confirmSlotChange}>
              Confirmar cambio
            </Button>
          </div>

          {canSwap && !winner && (optionsToReplaceTeam1.length > 0 || optionsToReplaceTeam2.length > 0) && (
            // Si una pareja no puede jugar este turno, en vez de mover el partido a mano se
            // elige quién la reemplaza acá -- el partido que esa pareja nueva tenía agendado
            // se intercambia de lugar con este (nadie se queda sin horario, nadie se pierde
            // un turno libre).
            <div className="flex flex-col gap-1.5 border-t border-zinc-200 pt-2">
              {optionsToReplaceTeam1.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="shrink-0 text-[10px] text-zinc-500">{team1} no puede, que juegue:</span>
                  <Select
                    value=""
                    onChange={(e) => e.target.value && swap(e.target.value)}
                    className="min-w-0 flex-1 py-1 text-xs"
                  >
                    <option value="">elegir pareja</option>
                    {optionsToReplaceTeam1.map((o) => <option key={o.matchId} value={o.matchId}>{swapLabel(o)}</option>)}
                  </Select>
                </div>
              )}
              {optionsToReplaceTeam2.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="shrink-0 text-[10px] text-zinc-500">{team2} no puede, que juegue:</span>
                  <Select
                    value=""
                    onChange={(e) => e.target.value && swap(e.target.value)}
                    className="min-w-0 flex-1 py-1 text-xs"
                  >
                    <option value="">elegir pareja</option>
                    {optionsToReplaceTeam2.map((o) => <option key={o.matchId} value={o.matchId}>{swapLabel(o)}</option>)}
                  </Select>
                </div>
              )}
            </div>
          )}

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
 * "Orden de juego" de un día (formato Historia de Instagram, 1080x1920) -- una fila por
 * horario, una columna por cancha, estilo planilla de circuito profesional. Sirve tanto
 * para ver/cargar resultados (`editable`) como para descargar y compartir. Los controles de
 * carga de resultado llevan `data-html2canvas-ignore` para no aparecer nunca en la imagen
 * exportada, aunque estén dentro del mismo cartel.
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
  onSlotChange,
  onCancelTurn,
  onSwapOpponent,
  teamAvailability,
  teamUnavailability,
  matchDurationMinutes,
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
  onSlotChange?: (m: Match, patch: { courtId: string | null; iso: string | null }) => void;
  onCancelTurn?: (m: Match) => void;
  onSwapOpponent?: (m: Match, otherMatch: Match) => void;
  teamAvailability?: Pick<TeamAvailability, "team_id" | "dia_semana" | "hora_inicio" | "hora_fin">[];
  teamUnavailability?: Pick<TeamUnavailability, "team_id" | "start_date" | "end_date">[];
  matchDurationMinutes?: number;
  showDownload?: boolean;
}) {
  const { headerRef, contentRef, footerRef, download, downloading } = useStoryDownload(fileName, {
    width: 1080,
    height: 1920,
    fallbackColor: "#0a1330",
    backgroundImageUrl: ordenDeJuegoBackground,
  });
  const { outerRef, innerRef, scale, height } = useDesignScale(DESIGN_WIDTH);

  const dayMatches = matches.filter((m) => m.scheduled_at && localDateStr(m.scheduled_at) === date);
  if (dayMatches.length === 0) {
    return <p className="text-sm text-zinc-500">No hay partidos agendados este día todavía.</p>;
  }

  // Una fila por horario (la unión de todos los horarios que juega cualquier cancha ese
  // día), una columna por cancha -- así se arma la grilla de "orden de juego" en vez de
  // listar los partidos de una cancha y después los de la otra.
  const times = [...new Set(dayMatches.map((m) => m.scheduled_at as string))].sort();
  const byCourtAndTime = new Map(dayMatches.map((m) => [`${m.court_id}|${m.scheduled_at}`, m]));

  const gridTemplateColumns = `${HORA_COL_WIDTH}px repeat(${courts.length}, 1fr)`;

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

      <div ref={outerRef} className="mx-auto w-full max-w-[480px]" style={{ height }}>
        <div
          ref={innerRef}
          style={{ width: DESIGN_WIDTH, transform: `scale(${scale})`, transformOrigin: "top left", fontFamily: "'Manrope', sans-serif" }}
        >
        <div
          className="overflow-hidden rounded-2xl border border-white/10 bg-[#0a1330] bg-top bg-no-repeat shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
          style={{ backgroundImage: `url(${ordenDeJuegoBackground})`, backgroundSize: "100% auto" }}
        >
          <div ref={headerRef} className="flex flex-col items-center px-7 pb-3 pt-[158px]">
            <div className="flex items-center gap-[21px]">
              <span className="h-px w-[21px] bg-white/35" />
              <p className="text-[9px] font-bold uppercase text-white/72" style={{ letterSpacing: "2.7px" }}>
                Orden de juego
              </p>
              <span className="h-px w-[21px] bg-white/35" />
            </div>
            <p className="mt-[18px] text-[23px] font-semibold text-white">{fullDayLabel(date)}</p>
          </div>

          <div ref={contentRef} className="px-5 pb-5 pt-9">
            <div
              className="overflow-hidden rounded-xl border border-white/[0.16]"
              style={{
                background: "rgba(10,18,40,0.6)",
                backdropFilter: "blur(12px)",
                boxShadow: "0 13px 36px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.28)",
              }}
            >
              <div className="grid items-center border-b border-white/[0.18]" style={{ gridTemplateColumns, height: 31 }}>
                <p className="text-center text-[7.5px] font-bold uppercase text-white/50" style={{ letterSpacing: "2.2px" }}>
                  Hora
                </p>
                {courts.map((c) => (
                  <div key={c.id} className="pl-[13px]">
                    <p className="text-[8.5px] font-bold uppercase text-white" style={{ letterSpacing: "2.2px" }}>
                      {c.name}
                    </p>
                    <div className="mt-1 h-[1px] w-[15px]" style={{ backgroundColor: "#6EA0FF" }} />
                  </div>
                ))}
              </div>

              {times.map((iso, i) => (
                <div key={iso}>
                  <div className="relative grid" style={{ gridTemplateColumns }}>
                    <div className="flex items-center justify-center">
                      <span className="text-[19px] font-bold" style={{ color: "#8AB6FF" }}>{timeLabel(iso)}</span>
                    </div>
                    {courts.map((court) => {
                      const match = byCourtAndTime.get(`${court.id}|${iso}`);
                      return (
                        <div key={court.id} className="relative flex items-center">
                          {/* línea vertical entre HORA y cada cancha (y entre canchas), con margen arriba/abajo */}
                          <span className="absolute left-0 top-[13px] bottom-[13px] w-px bg-white/[0.12]" />
                          {match ? (
                            <MatchCell
                              match={match}
                              category={categoriesById[match.category_id]?.name}
                              team1={teamsById[match.team1_id ?? ""]?.name ?? "?"}
                              team2={teamsById[match.team2_id ?? ""]?.name ?? "?"}
                              courts={courts}
                              editable={editable}
                              onSaveResult={onSaveResult}
                              onSlotChange={onSlotChange}
                              onCancelTurn={onCancelTurn}
                              allMatches={matches}
                              teamsById={teamsById}
                              onSwapOpponent={onSwapOpponent}
                              teamAvailability={teamAvailability}
                              teamUnavailability={teamUnavailability}
                              matchDurationMinutes={matchDurationMinutes}
                              tournamentName={tournamentName}
                              categoriesById={categoriesById}
                            />
                          ) : (
                            <p className="pl-[13px] text-[10px] font-medium" style={{ color: "#96A2BC" }}>Libre</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {i < times.length - 1 && <div className="mx-[12px] h-px bg-white/[0.13]" />}
                </div>
              ))}
            </div>
          </div>

          <div ref={footerRef} className="pb-5 text-center">
            <div className="flex items-center justify-center gap-[13px]">
              <span className="h-px w-[29px] bg-white/27" />
              <p className="text-[7.5px] font-bold uppercase text-white/60" style={{ letterSpacing: "3.1px" }}>
                {tournamentName}
              </p>
              <span className="h-px w-[29px] bg-white/27" />
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
