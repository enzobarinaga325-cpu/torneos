import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, CloudRain, Printer, RefreshCw, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Category, Court, LeagueSlot, Match, Modalidad, ScheduleBlackout, Team, TeamAvailability, TeamUnavailability, Tournament, TournamentDay } from "@/lib/types";
import { matchWinner } from "@/lib/tournament-logic";
import { autoScheduleTournament } from "@/lib/autoschedule";
import { autoScheduleLeague } from "@/lib/league-autoschedule";
import { fillScheduleGaps } from "@/lib/fill-gaps";
import { checkFixtureHealth, type FixtureHealthReport } from "@/lib/fixture-health";
import { cancelDay, cancelTurn, removeBlackout } from "@/lib/blackouts";
import { DIAS_SEMANA } from "@/lib/league-logic";
import { validateLeagueSlotTime, validateTournamentDaySlotTime } from "@/lib/slot-validation";
import { localDateStr, todayStr, toLocalDatetimeInput } from "@/lib/format";
import { DailyFixtureStory } from "@/components/DailyFixtureStory";
import { ParticipantsList } from "@/components/ParticipantsList";
import { Badge, Button, Card, Input, Label, Select, Spinner } from "@/components/ui";

/** Lunes a domingo, para mostrarlos en el orden natural de la semana (día 0 = domingo). */
const LEAGUE_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const statusLabels: Record<string, { label: string; color: "zinc" | "green" | "amber" }> = {
  armando: { label: "Armando", color: "amber" },
  en_curso: { label: "En curso", color: "green" },
  finalizado: { label: "Finalizado", color: "zinc" },
};

