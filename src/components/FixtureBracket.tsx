import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Download, Loader2, Trophy } from "lucide-react";
import type { Match, Team } from "@/lib/types";
import { matchWinner } from "@/lib/tournament-logic";
import { Button } from "./ui";

const SLOT_BASE = 92; // alto de un partido de la 1ra ronda, en px

function scoreLine(m: Match, slot: 1 | 2): string {
  const sets = [
    [m.set1_team1, m.set1_team2],
    [m.set2_team1, m.set2_team2],
    [m.set3_team1, m.set3_team2],
  ] as const;
  return sets
    .filter(([a, b]) => a != null && b != null)
    .map(([a, b]) => (slot === 1 ? a : b))
    .join(" ");
}

function MatchCard({ match, teamsById }: { match: Match; teamsById: Record<string, Team> }) {
  const winner = matchWinner(match);
  // Un bye real ya tiene ganador definido al generar el fixture (avanzó sin jugar);
  // si falta un equipo pero todavía no hay ganador, es que la ronda anterior no terminó.
  const isBye = match.winner_id != null && (!match.team1_id || !match.team2_id);
  const t1 = match.team1_id ? teamsById[match.team1_id]?.name ?? "?" : "Por definir";
  const t2 = match.team2_id ? teamsById[match.team2_id]?.name ?? "?" : "Por definir";

  return (
    <div className="w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <Row name={t1} score={scoreLine(match, 1)} won={winner === 1} />
      <div className="h-px bg-zinc-100" />
      <Row name={t2} score={scoreLine(match, 2)} won={winner === 2} />
      {isBye && <p className="border-t border-zinc-100 px-3 py-1 text-center text-[10px] text-zinc-400">pase directo</p>}
    </div>
  );
}

function Row({ name, score, won }: { name: string; score: string; won: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 px-3 py-2 ${won ? "bg-emerald-50" : ""}`}>
      <span className={`truncate text-sm ${won ? "font-semibold text-emerald-700" : "text-zinc-700"}`}>{name}</span>
      {score && <span className={`shrink-0 font-mono text-xs ${won ? "font-bold text-emerald-700" : "text-zinc-400"}`}>{score}</span>}
    </div>
  );
}

export function FixtureBracket({
  matches, teamsById, fileName, showDownload = true,
}: {
  matches: Match[];
  teamsById: Record<string, Team>;
  fileName: string;
  showDownload?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const roundOrders = [...new Set(matches.map((m) => m.round_order ?? 0))].sort((a, b) => a - b);
  const rounds = roundOrders.map((ro) => matches.filter((m) => (m.round_order ?? 0) === ro).sort((a, b) => a.position - b.position));
  const totalHeight = SLOT_BASE * (rounds[0]?.length ?? 1);

  const final = rounds[rounds.length - 1]?.[0];
  const championId = final ? matchWinner(final) === 1 ? final.team1_id : matchWinner(final) === 2 ? final.team2_id : null : null;

  async function download() {
    if (!containerRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(containerRef.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${fileName}.png`;
      a.click();
    } finally {
      setDownloading(false);
    }
  }

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
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-6">
        <div ref={containerRef} className="inline-block bg-white p-4">
          {championId && teamsById[championId] && (
            <div className="mb-5 flex items-center justify-center gap-2 text-emerald-700">
              <Trophy className="h-5 w-5 text-amber-500" />
              <span className="font-semibold">Campeón: {teamsById[championId].name}</span>
            </div>
          )}
          <div className="flex">
            {rounds.map((roundMatches, ri) => {
              const slotHeight = SLOT_BASE * Math.pow(2, ri);
              const isLast = ri === rounds.length - 1;
              return (
                <div key={ri} className="flex">
                  <div className="flex flex-col" style={{ width: 224 }}>
                    <h3 className="mb-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      {roundMatches[0]?.round_name}
                    </h3>
                    <div style={{ height: totalHeight }} className="relative">
                      {roundMatches.map((m, mi) => (
                        <div
                          key={m.id}
                          className="absolute left-0 flex w-full items-center"
                          style={{ top: slotHeight * mi, height: slotHeight }}
                        >
                          <MatchCard match={m} teamsById={teamsById} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {!isLast && (
                    <div className="relative shrink-0" style={{ width: 32, height: totalHeight + 32 }}>
                      {Array.from({ length: roundMatches.length / 2 }).map((_, pairIdx) => {
                        const yTop = slotHeight * (pairIdx * 2) + slotHeight / 2 + 32;
                        const yBottom = slotHeight * (pairIdx * 2 + 1) + slotHeight / 2 + 32;
                        const yMid = (yTop + yBottom) / 2;
                        return (
                          <div key={pairIdx}>
                            <div
                              className="absolute left-0 w-4 border-r-2 border-t-2 border-zinc-300"
                              style={{ top: yTop, height: yMid - yTop }}
                            />
                            <div
                              className="absolute left-0 w-4 border-r-2 border-b-2 border-zinc-300"
                              style={{ top: yMid, height: yBottom - yMid }}
                            />
                            <div className="absolute left-4 w-4 border-t-2 border-zinc-300" style={{ top: yMid }} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
