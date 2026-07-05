import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Category, Court, Tournament } from "@/lib/types";
import { buildSchedule } from "@/lib/tournament-logic";
import { Button, Card, Input, Label, Spinner } from "@/components/ui";

export function TournamentManage() {
  const { id } = useParams<{ id: string }>();
  const [tournament, setTournament] = useState<Tournament | null | undefined>(undefined);
  const [courts, setCourts] = useState<Court[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [courtName, setCourtName] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [startTime, setStartTime] = useState("12:00");
  const [matchMinutes, setMatchMinutes] = useState("60");
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [{ data: t }, { data: c }, { data: cats }] = await Promise.all([
      supabase.from("tournaments").select("*").eq("id", id!).maybeSingle(),
      supabase.from("courts").select("*").eq("tournament_id", id!).order("name"),
      supabase.from("categories").select("*").eq("tournament_id", id!).order("created_at"),
    ]);
    setTournament(t ?? null);
    setCourts(c ?? []);
    setCategories(cats ?? []);
    if (t) {
      setStartTime((t.default_start_time ?? "12:00:00").slice(0, 5));
      setMatchMinutes(String(t.default_match_minutes ?? 60));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveScheduleDefaults() {
    await supabase
      .from("tournaments")
      .update({ default_start_time: startTime, default_match_minutes: Math.max(15, Number(matchMinutes) || 60) })
      .eq("id", id!);
    load();
  }

  async function autoSchedule() {
    if (!tournament?.start_date) { setError("Primero cargale una fecha de inicio al torneo."); return; }
    if (courts.length === 0) { setError("Cargá al menos una cancha primero."); return; }
    if (categories.length === 0) return;
    setScheduling(true);
    setError(null);
    await saveScheduleDefaults();

    const categoryOrder = new Map(categories.map((c, i) => [c.id, i]));
    const { data: matches } = await supabase
      .from("matches")
      .select("*, zone:zones(position)")
      .in("category_id", categories.map((c) => c.id))
      .is("scheduled_at", null)
      .not("team1_id", "is", null)
      .not("team2_id", "is", null);

    const pending = (matches ?? []).sort((a, b) => {
      const catDiff = (categoryOrder.get(a.category_id) ?? 0) - (categoryOrder.get(b.category_id) ?? 0);
      if (catDiff !== 0) return catDiff;
      if (a.stage !== b.stage) return a.stage === "zona" ? -1 : 1;
      const zoneDiff = (a.zone?.position ?? 0) - (b.zone?.position ?? 0);
      if (zoneDiff !== 0) return zoneDiff;
      return (a.round_order ?? 0) - (b.round_order ?? 0) || a.position - b.position;
    });

    if (pending.length === 0) {
      setScheduling(false);
      setError("No hay partidos pendientes de horario (o ya están todos agendados).");
      return;
    }

    const assignments = buildSchedule(
      pending.map((m) => m.id),
      courts.map((c) => c.id),
      tournament.start_date,
      startTime,
      Math.max(15, Number(matchMinutes) || 60),
    );
    for (const a of assignments) {
      await supabase.from("matches").update({ court_id: a.courtId, scheduled_at: a.scheduledAt }).eq("id", a.matchId);
    }
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
          Define a qué hora arranca el primer turno de partidos y cuánto dura cada uno. "Autocompletar horarios" agenda todos los
          partidos pendientes (sin fecha) en cadena, repartidos entre las canchas cargadas.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32">
            <Label>Hora de inicio</Label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} onBlur={saveScheduleDefaults} />
          </div>
          <div className="w-40">
            <Label>Minutos por partido</Label>
            <Input type="number" min={15} step={5} value={matchMinutes} onChange={(e) => setMatchMinutes(e.target.value)} onBlur={saveScheduleDefaults} />
          </div>
          <Button onClick={autoSchedule} disabled={scheduling}>
            <CalendarClock className="h-3.5 w-3.5" /> {scheduling ? "Agendando…" : "Autocompletar horarios"}
          </Button>
        </div>
      </Card>

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
