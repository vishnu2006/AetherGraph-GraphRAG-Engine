"use client";

import { useCallback, useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type LeaderboardEntry = {
  rank: number;
  user_id: string;
  username: string;
  xp: number;
  level: number;
  streak_days: number;
  xp_in_level: number;
};

type UserStats = {
  id: string;
  username: string;
  xp: number;
  level: number;
  streak_days: number;
  xp_in_level: number;
  xp_to_next_level: number;
  last_active: string | null;
};

type GamificationWidgetProps = {
  apiBase: string;
  /** Increment this key from the parent to force a data refresh after XP is awarded. */
  refreshKey?: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";

const LEVEL_TITLES: Record<number, string> = {
  1: "Apprentice",
  2: "Initiate",
  3: "Scholar",
  4: "Analyst",
  5: "Architect",
  6: "Sage",
  7: "Oracle",
  8: "Luminary",
  9: "Virtuoso",
  10: "Grandmaster",
};

function getLevelTitle(level: number): string {
  return LEVEL_TITLES[Math.min(level, 10)] ?? `Level ${level}`;
}

const RANK_COLORS: Record<number, string> = {
  1: "text-amber-400",
  2: "text-zinc-300",
  3: "text-amber-600",
};

const RANK_GLOWS: Record<number, string> = {
  1: "rgba(251,191,36,0.9)",
  2: "rgba(212,212,216,0.9)",
  3: "rgba(180,83,9,0.9)",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function GamificationWidget({
  apiBase,
  refreshKey = 0,
}: GamificationWidgetProps) {
  const [me, setMe] = useState<UserStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBoard, setShowBoard] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [userRes, boardRes] = await Promise.all([
        fetch(`${apiBase}/api/users/me`),
        fetch(`${apiBase}/api/leaderboard?limit=5`),
      ]);
      if (userRes.ok) setMe(await userRes.json());
      if (boardRes.ok) setLeaderboard(await boardRes.json());
    } catch {
      // Backend not running — silent fail in dev
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll, refreshKey]);

  const progressPct = me ? Math.round((me.xp_in_level / 1000) * 100) : 0;
  const myRank = me ? leaderboard.findIndex((u) => u.user_id === me.id) + 1 : 0;

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-2.5 animate-pulse">
        <div className="h-9 rounded-xl bg-white/4" />
        <div className="h-1.5 rounded-full bg-white/4" />
        <div className="h-3 w-24 rounded bg-white/4" />
      </div>
    );
  }

  // ── Empty state — user not yet created (no workspace activity) ─────────────
  if (!me) {
    return (
      <div className="text-center py-3">
        <p className="text-xs text-white/20">Complete an exam to earn XP</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Level badge + streak ───────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        {/* Level badge */}
        <div
          className="w-10 h-10 flex-shrink-0 rounded-xl flex flex-col items-center justify-center"
          style={{
            background:
              "linear-gradient(135deg,rgba(251,191,36,0.15),rgba(234,88,12,0.15))",
            border: "1px solid rgba(251,191,36,0.25)",
            boxShadow: "0 0 12px rgba(251,191,36,0.08)",
          }}
        >
          <span className="text-sm font-black text-amber-300 leading-none">
            {me.level}
          </span>
          <span className="text-[8px] text-amber-400/50 leading-none mt-0.5">
            LVL
          </span>
        </div>

        {/* Title + XP numbers */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white/75 truncate">
              {getLevelTitle(me.level)}
            </span>
            {/* Streak */}
            {me.streak_days > 0 && (
              <div className="flex items-center gap-0.5 flex-shrink-0 ml-2">
                <span className="text-xs leading-none">🔥</span>
                <span className="text-[10px] font-bold text-orange-400 tabular-nums">
                  {me.streak_days}
                </span>
              </div>
            )}
          </div>
          <div className="text-[10px] text-white/25 tabular-nums mt-0.5">
            {me.xp.toLocaleString()} XP total
          </div>
        </div>
      </div>

      {/* ── XP progress bar ────────────────────────────────────────────────── */}
      <div>
        <div className="relative h-1.5 rounded-full bg-white/5 overflow-hidden">
          {/* Glow layer */}
          <div
            className="absolute inset-y-0 left-0 rounded-full blur-[2px] opacity-50
                       bg-gradient-to-r from-amber-500 to-orange-500
                       transition-all duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
          />
          {/* Solid layer */}
          <div
            className="absolute inset-y-0 left-0 rounded-full
                       bg-gradient-to-r from-amber-500 to-orange-500
                       transition-all duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5 text-[9px] text-white/20 tabular-nums">
          <span>{me.xp_in_level} / 1 000</span>
          <span>{me.xp_to_next_level} to next</span>
        </div>
      </div>

      {/* ── Leaderboard toggle ─────────────────────────────────────────────── */}
      {leaderboard.length > 0 && (
        <>
          <button
            onClick={() => setShowBoard((x) => !x)}
            className="w-full flex items-center justify-between py-0.5 transition-colors"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-white/25 uppercase tracking-widest font-semibold">
                Leaderboard
              </span>
              {myRank > 0 && (
                <span className="text-[9px] text-amber-400/60 font-mono">
                  #{myRank}
                </span>
              )}
            </div>
            <svg
              className={`w-3 h-3 text-white/20 transition-transform duration-200 ${
                showBoard ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {showBoard && (
            <div className="space-y-1">
              {leaderboard.map((entry) => {
                const isMe = me ? entry.user_id === me.id : false;
                const rankColor = RANK_COLORS[entry.rank] ?? "text-white/18";
                const rankGlow = RANK_GLOWS[entry.rank];
                const entryPct = Math.round((entry.xp_in_level / 1000) * 100);

                return (
                  <div
                    key={entry.user_id}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-xl
                               transition-all duration-150 ${
                                 isMe
                                   ? "bg-blue-900/50 border border-blue-400"
                                   : "border border-transparent"
                               }`}
                    style={
                      isMe
                        ? {} // Removed inline background to let tailwind take over
                        : { background: "rgba(255,255,255,0.02)" }
                    }
                  >
                    {/* Rank */}
                    <span
                      className={`text-[11px] font-black w-4 text-center flex-shrink-0 ${rankColor}`}
                      style={
                        rankGlow
                          ? { textShadow: `0 0 6px ${rankGlow}` }
                          : undefined
                      }
                    >
                      {entry.rank}
                    </span>

                    {/* Username + mini bar */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={`text-xs truncate font-medium ${
                            isMe ? "text-amber-300/80" : "text-white/45"
                          }`}
                        >
                          {isMe ? "You" : entry.username}
                        </span>
                        <span className="text-[9px] font-mono text-white/25 tabular-nums flex-shrink-0">
                          Lv.{entry.level}
                        </span>
                      </div>
                      {/* Mini progress bar */}
                      <div className="mt-1 h-0.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500
                                     transition-all duration-500"
                          style={{ width: `${entryPct}%` }}
                        />
                      </div>
                    </div>

                    {/* XP */}
                    <span className="text-[10px] font-bold tabular-nums text-white/35 flex-shrink-0">
                      {entry.xp.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
