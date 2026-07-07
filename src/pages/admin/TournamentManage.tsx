import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, RefreshCw, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Category, Court, Match, Team, Tournament, TournamentDay } from "@/lib/types";
import { autoScheduleTournament } from "@/lib/autoschedule";
import { localDateStr, todayStr } from "@/lib/format";
import { DayGrid } from "@/components/DayGrid";
import { Button, Card, Input, Label, Select, Spinner } from "@/components/ui";

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
  const [selectedGridDay, setSelectedGridDay] = useState("");
  const [courtName, setCourtName] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [matchMinutes, setMatchMinutes] = useState("60");
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [{ data: t }, { data: c }, { data: cats }, { data: d }] = await Promise.all([
      supabase.from("tournaments").select("*").eq("id", id!).maybeSingle(),
      supabase.from("courts").select("*").eq("tournament_id", id!).order("name"),
      supabase.from("categories").select("*").eq("tournament_id", id!).order("created_at"),
      supabase.from("tournament_days").select("*").eq("tournament_id", id!).order("date"),
    ]);
    setTournament(t ?? null);
    setCourts(c ?? []);
    setCategories(cats ?? []);
    setDays(d ?? []);
    if (t) setMatchMinutes(String(t.default_match_minutes ?? 60));

    if (cats && cats.length > 0) {
      const categoryIds = cats.map((c) => c.id);
      const [{ data: allT }, { data: allM }] = await Promise.all([
        supabase.from("teams").select("*").in("category_id", categoryIds),
        supabase.from("matches").select("*").in("category_id", categoryIds).not("scheduled_at", "is", null),
      ]);
      setAllTeams(allT ?? []);
      setAllMatches((allM as Match[]) ?? []);
      setSelectedGridDay((prev) => {
        if (prev) return prev;
        const dates = [...new Set((allM ?? []).map((m) => localDateStr(m.scheduled_at as string)))].sort();
        const today = todayStr();
        return dates.find((d) => d >= today) ?? dates[0] ?? "";
      });
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

  if (tournament === undefined) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (tournament === null) return <p className="text-sm text-zinc-500">No se encontró el torneo.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
          <ArrowLeft className="h-3.5 w-3.5" /> Torneos
        </Link>
        <h1 className="mt-1 text-lg font-semibold">{tournament.name}</h1>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

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
