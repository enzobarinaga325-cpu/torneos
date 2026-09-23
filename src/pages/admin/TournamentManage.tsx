import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, CheckCircle2, Image as ImageIcon, RefreshCw, Plus, RotateCcw, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Category, Court, LeagueSlot, Match, Modalidad, Team, Tournament, TournamentDay } from "@/lib/types";
import { matchWinner } from "@/lib/tournament-logic";
import { autoScheduleTournament } from "@/lib/autoschedule";
import { autoScheduleLeague } from "@/lib/league-autoschedule";
import { uploadSiteImage } from "@/lib/images";
import { DIAS_SEMANA } from "@/lib/league-logic";
import { localDateStr, todayStr } from "@/lib/format";
import { DayGrid } from "@/components/DayGrid";
import { WeeklyFixtureStory } from "@/components/WeeklyFixtureStory";
import { Badge, Button, Card, Input, Label, Select, Spinner } from "@/components/ui";

/** Lunes a domingo, para mostrarlos en el orden natural de la semana (día 0 = domingo). */
const LEAGUE_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Lunes ("YYYY-MM-DD") de la semana que contiene `dateStr`. */
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const diff = (dt.getDay() + 6) % 7; // días desde el lunes de esa semana
  dt.setDate(dt.getDate() - diff);
  return localDateStr(dt);
}

/** Los 7 días ("YYYY-MM-DD") de lunes a domingo, a partir de un lunes. */
function weekDatesFrom(mondayStr: string): string[] {
  const [y, m, d] = mondayStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(dt);
    day.setDate(dt.getDate() + i);
    return localDateStr(day);
  });
}

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

