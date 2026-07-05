import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Eye, EyeOff, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Tournament } from "@/lib/types";
import { formatDateRange } from "@/lib/format";
import { Button, Card, Input, Label, Badge } from "@/components/ui";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "torneo"
  );
}

const statusLabels: Record<string, { label: string; color: "zinc" | "green" | "amber" }> = {
  armando: { label: "Armando", color: "amber" },
  en_curso: { label: "En curso", color: "green" },
  finalizado: { label: "Finalizado", color: "zinc" },
};

export function Tournaments() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingDatesFor, setEditingDatesFor] = useState<string | null>(null);
  const [dateDraft, setDateDraft] = useState({ start: "", end: "" });

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("tournaments").select("*").order("created_at", { ascending: false });
    setTournaments(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function createTournament(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    let slug = slugify(name);
    // Evita choques de slug sin necesitar que el usuario piense en URLs.
    const existing = new Set(tournaments.map((t) => t.slug));
    if (existing.has(slug)) slug = `${slug}-${Date.now().toString(36)}`;
    const { error } = await supabase
      .from("tournaments")
      .insert({ name: name.trim(), slug, start_date: startDate || null, end_date: endDate || startDate || null });
    setCreating(false);
    if (error) {
      setError(error.message);
      return;
    }
    setName("");
    setStartDate("");
    setEndDate("");
    load();
  }

  function openDateEditor(t: Tournament) {
    setEditingDatesFor(t.id);
    setDateDraft({ start: t.start_date ?? "", end: t.end_date ?? "" });
  }

  async function saveDates(t: Tournament) {
    await supabase
      .from("tournaments")
      .update({ start_date: dateDraft.start || null, end_date: dateDraft.end || dateDraft.start || null })
      .eq("id", t.id);
    setEditingDatesFor(null);
    load();
  }

  async function togglePublished(t: Tournament) {
    await supabase.from("tournaments").update({ published: !t.published }).eq("id", t.id);
    load();
  }

  async function deleteTournament(t: Tournament) {
    if (!confirm(`¿Borrar el torneo "${t.name}"? Se borran también sus categorías, equipos y partidos. No se puede deshacer.`)) return;
    await supabase.from("tournaments").delete().eq("id", t.id);
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Torneos</h1>
        <p className="text-sm text-zinc-500">Creá un torneo, armalo en privado y publicalo cuando esté listo.</p>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Nuevo torneo</h2>
        <form onSubmit={createTournament} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Apertura 2026" required />
          </div>
          <div className="w-44">
            <Label>Fecha de inicio</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="w-44">
            <Label>Fecha de fin (opcional)</Label>
            <Input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <Button type="submit" disabled={creating}>
            <Plus className="h-3.5 w-3.5" /> Crear
          </Button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </Card>

      {loading ? (
        <p className="text-sm text-zinc-500">Cargando…</p>
      ) : tournaments.length === 0 ? (
        <Card className="text-center text-sm text-zinc-500">Todavía no creaste ningún torneo.</Card>
      ) : (
        <div className="flex flex-col gap-3">
          {tournaments.map((t) => (
            <Card key={t.id} className="flex flex-wrap items-center gap-3">
              <div className="min-w-[180px] flex-1">
                <div className="flex items-center gap-2">
                  <Link to={`/admin/torneos/${t.id}`} className="font-medium hover:underline">
                    {t.name}
                  </Link>
                  <Badge color={statusLabels[t.status].color}>{statusLabels[t.status].label}</Badge>
                  <Badge color={t.published ? "green" : "zinc"}>{t.published ? "Publicado" : "Privado"}</Badge>
                </div>
                {editingDatesFor === t.id ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Input type="date" value={dateDraft.start} onChange={(e) => setDateDraft((d) => ({ ...d, start: e.target.value }))} className="w-36 py-1 text-xs" />
                    <span className="text-xs text-zinc-400">al</span>
                    <Input type="date" value={dateDraft.end} min={dateDraft.start || undefined} onChange={(e) => setDateDraft((d) => ({ ...d, end: e.target.value }))} className="w-36 py-1 text-xs" />
                    <Button className="px-2 py-1 text-xs" onClick={() => saveDates(t)}>Guardar</Button>
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditingDatesFor(null)}>Cancelar</Button>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">
                    {t.start_date ? formatDateRange(t.start_date, t.end_date) : "Sin fecha"}{" "}
                    <button onClick={() => openDateEditor(t)} className="underline">
                      editar fechas
                    </button>
                  </p>
                )}
              </div>
              <Link to={`/admin/torneos/${t.id}`}>
                <Button variant="secondary">Gestionar</Button>
              </Link>
              <Button variant="secondary" onClick={() => togglePublished(t)}>
                {t.published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {t.published ? "Despublicar" : "Publicar"}
              </Button>
              <Button variant="danger" onClick={() => deleteTournament(t)}>
                <Trash2 className="h-3.5 w-3.5" /> Borrar
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