/** Todas las fechas "YYYY-MM-DD" entre start y end, ambas incluidas. */
function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);
  while (cur <= last) {
    dates.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/**
 * Una fila de "Partidos sin agendar": cancha y horario se juntan en estado local y recién
 * se mandan juntos al tocar "Confirmar", en vez de guardar cada campo solo apenas se toca
 * (eso no daba tiempo a cargar los dos datos antes de que el primero ya disparara un
 * guardado parcial).
 */
function UnscheduledMatchRow({
  match, courts, categoryName, team1Name, team2Name, onConfirm,
}: {
  match: Match;
  courts: Court[];
  categoryName: string;
  team1Name: string;
  team2Name: string;
  onConfirm: (match: Match, patch: { court_id: string | null; scheduled_at: string | null }) => void;
}) {
  const [courtId, setCourtId] = useState(match.court_id ?? "");
  const [datetime, setDatetime] = useState(match.scheduled_at ? toLocalDatetimeInput(match.scheduled_at) : "");

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
      <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-600">{categoryName}</span>
      <span className="min-w-[180px] flex-1">
        {team1Name}
        <span className="mx-1.5 text-xs text-zinc-400">vs</span>
        {team2Name}
      </span>
      <Select value={courtId} onChange={(e) => setCourtId(e.target.value)} className="w-28 shrink-0">
        <option value="">Cancha</option>
        {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <input
        type="datetime-local"
        value={datetime}
        onChange={(e) => setDatetime(e.target.value)}
        className="w-[172px] shrink-0 rounded-lg border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-emerald-500"
      />
      <Button
        variant="secondary"
        className="shrink-0 px-2 py-1.5 text-xs"
        onClick={() => onConfirm(match, { court_id: courtId || null, scheduled_at: datetime ? new Date(datetime).toISOString() : null })}
      >
        Confirmar
      </Button>
    </div>
  );
}

export function TournamentManage() {
  const { id } = useParams<{ id: string }>();
  const [tournament, setTournament] = useState<Tournament | null | undefined>(undefined);
  const [courts, setCourts] = useState<Court[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [days, setDays] = useState<TournamentDay[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const [unscheduledMatches, setUnscheduledMatches] = useState<Match[]>([]);
  const [leagueSlots, setLeagueSlots] = useState<LeagueSlot[]>([]);
  const [blackouts, setBlackouts] = useState<ScheduleBlackout[]>([]);
  const [teamAvailability, setTeamAvailability] = useState<Pick<TeamAvailability, "team_id" | "dia_semana" | "hora_inicio" | "hora_fin">[]>([]);
  const [teamUnavailability, setTeamUnavailability] = useState<Pick<TeamUnavailability, "team_id" | "start_date" | "end_date">[]>([]);
  const [selectedGridDay, setSelectedGridDay] = useState("");
  const [showBlackouts, setShowBlackouts] = useState(false);
  const [courtName, setCourtName] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [matchMinutes, setMatchMinutes] = useState("60");
  const [scheduling, setScheduling] = useState(false);
  const [pendingModalidad, setPendingModalidad] = useState<Modalidad | null>(null);
  const [horariosOpen, setHorariosOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingFixture, setCheckingFixture] = useState(false);
  const [healthReport, setHealthReport] = useState<FixtureHealthReport | null>(null);
  // Para acciones que reordenan o cancelan un día entero: un click de más (o de menos) tiene
  // mucho radio de daño, así que en vez de un simple confirm() del navegador (un solo click
  // sin pensar) piden escribir una palabra a propósito antes de ejecutarse.
  const [pendingDanger, setPendingDanger] = useState<{ title: string; description: string; confirmWord: string; run: () => void } | null>(null);
  const [dangerInput, setDangerInput] = useState("");

  async function load() {
    const [{ data: t }, { data: c }, { data: cats }, { data: d }, { data: ls }, { data: bo }] = await Promise.all([
      supabase.from("tournaments").select("*").eq("id", id!).maybeSingle(),
      supabase.from("courts").select("*").eq("tournament_id", id!).order("name"),
      supabase.from("categories").select("*").eq("tournament_id", id!).order("created_at"),
      supabase.from("tournament_days").select("*").eq("tournament_id", id!).order("date"),
      supabase.from("horarios_liga").select("*").eq("tournament_id", id!),
      supabase.from("schedule_blackouts").select("*").eq("tournament_id", id!).order("date"),
    ]);
    setTournament(t ?? null);
    setCourts(c ?? []);
    setCategories(cats ?? []);
    setDays(d ?? []);
    setLeagueSlots(ls ?? []);
    setBlackouts(bo ?? []);
    if (t) setMatchMinutes(String(t.default_match_minutes ?? 60));

    if (cats && cats.length > 0) {
      const categoryIds = cats.map((c) => c.id);
      const [{ data: allT }, { data: allM }, { data: unschedM }, { data: avail }, { data: unavail }] = await Promise.all([
        supabase.from("teams").select("*").in("category_id", categoryIds),
        supabase.from("matches").select("*").in("category_id", categoryIds).not("scheduled_at", "is", null),
        supabase
          .from("matches")
          .select("*")
          .in("category_id", categoryIds)
          .eq("stage", "liga")
          .is("winner_id", null)
          .not("team1_id", "is", null)
          .not("team2_id", "is", null)
          .or("scheduled_at.is.null,court_id.is.null"),
        supabase.from("team_availability").select("team_id, dia_semana, hora_inicio, hora_fin, teams!inner(category_id)").in("teams.category_id", categoryIds),
        supabase.from("team_unavailability").select("team_id, start_date, end_date, teams!inner(category_id)").in("teams.category_id", categoryIds),
      ]);
      setAllTeams(allT ?? []);
      setAllMatches((allM as Match[]) ?? []);
      setUnscheduledMatches((unschedM as Match[]) ?? []);
      setTeamAvailability(avail ?? []);
      setTeamUnavailability(unavail ?? []);
      const dates = [...new Set((allM ?? []).map((m) => localDateStr(m.scheduled_at as string)))].sort();
      const today = todayStr();
      setSelectedGridDay((prev) => prev || dates.find((d) => d >= today) || dates[0] || "");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** Ejecuta una escritura a Supabase y, si falla, la muestra en el cartel de error en vez
   *  de dejar que pase desapercibida — devuelve false para que quien llama corte ahí (no
   *  siga como si el guardado hubiese entrado). */
  async function run(promise: PromiseLike<{ error: { message: string } | null }>): Promise<boolean> {
    const { error: err } = await promise;
    if (err) { setError(err.message); return false; }
    return true;
  }

  async function saveMatchMinutes() {
    await run(supabase
      .from("tournaments")
      .update({ default_match_minutes: Math.max(15, Number(matchMinutes) || 60) })
      .eq("id", id!));
  }

  /** Crea una fila por cada día entre start_date y end_date que todavía no la tenga. */
  async function syncDays() {
    if (!tournament?.start_date) { setError("Primero cargale fecha de inicio (y de fin) al torneo."); return; }
    const dates = enumerateDates(tournament.start_date, tournament.end_date ?? tournament.start_date);
    const existing = new Set(days.map((d) => d.date));
    const missing = dates.filter((date) => !existing.has(date));
    if (missing.length > 0) {
      if (!(await run(supabase.from("tournament_days").insert(missing.map((date) => ({ tournament_id: id, date })))))) return;
    }
    load();
  }

  async function updateDay(day: TournamentDay, patch: Partial<Pick<TournamentDay, "start_time" | "end_time">>) {
    if (!(await run(supabase.from("tournament_days").update(patch).eq("id", day.id)))) return;
    setDays((ds) => ds.map((d) => (d.id === day.id ? { ...d, ...patch } : d)));
  }

  async function autoSchedule() {
    if (courts.length === 0) { setError("Cargá al menos una cancha primero."); return; }
    if (days.length === 0) { setError('Cargá los días del torneo primero ("Sincronizar días").'); return; }
    if (categories.length === 0) return;
    setScheduling(true);
    setError(null);
    await saveMatchMinutes();

    const { scheduled, unscheduled, error: schedError } = await autoScheduleTournament(id!);
    setScheduling(false);
    if (schedError) {
      setError(schedError);
    } else if (scheduled === 0 && unscheduled === 0) {
      setError("No hay partidos pendientes de horario (o ya están todos agendados).");
    } else if (unscheduled > 0) {
      setError(`Se agendaron ${scheduled} partidos. No entraron ${unscheduled} más: agregá más días o extendé los horarios.`);
    }
    load();
  }

  /**
   * Borra la cancha+horario de todos los partidos del torneo (los resultados ya cargados
   * quedan intactos). Sirve para arrancar de cero antes de correr "Autocompletar horarios"
   * con el algoritmo actual, si algún partido quedó mal agendado de una corrida vieja.
   */
  async function clearSchedule() {
    if (categories.length === 0) return;
    if (!confirm("¿Vaciar el horario y la cancha de TODOS los partidos de este torneo? Los resultados ya cargados no se tocan.")) return;
    setScheduling(true);
    setError(null);
    if (!(await run(supabase
      .from("matches")
      .update({ court_id: null, scheduled_at: null, auto_scheduled: true })
      .in("category_id", categories.map((c) => c.id))))) { setScheduling(false); return; }
    setScheduling(false);
    load();
  }

  /**
   * Cambia el estado del torneo a mano. "Finalizado" no chequea que estén todos los
   * partidos jugados — a veces hay que cerrar el torneo igual (walkover, clima, etc.) aunque
   * queden partidos sin jugar.
   */
  async function setTournamentStatus(status: "armando" | "en_curso" | "finalizado") {
    if (status === "finalizado" && !confirm("¿Dar el torneo por finalizado? Podés reabrirlo después si hace falta.")) return;
    if (!(await run(supabase.from("tournaments").update({ status }).eq("id", id!)))) return;
    setTournament((t) => (t ? { ...t, status } : t));
  }

  // ============ MODALIDAD ============
  function requestModalidadChange(next: Modalidad) {
    if (!tournament || next === tournament.modalidad) return;
    setPendingModalidad(next);
  }

  /**
   * Cambia la modalidad del torneo. Borra los partidos SIN resultado cargado de todas las
   * categorías (de cualquier stage: zona, fixture o liga) para que se puedan regenerar con
   * el botón que corresponda al nuevo formato — los partidos que ya tienen un resultado
   * cargado nunca se tocan, sin importar la modalidad.
   */
  async function confirmModalidadChange() {
    if (!pendingModalidad || !tournament) return;
    setScheduling(true);
    setError(null);
    const categoryIds = categories.map((c) => c.id);
    if (categoryIds.length > 0) {
      const { data: existing } = await supabase.from("matches").select("*").in("category_id", categoryIds);
      const unplayedIds = ((existing as Match[]) ?? []).filter((m) => matchWinner(m) == null).map((m) => m.id);
      if (unplayedIds.length > 0 && !(await run(supabase.from("matches").delete().in("id", unplayedIds)))) { setScheduling(false); return; }
    }
    if (!(await run(supabase.from("tournaments").update({ modalidad: pendingModalidad }).eq("id", id!)))) { setScheduling(false); return; }
    setPendingModalidad(null);
    setScheduling(false);
    load();
  }

  // ============ HORARIOS DE LIGA (uno por cancha por día) ============
  function leagueSlotFor(diaSemana: number, courtId: string): LeagueSlot | undefined {
    return leagueSlots.find((s) => s.dia_semana === diaSemana && s.court_id === courtId);
  }

  /** Tildar un día crea de una un horario para CADA cancha (19 a 23hs por defecto, editable
   *  después cancha por cancha); destildarlo borra los horarios de todas las canchas ese día
   *  — como el checkbox queda pegado arriba del campo de hora del día siguiente, es fácil
   *  tocarlo sin querer al ir a editar otro día, así que confirma antes de borrar. */
  async function toggleLeagueDay(diaSemana: number, enabled: boolean) {
    if (enabled) {
      if (courts.length === 0) { setError("Cargá al menos una cancha primero."); return; }
      if (!(await run(supabase.from("horarios_liga").insert(
        courts.map((c) => ({ tournament_id: id, court_id: c.id, dia_semana: diaSemana, hora_inicio: "19:00", hora_fin: "23:00" })),
      )))) return;
    } else {
      const existingIds = leagueSlots.filter((s) => s.dia_semana === diaSemana).map((s) => s.id);
      if (existingIds.length === 0) return;
      if (!confirm(`¿Borrar el horario de ${DIAS_SEMANA[diaSemana]} en todas las canchas? Los partidos que ya tenía agendados ahí se van a tener que reacomodar.`)) return;
      if (!(await run(supabase.from("horarios_liga").delete().in("id", existingIds)))) return;
    }
    load();
  }

  async function toggleLeagueCourtDay(diaSemana: number, courtId: string, enabled: boolean) {
    if (enabled) {
      if (!(await run(supabase.from("horarios_liga").insert({ tournament_id: id, court_id: courtId, dia_semana: diaSemana, hora_inicio: "19:00", hora_fin: "23:00" })))) return;
    } else {
      const existing = leagueSlotFor(diaSemana, courtId);
      if (!existing) return;
      if (!confirm(`¿Borrar el horario de ${DIAS_SEMANA[diaSemana]} en esta cancha? Los partidos que ya tenía agendados ahí se van a tener que reacomodar.`)) return;
      if (!(await run(supabase.from("horarios_liga").delete().eq("id", existing.id)))) return;
    }
    load();
  }

  async function updateLeagueSlot(slot: LeagueSlot, patch: Partial<Pick<LeagueSlot, "hora_inicio" | "hora_fin">>) {
    if (!(await run(supabase.from("horarios_liga").update(patch).eq("id", slot.id)))) return;
    setLeagueSlots((s) => s.map((x) => (x.id === slot.id ? { ...x, ...patch } : x)));
  }

  function autoScheduleLeagueClick() {
    if (courts.length === 0) { setError("Cargá al menos una cancha primero."); return; }
    if (leagueSlots.length === 0) { setError("Cargá al menos un horario semanal de la liga primero."); return; }
    if (!tournament?.start_date) { setError("Cargale una fecha de inicio al torneo primero (desde la lista de Torneos)."); return; }
    if (categories.length === 0) return;
    setDangerInput("");
    setPendingDanger({
      title: "Autocompletar horarios",
      description:
        "Esto vuelve a repartir TODOS los partidos de liga que todavía no se jugaron y que nadie movió a mano (los que sí movió el admin no se tocan). Puede reubicar partidos que ya tenían un horario asignado.",
      confirmWord: "AGENDAR",
      run: runAutoScheduleLeague,
    });
  }

  async function runAutoScheduleLeague() {
    setPendingDanger(null);
    setScheduling(true);
    setError(null);
    await saveMatchMinutes();

    const { scheduled, unscheduled, error: schedError } = await autoScheduleLeague(id!);
    setScheduling(false);
    if (schedError) {
      setError(schedError);
    } else if (scheduled === 0 && unscheduled === 0) {
      setError("No hay partidos de liga pendientes de horario (o ya están todos agendados).");
    } else if (unscheduled > 0) {
      setError(`Se agendaron ${scheduled} partidos. No entraron ${unscheduled} más: agregá más horarios semanales o canchas.`);
    }
    load();
  }

  /** A diferencia de "Autocompletar horarios" (que resetea y reparte TODO de nuevo), esto
   *  solo rellena los turnos habilitados que quedaron vacíos — trayendo, para cada hueco, el
   *  último partido del fixture que pueda jugarse ahí — sin reordenar el resto. */
  async function fillGapsClick() {
    setScheduling(true);
    setError(null);
    const { filled, remainingGaps } = await fillScheduleGaps(id!);
    setScheduling(false);
    if (filled === 0 && remainingGaps === 0) {
      setError("No hay huecos para rellenar.");
    } else if (remainingGaps > 0) {
      setError(`Se rellenaron ${filled} huecos. Quedaron ${remainingGaps} sin poder llenar (ningún partido pendiente encaja ahí).`);
    }
    load();
  }

  /** Revisión de solo lectura: nunca mueve ni cambia nada, solo informa si encuentra algo
   *  raro (partidos sin agendar, en un horario ya no configurado, turnos duplicados, una
   *  pareja jugando dos veces el mismo día, o en dos canchas a la misma hora). */
  async function checkFixtureClick() {
    setCheckingFixture(true);
    setHealthReport(null);
    const report = await checkFixtureHealth(id!);
    setCheckingFixture(false);
    setHealthReport(report);
  }

  /** Borra la cancha+horario de todos los partidos de liga (los resultados no se tocan). */
  async function clearLeagueSchedule() {
    if (categories.length === 0) return;
    if (!confirm("¿Vaciar el horario y la cancha de TODOS los partidos de liga de este torneo? Los resultados ya cargados no se tocan.")) return;
    setScheduling(true);
    setError(null);
    if (!(await run(supabase
      .from("matches")
      .update({ court_id: null, scheduled_at: null, auto_scheduled: true })
      .in("category_id", categories.map((c) => c.id))
      .eq("stage", "liga")))) { setScheduling(false); return; }
    setScheduling(false);
    load();
  }

  async function addCourt(e: React.FormEvent) {
    e.preventDefault();
    if (!courtName.trim()) return;
    setError(null);
    const { error } = await supabase.from("courts").insert({ tournament_id: id, name: courtName.trim() });
    if (error) { setError(error.message); return; }
    setCourtName("");
    load();
  }

  async function deleteCourt(courtId: string) {
    if (!confirm("¿Borrar esta cancha?")) return;
    if (!(await run(supabase.from("courts").delete().eq("id", courtId)))) return;
    load();
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryName.trim()) return;
    setError(null);
    const { error } = await supabase.from("categories").insert({ tournament_id: id, name: categoryName.trim() });
    if (error) { setError(error.message); return; }
    setCategoryName("");
    load();
  }

  async function deleteCategory(categoryId: string) {
    if (!confirm("¿Borrar esta categoría? Se borran también sus equipos, zonas y partidos.")) return;
    if (!(await run(supabase.from("categories").delete().eq("id", categoryId)))) return;
    load();
  }

  /** Carga el resultado de un partido desde la grilla del día (cualquier categoría). Igual
   *  que el guardado de resultado de la pestaña de la categoría: si es de fixture y define
   *  la próxima ronda, la completa y reagenda sola. */
  async function saveResult(
    match: Match,
    sets: Pick<Match, "set1_team1" | "set1_team2" | "set2_team1" | "set2_team2" | "set3_team1" | "set3_team2">,
  ) {
    const winner = matchWinner({ ...match, ...sets });
    if (!winner) { setError("Cargá al menos 2 sets, y que no queden empatados, para definir un ganador."); return; }
    const winner_id = winner === 1 ? match.team1_id : match.team2_id;
    setError(null);
    if (!(await run(supabase.from("matches").update({ ...sets, winner_id }).eq("id", match.id)))) return;
    if (match.stage === "fixture" && match.next_match_id && winner_id) {
      if (!(await run(supabase
        .from("matches")
        .update(match.next_match_slot === 1 ? { team1_id: winner_id } : { team2_id: winner_id })
        .eq("id", match.next_match_id)))) return;
      await autoScheduleTournament(id!);
    }
    load();
  }

  /**
   * Cambia la cancha y/o el horario de un partido desde la grilla del día (cualquier
   * categoría) — misma lógica de intercambio y detección de cruce que la pestaña de la
   * categoría: si el destino ya lo ocupa otro partido, se intercambian; si alguno de los
   * dos equipos ya tiene otro partido a esa hora, se avisa y no se mueve nada.
   */
  async function updateMatchSlot(match: Match, patch: { court_id?: string | null; scheduled_at?: string | null }) {
    const newCourtId = "court_id" in patch ? patch.court_id ?? null : match.court_id;
    const newScheduledAt = "scheduled_at" in patch ? patch.scheduled_at ?? null : match.scheduled_at;

    if (newCourtId && newScheduledAt) {
      const duration = Math.max(15, tournament?.default_match_minutes ?? 60);
      const slotCheck = match.stage === "liga"
        ? validateLeagueSlotTime(newScheduledAt, newCourtId, leagueSlots, duration)
        : validateTournamentDaySlotTime(newScheduledAt, days.find((d) => d.date === localDateStr(newScheduledAt)), duration);
      if (!slotCheck.ok) {
        setError(slotCheck.message ?? "Ese horario no es válido.");
        return;
      }

      const teamIds = [match.team1_id, match.team2_id].filter((tid): tid is string => !!tid);

      const { data: occupantRows } = await supabase
        .from("matches")
        .select("id, court_id, team1_id, team2_id")
        .eq("scheduled_at", newScheduledAt)
        .eq("court_id", newCourtId)
        .neq("id", match.id);
      const occupant = (occupantRows ?? [])[0];

      const { data: sameTime } = teamIds.length > 0
        ? await supabase
            .from("matches")
            .select("id, court_id, team1_id, team2_id")
            .eq("scheduled_at", newScheduledAt)
            .neq("id", match.id)
            .or(teamIds.flatMap((tid) => [`team1_id.eq.${tid}`, `team2_id.eq.${tid}`]).join(","))
        : { data: [] };

      // Cualquier otro partido de estos equipos a esa hora, en OTRA cancha, es un cruce real
      // y no se arregla intercambiando lugares — hay que elegir otro horario.
      const teamClash = (sameTime ?? []).find((m) => m.id !== occupant?.id);
      if (teamClash) {
        setError("Uno de estos dos equipos ya tiene otro partido agendado a esa misma hora — elegí otro horario o cancha.");
        return;
      }

      if (occupant) {
        if (match.scheduled_at) {
          const occupantTeamIds = [occupant.team1_id, occupant.team2_id].filter((tid): tid is string => !!tid);
          const { data: occupantClash } = occupantTeamIds.length > 0
            ? await supabase
                .from("matches")
                .select("id")
                .eq("scheduled_at", match.scheduled_at)
                .neq("id", occupant.id)
                .neq("id", match.id)
                .or(occupantTeamIds.flatMap((tid) => [`team1_id.eq.${tid}`, `team2_id.eq.${tid}`]).join(","))
            : { data: [] };
          if (occupantClash && occupantClash.length > 0) {
            setError("No se puede intercambiar: el partido que ocupa ese lugar tiene un equipo que ya juega a la hora anterior de este partido.");
            return;
          }
        }
        if (!(await run(supabase
          .from("matches")
          .update({ court_id: match.court_id, scheduled_at: match.scheduled_at, auto_scheduled: false })
          .eq("id", occupant.id)))) return;
      }
    }

    setError(null);
    if (!(await run(supabase.from("matches").update({ court_id: newCourtId, scheduled_at: newScheduledAt, auto_scheduled: false }).eq("id", match.id)))) return;
    load();
  }

  /** Cancela TODO el día elegido en la grilla (todas las canchas) — por lluvia, por ejemplo.
   *  Los partidos que tenía agendados no se pierden: se reacomodan solos a partir de dentro
   *  de 2 días (ver lib/visible-days.ts). */
  function handleCancelDay() {
    if (!selectedGridDay) return;
    setDangerInput("");
    setPendingDanger({
      title: `Cancelar el día ${selectedGridDay}`,
      description:
        "Se cancela TODO ese día (todas las canchas) para siempre: nunca más se va a agendar ningún partido ahí. Los partidos que tenía agendados no se pierden: se reacomodan solos, pero recién a partir de dentro de 2 días (hoy y mañana no se tocan, para no cambiar lo que el público ya ve).",
      confirmWord: "CANCELAR",
      run: runCancelDay,
    });
  }

  async function runCancelDay() {
    if (!selectedGridDay) return;
    setPendingDanger(null);
    setScheduling(true);
    setError(null);
    const result = await cancelDay(id!, selectedGridDay);
    setScheduling(false);
    reportCancelResult(result);
    load();
  }

  /** Cancela un partido puntual (esa cancha, ese horario exacto) — el resto del día sigue. */
  async function handleCancelTurn(match: Match) {
    if (!confirm("¿Cancelar este turno? El partido no se pierde: se va a reacomodar solo, pero recién a partir de dentro de 2 días (hoy y mañana no se tocan).")) return;
    setError(null);
    const result = await cancelTurn(id!, match);
    reportCancelResult(result);
    load();
  }

  /** Si después de cancelar quedó algún partido sin poder reacomodarse en ningún otro turno
   *  válido (se quedó sin capacidad), avisa en vez de dejarlo colgado en silencio. */
  function reportCancelResult(result: { unscheduled: number; error?: string }) {
    if (result.error) {
      setError(result.error);
    } else if (result.unscheduled > 0) {
      setError(
        `Ojo: no quedó lugar para reacomodar ${result.unscheduled} partido${result.unscheduled === 1 ? "" : "s"} — agregá más días u horarios.`,
      );
    } else {
      setError(null);
    }
  }

  async function handleRemoveBlackout(blackoutId: string) {
    const { error: err } = await removeBlackout(blackoutId);
    if (err) { setError(err); return; }
    load();
  }

  const allTeamsById = useMemo(() => Object.fromEntries(allTeams.map((t) => [t.id, t])), [allTeams]);
  const categoriesById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  const teamsByCategory = useMemo(() => {
    const byCat: Record<string, Team[]> = {};
    for (const t of allTeams) (byCat[t.category_id] ??= []).push(t);
    for (const list of Object.values(byCat)) list.sort((a, b) => a.name.localeCompare(b.name));
    return byCat;
  }, [allTeams]);
  const availableGridDays = useMemo(
    () => [...new Set(allMatches.map((m) => localDateStr(m.scheduled_at as string)))].sort(),
    [allMatches],
  );

  if (tournament === undefined) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (tournament === null) return <p className="text-sm text-zinc-500">No se encontró el torneo.</p>;

  const isLiga = tournament.modalidad === "liga";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
            <ArrowLeft className="h-3.5 w-3.5" /> Torneos
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-lg font-semibold">{tournament.name}</h1>
            <Badge color={statusLabels[tournament.status].color}>{statusLabels[tournament.status].label}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tournament.status === "armando" && (
            <Button variant="secondary" onClick={() => setTournamentStatus("en_curso")}>
              Marcar en curso
            </Button>
          )}
          {tournament.status !== "finalizado" ? (
            <Button variant="secondary" onClick={() => setTournamentStatus("finalizado")}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Finalizar torneo
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setTournamentStatus("en_curso")}>
              <RotateCcw className="h-3.5 w-3.5" /> Reabrir
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Modalidad</h2>
          <p className="text-xs text-zinc-500">Torneo: zonas + cuadro eliminatorio. Liga: todos contra todos con horarios semanales fijos.</p>
        </div>
        <Select value={tournament.modalidad} onChange={(e) => requestModalidadChange(e.target.value as Modalidad)} className="w-40">
          <option value="torneo">Torneo</option>
          <option value="liga">Liga</option>
        </Select>
      </Card>

      {pendingModalidad && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setPendingModalidad(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-base font-semibold">Cambiar a modalidad "{pendingModalidad === "liga" ? "Liga" : "Torneo"}"</h2>
            <p className="mb-4 text-sm text-zinc-600">
              Se van a borrar todos los partidos de este torneo que todavía NO tengan resultado cargado, en todas las categorías. Los
              partidos que ya tienen un resultado cargado no se tocan. Después vas a tener que generar de nuevo el fixture con el botón
              que corresponda al nuevo formato, en cada categoría (pestaña {pendingModalidad === "liga" ? '"Liga"' : '"Zonas" / "Fixture"'}).
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPendingModalidad(null)}>Cancelar</Button>
              <Button variant="danger" onClick={confirmModalidadChange} disabled={scheduling}>
                {scheduling ? "Cambiando…" : "Confirmar cambio"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {pendingDanger && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setPendingDanger(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-base font-semibold">{pendingDanger.title}</h2>
            <p className="mb-4 text-sm text-zinc-600">{pendingDanger.description}</p>
            <p className="mb-1.5 text-sm text-zinc-600">
              Para confirmar, escribí <span className="font-semibold text-zinc-900">{pendingDanger.confirmWord}</span>:
            </p>
            <Input
              value={dangerInput}
              onChange={(e) => setDangerInput(e.target.value)}
              placeholder={pendingDanger.confirmWord}
              className="mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPendingDanger(null)}>Cancelar</Button>
              <Button
                variant="danger"
                onClick={pendingDanger.run}
                disabled={scheduling || dangerInput.trim().toUpperCase() !== pendingDanger.confirmWord}
              >
                {scheduling ? "Ejecutando…" : "Confirmar"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {!isLiga && (
      <Card>
        <button
          type="button"
          onClick={() => setHorariosOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <div>
            <h2 className="mb-1 text-sm font-semibold">Horarios</h2>
            <p className="text-xs text-zinc-500">
              {horariosOpen
                ? "Cada día del torneo tiene su propia hora de inicio y de cierre. \"Autocompletar horarios\" agenda los partidos pendientes en cadena dentro de esas ventanas, repartidos entre las canchas — si un día se llena, sigue en el siguiente."
                : "Tocá para ver o editar los horarios de cada día."}
            </p>
          </div>
          {horariosOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />}
        </button>

        {horariosOpen && (
        <>
        <div className="mb-3 mt-3 flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Label>Minutos por partido</Label>
            <Input type="number" min={15} step={5} value={matchMinutes} onChange={(e) => setMatchMinutes(e.target.value)} onBlur={saveMatchMinutes} />
          </div>
          <Button variant="secondary" onClick={syncDays}>
            <RefreshCw className="h-3.5 w-3.5" /> Sincronizar días
          </Button>
          <Button variant="danger" onClick={clearSchedule} disabled={scheduling}>
            <Trash2 className="h-3.5 w-3.5" /> Vaciar horarios
          </Button>
          <Button onClick={autoSchedule} disabled={scheduling}>
            <CalendarClock className="h-3.5 w-3.5" /> {scheduling ? "Agendando…" : "Autocompletar horarios"}
          </Button>
        </div>

        {days.length === 0 ? (
          <p className="text-xs text-zinc-500">
            Todavía no hay días cargados. Cargale fecha de inicio (y fin) al torneo en la lista de Torneos, después tocá
            "Sincronizar días".
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {days.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
                <span className="w-28 font-medium">{d.date}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-zinc-500">de</span>
                  <input
                    type="time"
                    defaultValue={d.start_time.slice(0, 5)}
                    onBlur={(e) => updateDay(d, { start_time: e.target.value })}
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                  />
                  <span className="text-xs text-zinc-500">a</span>
                  <input
                    type="time"
                    defaultValue={d.end_time.slice(0, 5)}
                    onBlur={(e) => updateDay(d, { end_time: e.target.value })}
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        </>
        )}
      </Card>
      )}

      {isLiga && (
      <Card>
        <button
          type="button"
          onClick={() => setHorariosOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <div>
            <h2 className="mb-1 text-sm font-semibold">Horarios de la liga</h2>
            <p className="text-xs text-zinc-500">
              {horariosOpen
                ? 'Tildá los días en que se juega y elegí el horario CANCHA POR CANCHA — cada una puede tener su propia franja el mismo día. Si cruza la medianoche (ej. termina a las 00:30), un partido de esa madrugada sigue perteneciendo a la jornada del día que empezó la franja. "Autocompletar horarios" reparte los partidos semana a semana desde la fecha de inicio del torneo (se edita en la lista de Torneos), sin que una pareja juegue dos partidos superpuestos ni más de uno por noche.'
                : "Tocá para ver o editar los horarios semanales de cada cancha."}
            </p>
          </div>
          {horariosOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />}
        </button>

        {horariosOpen && (
        <>
        <div className="mb-3 mt-3 flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Label>Minutos por partido</Label>
            <Input type="number" min={15} step={5} value={matchMinutes} onChange={(e) => setMatchMinutes(e.target.value)} onBlur={saveMatchMinutes} />
          </div>
          <Button variant="danger" onClick={clearLeagueSchedule} disabled={scheduling}>
            <Trash2 className="h-3.5 w-3.5" /> Vaciar horarios
          </Button>
          <Button onClick={autoScheduleLeagueClick} disabled={scheduling}>
            <CalendarClock className="h-3.5 w-3.5" /> {scheduling ? "Agendando…" : "Autocompletar horarios"}
          </Button>
          <Button variant="secondary" onClick={fillGapsClick} disabled={scheduling}>
            <RefreshCw className="h-3.5 w-3.5" /> {scheduling ? "Agendando…" : "Rellenar huecos"}
          </Button>
          <Button variant="secondary" onClick={checkFixtureClick} disabled={checkingFixture}>
            <ClipboardCheck className="h-3.5 w-3.5" /> {checkingFixture ? "Revisando…" : "Chequear el fixture"}
          </Button>
        </div>

        {healthReport && (
          <div className={`mb-3 rounded-lg border p-3 text-sm ${healthReport.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            {healthReport.ok ? (
              <p>✓ Todo bien — revisé los {healthReport.totalMatches} partidos de liga y no encontré nada raro.</p>
            ) : (
              <>
                <p className="mb-1.5 font-medium">Ojo, encontré {healthReport.issues.length} cosa{healthReport.issues.length === 1 ? "" : "s"} rara{healthReport.issues.length === 1 ? "" : "s"}:</p>
                <ul className="list-disc pl-4">
                  {healthReport.issues.map((issue) => (
                    <li key={issue.type}>{issue.detail}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {courts.length === 0 ? (
          <p className="text-xs text-zinc-500">Cargá al menos una cancha primero (más abajo, en "Canchas").</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {LEAGUE_DAY_ORDER.map((dow) => {
              const dayEnabled = leagueSlots.some((s) => s.dia_semana === dow);
              return (
                <div key={dow} className="rounded-lg bg-zinc-50 px-3 py-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={dayEnabled}
                      onChange={(e) => toggleLeagueDay(dow, e.target.checked)}
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    {DIAS_SEMANA[dow]}
                  </label>
                  {dayEnabled && (
                    <div className="mt-2 flex flex-col gap-1.5 pl-6">
                      {courts.map((court) => {
                        const slot = leagueSlotFor(dow, court.id);
                        return (
                          <div key={court.id} className="flex flex-wrap items-center gap-3 text-sm">
                            <label className="flex w-28 shrink-0 items-center gap-2 text-xs text-zinc-600">
                              <input
                                type="checkbox"
                                checked={!!slot}
                                onChange={(e) => toggleLeagueCourtDay(dow, court.id, e.target.checked)}
                                className="h-4 w-4 rounded border-zinc-300"
                              />
                              {court.name}
                            </label>
                            {slot && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-zinc-500">de</span>
                                <input
                                  type="time"
                                  defaultValue={slot.hora_inicio.slice(0, 5)}
                                  onBlur={(e) => updateLeagueSlot(slot, { hora_inicio: e.target.value })}
                                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                                />
                                <span className="text-xs text-zinc-500">a</span>
                                <input
                                  type="time"
                                  defaultValue={slot.hora_fin.slice(0, 5)}
                                  onBlur={(e) => updateLeagueSlot(slot, { hora_fin: e.target.value })}
                                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </>
        )}
      </Card>
      )}

      {availableGridDays.length > 0 && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Grilla del día</h2>
              <p className="text-xs text-zinc-500">Cargá resultados con el lápiz de cada partido. También se puede descargar como imagen para subir a una historia de Instagram.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedGridDay} onChange={(e) => setSelectedGridDay(e.target.value)} className="w-auto">
                {availableGridDays.map((d) => (
                  <option key={d} value={d}>{d}{d === todayStr() ? " (hoy)" : ""}</option>
                ))}
              </Select>
              <Button variant="danger" onClick={handleCancelDay} disabled={scheduling || !selectedGridDay}>
                <CloudRain className="h-3.5 w-3.5" /> Cancelar este día
              </Button>
            </div>
          </div>

          {blackouts.length > 0 && (
            // Oculta por defecto -- los días/turnos cancelados ya no aparecen agendados en
            // ningún lado (el partido se reacomoda solo), así que mostrar esta lista siempre
            // era puro ruido visual. Queda a un clic por si hace falta deshacer alguna.
            <div className="mb-3">
              <button
                onClick={() => setShowBlackouts((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700"
              >
                {showBlackouts ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Turnos cancelados ({blackouts.length})
              </button>
              {showBlackouts && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {blackouts.map((b) => (
                    <span key={b.id} className="flex items-center gap-1.5 rounded-full bg-red-50 py-1 pl-3 pr-1.5 text-xs font-medium text-red-700">
                      {b.date}
                      {b.court_id ? ` · ${courts.find((c) => c.id === b.court_id)?.name ?? "cancha borrada"}` : " · todas las canchas"}
                      {b.hora_inicio ? ` · ${b.hora_inicio.slice(0, 5)}hs` : " · todo el día"}
                      <button onClick={() => handleRemoveBlackout(b.id)} className="rounded-full p-0.5 hover:bg-red-100" aria-label="Quitar cancelación">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <DailyFixtureStory
            tournamentName={tournament.name}
            date={selectedGridDay}
            matches={allMatches}
            courts={courts}
            teamsById={allTeamsById}
            categoriesById={categoriesById}
            fileName={`dia-${tournament.name}-${selectedGridDay}`}
            editable
            onSaveResult={saveResult}
            onSlotChange={(match, patch) => updateMatchSlot(match, { court_id: patch.courtId, scheduled_at: patch.iso })}
            onCancelTurn={handleCancelTurn}
            onSwapOpponent={(match, otherMatch) => updateMatchSlot(match, { court_id: otherMatch.court_id, scheduled_at: otherMatch.scheduled_at })}
            teamAvailability={teamAvailability}
            teamUnavailability={teamUnavailability}
            matchDurationMinutes={Math.max(15, tournament?.default_match_minutes ?? 60)}
          />
        </Card>
      )}

      {isLiga && unscheduledMatches.length > 0 && (
        <Card>
          <h2 className="mb-1 text-sm font-semibold">Partidos sin agendar ({unscheduledMatches.length})</h2>
          <p className="mb-3 text-xs text-zinc-500">
            Quedaron sin cancha ni horario — puede pasar si una reparación puntual no encontró lugar. Elegiles cancha y fecha acá para sacarlos de esta lista.
          </p>
          <div className="flex flex-col gap-2">
            {unscheduledMatches.map((m) => (
              <UnscheduledMatchRow
                key={m.id}
                match={m}
                courts={courts}
                categoryName={categoriesById[m.category_id]?.name ?? "?"}
                team1Name={allTeamsById[m.team1_id ?? ""]?.name ?? "?"}
                team2Name={allTeamsById[m.team2_id ?? ""]?.name ?? "?"}
                onConfirm={updateMatchSlot}
              />
            ))}
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Canchas</h2>
        <form onSubmit={addCourt} className="mb-3 flex items-end gap-3">
          <div className="flex-1">
            <Label>Nombre</Label>
            <Input value={courtName} onChange={(e) => setCourtName(e.target.value)} placeholder="Cancha 1" />
          </div>
          <Button type="submit">
            <Plus className="h-3.5 w-3.5" /> Agregar
          </Button>
        </form>
        {courts.length === 0 ? (
          <p className="text-xs text-zinc-500">Todavía no cargaste canchas.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {courts.map((c) => (
              <span key={c.id} className="flex items-center gap-1.5 rounded-full bg-zinc-100 py-1 pl-3 pr-1.5 text-xs font-medium">
                {c.name}
                <button onClick={() => deleteCourt(c.id)} className="rounded-full p-0.5 hover:bg-zinc-200" aria-label={`Borrar ${c.name}`}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Categorías</h2>
          {allTeams.length > 0 && (
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Imprimir participantes
            </Button>
          )}
        </div>
        <form onSubmit={addCategory} className="mb-3 flex items-end gap-3">
          <div className="flex-1">
            <Label>Nombre</Label>
            <Input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="4ta Caballeros" />
          </div>
          <Button type="submit">
            <Plus className="h-3.5 w-3.5" /> Agregar
          </Button>
        </form>
        {categories.length === 0 ? (
          <p className="text-xs text-zinc-500">Todavía no cargaste categorías.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2">
                <Link to={`/admin/torneos/${id}/categorias/${c.id}`} className="text-sm font-medium hover:underline">
                  {c.name}
                </Link>
                <div className="flex items-center gap-2">
                  <Link to={`/admin/torneos/${id}/categorias/${c.id}`}>
                    <Button variant="secondary" className="px-2 py-1 text-xs">
                      Gestionar
                    </Button>
                  </Link>
                  <button onClick={() => deleteCategory(c.id)} className="rounded-md p-1.5 text-red-600 hover:bg-zinc-100" aria-label={`Borrar ${c.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ParticipantsList tournamentName={tournament.name} categories={categories} teamsByCategory={teamsByCategory} />
    </div>
  );
}
