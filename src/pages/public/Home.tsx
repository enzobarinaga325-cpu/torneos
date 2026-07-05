import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, Trophy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Tournament } from "@/lib/types";
import { Spinner } from "@/components/ui";

export function Home() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("tournaments")
      .select("*")
      .order("start_date", { ascending: false })
      .then(({ data }) => {
        setTournaments(data ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center gap-2">
        <Trophy className="h-6 w-6 text-emerald-600" />
        <h1 className="text-xl font-semibold">Torneos de pádel</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : tournaments.length === 0 ? (
        <p className="text-sm text-zinc-500">Todavía no hay torneos publicados.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {tournaments.map((t) => (
            <Link key={t.id} to={`/torneo/${t.slug}`} className="rounded-xl border border-zinc-200 bg-white p-4 hover:border-emerald-400">
              <h2 className="font-semibold">{t.name}</h2>
              {t.start_date && (
                <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                  <Calendar className="h-3.5 w-3.5" /> {t.start_date}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