export function TournamentManage() {
  const { id } = useParams<{ id: string }>();
  const [tournament, setTournament] = useState<Tournament | null | undefined>(undefined);
  const [courts, setCourts] = useState<Court[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [days, setDays] = useState<TournamentDay[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const [leagueSlots, setLeagueSlots] = useState<LeagueSlot[]>([]);
  const [selectedGridDay, setSelectedGridDay] = useState("");
  const [selectedWeek, setSelectedWeek] = useState("");
  const [courtName, setCourtName] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [matchMinutes, setMatchMinutes] = useState("60");
  const [scheduling, setScheduling] = useState(false);
  const [pendingModalidad, setPendingModalidad] = useState<Modalidad | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [{ data: t }, { data: c }, { data: cats }, { data: d }, { data: ls }] = await Promise.all([
      supabase.from("tournaments").select("*").eq("id", id!).maybeSingle(),
      supabase.from("courts").select("*").eq("tournament_id", id!).order("name"),
      supabase.from("categories").select("*").eq("tournament_id", id!).order("created_at"),
      supabase.from("tournament_days").select("*").eq("tournament_id", id!).order("date"),
      supabase.from("horarios_liga").select("*").eq("tournament_id", id!),
    ]);
    setTournament(t ?? null);
    setCourts(c ?? []);
    setCategories(cats ?? []);
    setDays(d ?? []);
    setLeagueSlots(ls ?? []);
    if (t) setMatchMinutes(String(t.default_match_minutes ?? 60));

    if (cats && cats.length > 0) {
      const categoryIds = cats.map((c) => c.id);
      const [{ data: allT }, { data: allM }] = await Promise.all([
        supabase.from("teams").select("*").in("category_id", categoryIds),
        supabase.from("matches").select("*").in("category_id", categoryIds).not("scheduled_at", "is", null),
      ]);
      setAllTeams(allT ?? []);
      setAllMatches((allM as Match[]) ?? []);
      const dates = [...new Set((allM ?? []).map((m) => localDateStr(m.scheduled_at as string)))].sort();
      const today = todayStr();
      setSelectedGridDay((prev) => prev || dates.find((d) => d >= today) || dates[0] || "");
      setSelectedWeek((prev) => prev || mondayOf(dates.find((d) => d >= today) ?? dates[0] ?? today));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveMatchMinutes() {
    await supabase
      .from("tournaments")
      .update({ default_match_minutes: Math.max(15, Number(matchMinutes) || 60) })
      .eq("id", id!);
  }

  /** Crea una fila por cada día entre start_date y end_date que todavía no la tenga. */
  async function syncDays() {
    if (!tournament?.start_date) { setError("Primero cargale fecha de inicio (y de fin) al torneo."); return; }
    const dates = enumerateDates(tournament.start_date, tournament.end_date ?? tournament.start_date);
    const existing = new Set(days.map((d) => d.date));
    const missing = dates.filter((date) => !existing.has(date));
    if (missing.length > 0) {
      await supabase.from("tournament_days").insert(missing.map((date) => ({ tournament_id: id, date })));
    }
    load();
  }

  async function updateDay(day: TournamentDay, patch: Partial<Pick<TournamentDay, "start_time" | "end_time">>) {
    await supabase.from("tournament_days").update(patch).eq("id", day.id);
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
    await supabase
      .from("matches")
      .update({ court_id: null, scheduled_at: null })
      .in("category_id", categories.map((c) => c.id));
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
    await supabase.from("tournaments").update({ status }).eq("id", id!);
    setTournament((t) => (t ? { ...t, status } : t));
  }

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    setError(null);
    try {
      const url = await uploadSiteImage(file);
      await supabase.from("tournaments").update({ logo_url: url }).eq("id", id!);
      setTournament((t) => (t ? { ...t, logo_url: url } : t));
    } catch (e) {
      setError("No se pudo subir el logo: " + (e instanceof Error ? e.message : String(e)));
    }
    setUploadingLogo(false);
  }

  async function removeLogo() {
    await supabase.from("tournaments").update({ logo_url: null }).eq("id", id!);
    setTournament((t) => (t ? { ...t, logo_url: null } : t));
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
      if (unplayedIds.length > 0) await supabase.from("matches").delete().in("id", unplayedIds);
    }
    await supabase.from("tournaments").update({ modalidad: pendingModalidad }).eq("id", id!);
    setPendingModalidad(null);
    setScheduling(false);
    load();
  }

  // ============ HORARIOS DE LIGA (uno por cancha por día) ============
  function leagueSlotFor(diaSemana: number, courtId: string): LeagueSlot | undefined {
    return leagueSlots.find((s) => s.dia_semana === diaSemana && s.court_id === courtId);
  }

  /** Tildar un día crea de una un horario para CADA cancha (19 a 23hs por defecto, editable
   *  después cancha por cancha); destildarlo borra los horarios de todas las canchas ese día. */
  async function toggleLeagueDay(diaSemana: number, enabled: boolean) {
    if (enabled) {
      if (courts.length === 0) { setError("Cargá al menos una cancha primero."); return; }
      await supabase.from("horarios_liga").insert(
        courts.map((c) => ({ tournament_id: id, court_id: c.id, dia_semana: diaSemana, hora_inicio: "19:00", hora_fin: "23:00" })),
      );
    } else {
      const existingIds = leagueSlots.filter((s) => s.dia_semana === diaSemana).map((s) => s.id);
      if (existingIds.length > 0) await supabase.from("horarios_liga").delete().in("id", existingIds);
    }
    load();
  }

  async function toggleLeagueCourtDay(diaSemana: number, courtId: string, enabled: boolean) {
    if (enabled) {
      await supabase.from("horarios_liga").insert({ tournament_id: id, court_id: courtId, dia_semana: diaSemana, hora_inicio: "19:00", hora_fin: "23:00" });
    } else {
      const existing = leagueSlotFor(diaSemana, courtId);
      if (existing) await supabase.from("horarios_liga").delete().eq("id", existing.id);
    }
    load();
  }

  async function updateLeagueSlot(slot: LeagueSlot, patch: Partial<Pick<LeagueSlot, "hora_inicio" | "hora_fin">>) {
    await supabase.from("horarios_liga").update(patch).eq("id", slot.id);
    setLeagueSlots((s) => s.map((x) => (x.id === slot.id ? { ...x, ...patch } : x)));
  }

  async function autoScheduleLeagueClick() {
    if (courts.length === 0) { setError("Cargá al menos una cancha primero."); return; }
    if (leagueSlots.length === 0) { setError("Cargá al menos un horario semanal de la liga primero."); return; }
    if (!tournament?.start_date) { setError("Cargale una fecha de inicio al torneo primero (desde la lista de Torneos)."); return; }
    if (categories.length === 0) return;
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

  /** Borra la cancha+horario de todos los partidos de liga (los resultados no se tocan). */
  async function clearLeagueSchedule() {
    if (categories.length === 0) return;
    if (!confirm("¿Vaciar el horario y la cancha de TODOS los partidos de liga de este torneo? Los resultados ya cargados no se tocan.")) return;
    setScheduling(true);
    setError(null);
    await supabase
      .from("matches")
      .update({ court_id: null, scheduled_at: null, auto_scheduled: true })
      .in("category_id", categories.map((c) => c.id))
      .eq("stage", "liga");
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
    await supabase.from("courts").delete().eq("id", courtId);
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
    await supabase.from("categories").delete().eq("id", categoryId);
    load();
  }

  const allTeamsById = useMemo(() => Object.fromEntries(allTeams.map((t) => [t.id, t])), [allTeams]);
  const categoriesById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  const availableGridDays = useMemo(
    () => [...new Set(allMatches.map((m) => localDateStr(m.scheduled_at as string)))].sort(),
    [allMatches],
  );
  const availableWeeks = useMemo(
    () => [...new Set(availableGridDays.map(mondayOf))].sort(),
    [availableGridDays],
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
        <div className="flex items-center gap-2">
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

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Logo</h2>
          <p className="text-xs text-zinc-500">Aparece en el cartel semanal para Instagram y otras vistas para compartir.</p>
        </div>
        <div className="flex items-center gap-3">
          {tournament.logo_url ? (
            <img src={tournament.logo_url} alt="Logo" className="h-12 w-20 rounded-lg border border-zinc-200 object-contain bg-black" />
          ) : (
            <div className="flex h-12 w-20 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-zinc-400">
              <ImageIcon className="h-4 w-4" />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="cursor-pointer text-sm text-emerald-700 underline">
              {uploadingLogo ? "Subiendo…" : tournament.logo_url ? "Cambiar logo" : "Subir logo"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadingLogo}
                onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
              />
            </label>
            {tournament.logo_url && (
              <button onClick={removeLogo} className="text-left text-sm text-zinc-500 underline">
                Quitar logo
              </button>
            )}
          </div>
        </div>
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

      {!isLiga && (
      <Card>
        <h2 className="mb-1 text-sm font-semibold">Horarios</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Cada día del torneo tiene su propia hora de inicio y de cierre. "Autocompletar horarios" agenda los partidos pendientes en
          cadena dentro de esas ventanas, repartidos entre las canchas — si un día se llena, sigue en el siguiente.
        </p>

        <div className="mb-3 flex flex-wrap items-end gap-3">
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
      </Card>
      )}

      {isLiga && (
      <Card>
        <h2 className="mb-1 text-sm font-semibold">Horarios de la liga</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Tildá los días en que se juega y elegí el horario CANCHA POR CANCHA — cada una puede tener su propia franja el mismo día. Si
          cruza la medianoche (ej. termina a las 00:30), un partido de esa madrugada sigue perteneciendo a la jornada del día que empezó
          la franja. "Autocompletar horarios" reparte los partidos semana a semana desde la fecha de inicio del torneo (se edita en la
          lista de Torneos), sin que una pareja juegue dos partidos superpuestos ni más de uno por noche.
        </p>

        <div className="mb-3 flex flex-wrap items-end gap-3">
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
        </div>

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
      </Card>
      )}

      {availableGridDays.length > 0 && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Grilla del día</h2>
            <Select value={selectedGridDay} onChange={(e) => setSelectedGridDay(e.target.value)} className="w-auto">
              {availableGridDays.map((d) => (
                <option key={d} value={d}>{d}{d === todayStr() ? " (hoy)" : ""}</option>
              ))}
            </Select>
          </div>
          <DayGrid
            date={selectedGridDay}
            matches={allMatches}
            courts={courts}
            teamsById={allTeamsById}
            categoriesById={categoriesById}
            fileName={`grilla-${tournament.name}-${selectedGridDay}`}
          />
        </Card>
      )}

      {isLiga && availableWeeks.length > 0 && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Semana para Instagram</h2>
              <p className="text-xs text-zinc-500">Cartel vertical con todos los partidos de la semana, por día y cancha, listo para subir a una historia.</p>
            </div>
            <Select value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)} className="w-auto">
              {availableWeeks.map((w) => (
                <option key={w} value={w}>Semana del {w}</option>
              ))}
            </Select>
          </div>
          <WeeklyFixtureStory
            tournamentName={tournament.name}
            logoUrl={tournament.logo_url}
            weekDates={weekDatesFrom(selectedWeek)}
            matches={allMatches}
            courts={courts}
            teamsById={allTeamsById}
            categoriesById={categoriesById}
            fileName={`semana-${tournament.name}-${selectedWeek}`}
          />
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
        <h2 className="mb-3 text-sm font-semibold">Categorías</h2>
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
    </div>
  );
}
