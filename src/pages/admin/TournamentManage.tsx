import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Category, Court, Tournament } from "@/lib/types";
import { Button, Card, Input, Label, Spinner } from "@/components/ui";

export function TournamentManage() {
  const { id } = useParams<{ id: string }>();
  const [tournament, setTournament] = useState<Tournament | null | undefined>(undefined);
  const [courts, setCourts] = useState<Court[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [courtName, setCourtName] = useState("");
  const [categoryName, setCategoryName] = useState("");
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
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
