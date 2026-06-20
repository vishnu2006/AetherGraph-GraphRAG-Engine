"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Card = {
  id: string;
  front_text: string;
  back_text: string;
};

type CardResult = "mastered" | "review" | null;

type DeckPhase =
  | { name: "loading" }
  | { name: "error"; message: string }
  | {
      name: "studying";
      cards: Card[];
      idx: number;
      flipped: boolean;
      results: CardResult[];
    }
  | { name: "awarding" }
  | {
      name: "complete";
      xpEarned: number;
      masteredCount: number;
      total: number;
      leveledUp: boolean;
      newLevel: number;
    };

type FlashcardDeckProps = {
  nodeId: string;
  nodeLabel: string;
  apiBase: string;
  onClose: () => void;
  onXPAwarded: (xp: number) => void;
};

// ─── XP constants ─────────────────────────────────────────────────────────────

const BASE_XP = 50;
const PER_MASTERED_XP = 20;
const ALL_MASTERED_BONUS = 100;
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";

function calcXP(mastered: number, total: number): number {
  return BASE_XP + mastered * PER_MASTERED_XP + (mastered === total ? ALL_MASTERED_BONUS : 0);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FlashcardDeck({
  nodeId,
  nodeLabel,
  apiBase,
  onClose,
  onXPAwarded,
}: FlashcardDeckProps) {
  const [phase, setPhase] = useState<DeckPhase>({ name: "loading" });
  // Track whether the card flip animation is mid-spin to prevent rapid double-clicks
  const flippingRef = useRef(false);

  // ── Fetch flashcards on mount ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/nodes/${nodeId}/flashcards`, {
          method: "POST",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: "Unknown error" }));
          throw new Error(err.detail ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled) {
          const cards: Card[] = data.cards ?? [];
          if (cards.length === 0) throw new Error("No flashcards were generated for this node.");
          setPhase({
            name: "studying",
            cards,
            idx: 0,
            flipped: false,
            results: new Array(cards.length).fill(null),
          });
        }
      } catch (err) {
        if (!cancelled)
          setPhase({
            name: "error",
            message: err instanceof Error ? err.message : "Generation failed.",
          });
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, nodeId]);

  // ── Flip handler ──────────────────────────────────────────────────────────
  const handleFlip = useCallback(() => {
    if (flippingRef.current) return;
    flippingRef.current = true;
    setTimeout(() => { flippingRef.current = false; }, 600);

    setPhase((prev) => {
      if (prev.name !== "studying") return prev;
      return { ...prev, flipped: !prev.flipped };
    });
  }, []);

  // ── Result (mastered / review) ────────────────────────────────────────────
  const handleResult = useCallback(
    (result: "mastered" | "review") => {
      setPhase((prev) => {
        if (prev.name !== "studying") return prev;
        const updated = [...prev.results];
        updated[prev.idx] = result;
        const nextIdx = prev.idx + 1;
        if (nextIdx >= prev.cards.length) {
          // All cards answered — move to award phase
          return { name: "awarding" };
        }
        return { ...prev, idx: nextIdx, flipped: false, results: updated };
      });

      // After setting awarding, trigger the XP call
      setPhase((prev) => {
        if (prev.name !== "awarding") return prev;
        return prev; // actual XP call handled by the useEffect below
      });
    },
    []
  );

  // ── Award XP when entering "awarding" phase ───────────────────────────────
  // We keep a ref to the last results array so we can read it from the effect
  const lastCardsRef = useRef<Card[]>([]);
  const lastResultsRef = useRef<CardResult[]>([]);

  // Update refs whenever studying state changes
  useEffect(() => {
    if (phase.name === "studying") {
      lastCardsRef.current = phase.cards;
      lastResultsRef.current = phase.results;
    }
  }, [phase]);

  useEffect(() => {
    if (phase.name !== "awarding") return;
    const cards = lastCardsRef.current;
    const results = lastResultsRef.current;
    const masteredCount = results.filter((r) => r === "mastered").length;
    const total = cards.length;
    const xpEarned = calcXP(masteredCount, total);

    (async () => {
      let newLevel = 1;
      let leveledUp = false;
      try {
        const res = await fetch(`${apiBase}/api/award-xp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: DEFAULT_USER_ID,
            xp_amount: xpEarned,
            reason: "flashcard_completion",
          }),
        });
        if (res.ok) {
          const data = await res.json();
          newLevel = data.new_level;
          leveledUp = data.leveled_up;
        }
      } catch {
        // Backend unreachable — complete anyway
      }
      onXPAwarded(xpEarned);
      setPhase({ name: "complete", xpEarned, masteredCount, total, leveledUp, newLevel });
    })();
  }, [phase.name, apiBase, onXPAwarded]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phase.name !== "studying") return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); handleFlip(); }
      if (e.key === "ArrowRight" || e.key === "1") handleResult("mastered");
      if (e.key === "ArrowLeft" || e.key === "2") handleResult("review");
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase.name, handleFlip, handleResult, onClose]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.9)", backdropFilter: "blur(28px)" }}
    >
      <div
        className="w-full max-w-xl flex flex-col rounded-2xl overflow-hidden"
        style={{
          background: "rgba(8,8,8,0.98)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 40px 100px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      >
        {/* ── PHASE: loading ──────────────────────────────────────────────── */}
        {phase.name === "loading" && (
          <div className="flex flex-col items-center justify-center py-20 gap-5">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center animate-pulse"
              style={{
                background: "linear-gradient(135deg,rgba(6,182,212,0.18),rgba(139,92,246,0.18))",
                border: "1px solid rgba(6,182,212,0.25)",
              }}
            >
              <svg className="w-7 h-7 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-white/60 mb-1">
                Gemini is generating flashcards…
              </p>
              <p className="text-xs text-white/25 truncate max-w-xs px-4">{nodeLabel}</p>
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-cyan-500/40 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── PHASE: error ────────────────────────────────────────────────── */}
        {phase.name === "error" && (
          <div className="flex flex-col items-center justify-center py-16 px-8 gap-4 text-center">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.2)" }}
            >
              <svg className="w-6 h-6 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-rose-400 mb-1">Generation Failed</p>
              <p className="text-xs text-white/30 leading-relaxed max-w-xs">{phase.message}</p>
            </div>
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-xl text-sm font-semibold text-white/60 border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all"
            >
              Close
            </button>
          </div>
        )}

        {/* ── PHASE: studying ─────────────────────────────────────────────── */}
        {phase.name === "studying" && (() => {
          const { cards, idx, flipped, results } = phase;
          const card = cards[idx];
          const answeredCount = results.filter(Boolean).length;
          const progressPct = Math.round((answeredCount / cards.length) * 100);

          return (
            <>
              {/* Header */}
              <div
                className="flex items-center justify-between px-5 py-4 flex-shrink-0"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{
                      background: "linear-gradient(135deg,rgba(6,182,212,0.18),rgba(139,92,246,0.18))",
                      border: "1px solid rgba(6,182,212,0.25)",
                    }}
                  >
                    <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white/70 truncate max-w-[200px]">
                      {nodeLabel}
                    </p>
                    <p className="text-[10px] text-white/25 tabular-nums">
                      {idx + 1} / {cards.length}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-white/25 hover:text-white/55 hover:bg-white/5 transition-all"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Progress bar */}
              <div className="relative h-0.5 bg-white/5">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500 to-violet-500 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {/* ── 3D Flip Card ────────────────────────────────────────────── */}
              <div className="px-6 py-7">
                {/* Perspective wrapper */}
                <div style={{ perspective: "1200px" }}>
                  <div
                    onClick={handleFlip}
                    style={{
                      transformStyle: "preserve-3d",
                      transition: "transform 0.55s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                      transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
                      position: "relative",
                      height: "240px",
                      cursor: "pointer",
                    }}
                  >
                    {/* Front face */}
                    <div
                      style={{
                        backfaceVisibility: "hidden",
                        WebkitBackfaceVisibility: "hidden",
                        position: "absolute",
                        inset: 0,
                        background: "rgba(255,255,255,0.025)",
                        border: "1px solid rgba(6,182,212,0.2)",
                        borderRadius: "16px",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "24px",
                        boxShadow: "0 0 32px rgba(6,182,212,0.06), inset 0 1px 0 rgba(255,255,255,0.04)",
                      }}
                    >
                      <p
                        className="text-[9px] font-semibold uppercase tracking-widest mb-4"
                        style={{ color: "rgba(6,182,212,0.5)" }}
                      >
                        Question
                      </p>
                      <p className="text-base font-semibold text-white/80 text-center leading-relaxed">
                        {card.front_text}
                      </p>
                      <p className="text-[10px] text-white/18 mt-6 select-none">
                        Click to reveal · Space/Enter
                      </p>
                    </div>

                    {/* Back face */}
                    <div
                      style={{
                        backfaceVisibility: "hidden",
                        WebkitBackfaceVisibility: "hidden",
                        transform: "rotateY(180deg)",
                        position: "absolute",
                        inset: 0,
                        background: "rgba(255,255,255,0.025)",
                        border: "1px solid rgba(139,92,246,0.25)",
                        borderRadius: "16px",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "24px",
                        boxShadow: "0 0 32px rgba(139,92,246,0.07), inset 0 1px 0 rgba(255,255,255,0.04)",
                      }}
                    >
                      <p
                        className="text-[9px] font-semibold uppercase tracking-widest mb-4"
                        style={{ color: "rgba(139,92,246,0.6)" }}
                      >
                        Answer
                      </p>
                      <p className="text-sm text-white/75 text-center leading-relaxed">
                        {card.back_text}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Flip hint dots */}
                <div className="flex justify-center gap-1.5 mt-5">
                  {cards.map((_, ci) => {
                    const r = results[ci];
                    return (
                      <div
                        key={ci}
                        className="w-1.5 h-1.5 rounded-full transition-all duration-300"
                        style={{
                          background:
                            ci === idx
                              ? "rgba(6,182,212,0.7)"
                              : r === "mastered"
                              ? "rgba(16,185,129,0.6)"
                              : r === "review"
                              ? "rgba(245,158,11,0.5)"
                              : "rgba(255,255,255,0.1)",
                          boxShadow:
                            ci === idx ? "0 0 6px rgba(6,182,212,0.6)" : "none",
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Action buttons — only visible after flip */}
              <div
                className="px-5 py-4 flex-shrink-0"
                style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
              >
                {flipped ? (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleResult("review")}
                      className="flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-semibold transition-all"
                      style={{
                        background: "rgba(245,158,11,0.08)",
                        border: "1px solid rgba(245,158,11,0.25)",
                        color: "rgba(252,211,77,0.85)",
                      }}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Review Later
                      <span className="text-[9px] opacity-40 font-mono">←</span>
                    </button>
                    <button
                      onClick={() => handleResult("mastered")}
                      className="flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-semibold transition-all"
                      style={{
                        background: "rgba(16,185,129,0.1)",
                        border: "1px solid rgba(16,185,129,0.3)",
                        color: "rgba(52,211,153,0.9)",
                      }}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                          d="M5 13l4 4L19 7" />
                      </svg>
                      Mastered
                      <span className="text-[9px] opacity-40 font-mono">→</span>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleFlip}
                    className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
                    style={{
                      background: "rgba(6,182,212,0.08)",
                      border: "1px solid rgba(6,182,212,0.2)",
                      color: "rgba(103,232,249,0.8)",
                    }}
                  >
                    Flip Card
                  </button>
                )}
              </div>

              {/* Keyboard shortcuts legend */}
              <div
                className="px-5 py-2 flex items-center justify-center gap-4"
                style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
              >
                {[
                  { key: "Space", label: "Flip" },
                  { key: "→ / 1", label: "Mastered" },
                  { key: "← / 2", label: "Review" },
                  { key: "Esc", label: "Close" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-1">
                    <kbd className="text-[9px] font-mono px-1 py-0.5 rounded bg-white/5 text-white/20 border border-white/8">
                      {key}
                    </kbd>
                    <span className="text-[9px] text-white/15">{label}</span>
                  </div>
                ))}
              </div>
            </>
          );
        })()}

        {/* ── PHASE: awarding ─────────────────────────────────────────────── */}
        {phase.name === "awarding" && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center animate-pulse"
              style={{
                background: "rgba(251,191,36,0.12)",
                border: "1px solid rgba(251,191,36,0.25)",
              }}
            >
              <span className="text-2xl">⚡</span>
            </div>
            <p className="text-sm text-white/45">Awarding XP…</p>
          </div>
        )}

        {/* ── PHASE: complete ──────────────────────────────────────────────── */}
        {phase.name === "complete" && (() => {
          const { xpEarned, masteredCount, total, leveledUp, newLevel } = phase;
          const masterPct = Math.round((masteredCount / total) * 100);

          return (
            <div className="flex flex-col items-center py-10 px-8 gap-5 text-center">
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg,rgba(6,182,212,0.15),rgba(139,92,246,0.15))",
                  border: "1px solid rgba(6,182,212,0.25)",
                  boxShadow: "0 0 40px rgba(6,182,212,0.08)",
                }}
              >
                <span className="text-4xl">
                  {masterPct === 100 ? "🎓" : masterPct >= 75 ? "📚" : "🔖"}
                </span>
              </div>

              <div>
                <p className="text-lg font-black text-white/85 mb-1">
                  Deck Complete!
                </p>
                <p className="text-sm text-white/35">
                  {masteredCount} / {total} mastered · {masterPct}%
                </p>
              </div>

              {/* Mastery bar */}
              <div className="w-full">
                <div className="relative h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-700"
                    style={{ width: `${masterPct}%` }}
                  />
                </div>
              </div>

              {/* XP earned */}
              <div
                className="w-full rounded-2xl px-5 py-4"
                style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)" }}
              >
                <p className="text-[10px] text-amber-400/50 uppercase tracking-widest mb-1.5 font-semibold">
                  XP Earned
                </p>
                <p className="text-3xl font-black text-amber-400 tabular-nums">+{xpEarned}</p>
                <div className="mt-2 space-y-0.5 text-left">
                  <div className="flex justify-between text-[10px] text-white/20">
                    <span>Completion</span><span className="font-mono">+{BASE_XP}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-white/20">
                    <span>Mastered ×{masteredCount}</span>
                    <span className="font-mono">+{masteredCount * PER_MASTERED_XP}</span>
                  </div>
                  {masteredCount === total && (
                    <div className="flex justify-between text-[10px] text-emerald-400/60">
                      <span>Perfect deck!</span>
                      <span className="font-mono">+{ALL_MASTERED_BONUS}</span>
                    </div>
                  )}
                </div>
              </div>

              {leveledUp && (
                <div
                  className="w-full rounded-xl px-4 py-3 flex items-center gap-3"
                  style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)" }}
                >
                  <span className="text-xl">🚀</span>
                  <div className="text-left">
                    <p className="text-sm font-bold text-violet-300">Level Up!</p>
                    <p className="text-xs text-violet-400/60">You reached Level {newLevel}</p>
                  </div>
                </div>
              )}

              <button
                onClick={onClose}
                className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all"
                style={{
                  background: "linear-gradient(135deg,#0891b2,#7c3aed)",
                  boxShadow: "0 0 24px rgba(6,182,212,0.2)",
                }}
              >
                Back to Graph
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
