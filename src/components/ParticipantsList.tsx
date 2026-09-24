import type { Category, Team } from "@/lib/types";

/**
 * Lista imprimible de todos los participantes del torneo, agrupados por categoría. Se
 * queda oculta en pantalla (`.print-area` solo se ve con @media print, ver index.css) y
 * solo aparece cuando se dispara `window.print()`.
 */
export function ParticipantsList({
  tournamentName,
  categories,
  teamsByCategory,
}: {
  tournamentName: string;
  categories: Category[];
  teamsByCategory: Record<string, Team[]>;
}) {
  return (
    <div className="print-area hidden print:block">
      <div className="p-8 text-black">
        <h1 className="mb-1 text-2xl font-bold">{tournamentName}</h1>
        <p className="mb-6 text-sm text-zinc-500">Lista de participantes</p>
        {categories.map((cat) => {
          const teams = teamsByCategory[cat.id] ?? [];
          if (teams.length === 0) return null;
          return (
            <div key={cat.id} className="mb-6 break-inside-avoid">
              <h2 className="mb-2 border-b border-zinc-300 pb-1 text-lg font-semibold">
                {cat.name} ({teams.length})
              </h2>
              <ol className="list-decimal pl-6 text-sm leading-relaxed">
                {teams.map((t) => (
                  <li key={t.id} className="break-inside-avoid">{t.name}</li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}
