"use client";

import { useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Difficulty = "easy" | "medium" | "hard";

type ExamQuestion = {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
};

type Exam = {
  exam_id: string;
  title: string;
  topic: string;
  questions: ExamQuestion[];
  difficulty: string;
  num_questions: number;
};

type XPResult = {
  xp_earned: number;
  new_xp: number;
  new_level: number;
  leveled_up: boolean;
  streak_days: number;
};

// Discriminated union for the exam state machine:
//   setup → generating → taking → reviewing → complete
type ExamState =
  | { phase: "setup" }
  | { phase: "generating" }
  | { phase: "error"; message: string }
  | { phase: "taking"; exam: Exam; currentQ: number; answers: (number | null)[] }
  | { phase: "reviewing"; exam: Exam; answers: (number | null)[] }
  | { phase: "awarding" }
  | { phase: "complete"; xpResult: XPResult; score: number; total: number };

type MockExamProps = {
  workspaceId: string | null;
  apiBase: string;
  onClose: () => void;
  /** Called after XP is successfully recorded so the parent can refresh stats. */
  onXPAwarded: (xpEarned: number, newLevel: number) => void;
};

// ─── XP constants ─────────────────────────────────────────────────────────────

const BASE_COMPLETION_XP = 100;
const PER_CORRECT_XP = 50;
const PERFECT_SCORE_BONUS = 200;
const OPTION_LETTERS = ["A", "B", "C", "D"];
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcXP(questions: ExamQuestion[], answers: (number | null)[]): number {
  let xp = BASE_COMPLETION_XP;
  let correct = 0;
  questions.forEach((q, i) => {
    if (answers[i] === q.correct_index) {
      xp += PER_CORRECT_XP;
      correct++;
    }
  });
  if (correct === questions.length && questions.length > 0) xp += PERFECT_SCORE_BONUS;
  return xp;
}

function calcScore(questions: ExamQuestion[], answers: (number | null)[]) {
  const correct = questions.filter((q, i) => answers[i] === q.correct_index).length;
  return { correct, total: questions.length, pct: Math.round((correct / questions.length) * 100) };
}

function scoreLabel(pct: number): { text: string; color: string } {
  if (pct === 100) return { text: "Perfect Score!", color: "text-amber-400" };
  if (pct >= 80) return { text: "Excellent", color: "text-emerald-400" };
  if (pct >= 60) return { text: "Good Work", color: "text-cyan-400" };
  if (pct >= 40) return { text: "Keep Practicing", color: "text-violet-400" };
  return { text: "Review Required", color: "text-rose-400" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      {children}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MockExam({ workspaceId, apiBase, onClose, onXPAwarded }: MockExamProps) {
  const [state, setState] = useState<ExamState>({ phase: "setup" });

  // ── Setup form state ───────────────────────────────────────────────────────
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [numQuestions, setNumQuestions] = useState(5);

  // ── Generate exam ──────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!workspaceId) {
      setState({ phase: "error", message: "Select a workspace before generating an exam." });
      return;
    }
    setState({ phase: "generating" });
    try {
      const res = await fetch(`${apiBase}/api/generate-exam`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          topic: topic.trim() || null,
          num_questions: numQuestions,
          difficulty,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const exam: Exam = await res.json();
      if (!exam.questions?.length) throw new Error("Gemini returned an empty exam.");
      setState({
        phase: "taking",
        exam,
        currentQ: 0,
        answers: new Array(exam.questions.length).fill(null),
      });
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Exam generation failed.",
      });
    }
  }, [apiBase, workspaceId, topic, difficulty, numQuestions]);

  // ── Answer selection ───────────────────────────────────────────────────────
  const handleSelectAnswer = useCallback((optionIdx: number) => {
    setState((prev) => {
      if (prev.phase !== "taking") return prev;
      const updated = [...prev.answers];
      updated[prev.currentQ] = optionIdx;
      return { ...prev, answers: updated };
    });
  }, []);

  const handleNext = useCallback(() => {
    setState((prev) => {
      if (prev.phase !== "taking") return prev;
      if (prev.currentQ < prev.exam.questions.length - 1) {
        return { ...prev, currentQ: prev.currentQ + 1 };
      }
      return { phase: "reviewing", exam: prev.exam, answers: prev.answers };
    });
  }, []);

  // ── Claim XP ───────────────────────────────────────────────────────────────
  const handleClaimXP = useCallback(async () => {
    if (state.phase !== "reviewing") return;
    const { exam, answers } = state;
    const xpEarned = calcXP(exam.questions, answers);
    const { correct, total } = calcScore(exam.questions, answers);
    setState({ phase: "awarding" });

    try {
      const res = await fetch(`${apiBase}/api/award-xp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: DEFAULT_USER_ID,
          xp_amount: xpEarned,
          reason: "exam_completion",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onXPAwarded(xpEarned, data.new_level);
        setState({
          phase: "complete",
          xpResult: {
            xp_earned: xpEarned,
            new_xp: data.new_xp,
            new_level: data.new_level,
            leveled_up: data.leveled_up,
            streak_days: data.streak_days,
          },
          score: correct,
          total,
        });
      } else {
        throw new Error("Award XP API error");
      }
    } catch {
      // Even if the API fails, show completion screen with local XP estimate
      onXPAwarded(xpEarned, 1);
      setState({
        phase: "complete",
        xpResult: { xp_earned: xpEarned, new_xp: xpEarned, new_level: 1, leveled_up: false, streak_days: 1 },
        score: correct,
        total,
      });
    }
  }, [state, apiBase, onXPAwarded]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(24px)" }}
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl overflow-hidden"
        style={{
          background: "rgba(8,8,8,0.98)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      >
        {/* ── PHASE: setup ────────────────────────────────────────────────── */}
        {state.phase === "setup" && (
          <>
            {/* Header */}
            <div
              className="flex items-center justify-between px-6 py-5 flex-shrink-0"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: "linear-gradient(135deg,rgba(139,92,246,0.25),rgba(6,182,212,0.25))",
                    border: "1px solid rgba(139,92,246,0.3)",
                  }}
                >
                  <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-bold text-white/85">Mock Exam Generator</h2>
                  <p className="text-xs text-white/30">AI-powered quiz from your knowledge graph</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-white/25 hover:text-white/60 hover:bg-white/5 transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Form */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
              {/* Topic */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider">
                  Topic Focus
                  <span className="ml-1.5 font-normal text-white/20 normal-case tracking-normal">
                    (optional — leave blank for a general exam)
                  </span>
                </label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. Neural networks, JavaScript closures, French Revolution…"
                  className="w-full bg-white/4 border border-white/8 focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/18 focus:outline-none transition-all"
                />
              </div>

              {/* Difficulty */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider">
                  Difficulty
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {(["easy", "medium", "hard"] as Difficulty[]).map((d) => {
                    const active = difficulty === d;
                    const meta = {
                      easy: { label: "Easy", desc: "Core recall", color: "emerald" },
                      medium: { label: "Medium", desc: "Comprehension", color: "violet" },
                      hard: { label: "Hard", desc: "Application", color: "rose" },
                    }[d];
                    return (
                      <button
                        key={d}
                        onClick={() => setDifficulty(d)}
                        className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border transition-all ${
                          active
                            ? d === "easy"
                              ? "bg-emerald-500/12 border-emerald-500/35 shadow-[0_0_16px_rgba(16,185,129,0.08)]"
                              : d === "medium"
                              ? "bg-violet-500/12 border-violet-500/35 shadow-[0_0_16px_rgba(139,92,246,0.08)]"
                              : "bg-rose-500/12 border-rose-500/35 shadow-[0_0_16px_rgba(244,63,94,0.08)]"
                            : "bg-white/[0.02] border-white/7 hover:border-white/15 hover:bg-white/4"
                        }`}
                      >
                        <span
                          className={`text-sm font-bold ${
                            active
                              ? d === "easy"
                                ? "text-emerald-400"
                                : d === "medium"
                                ? "text-violet-400"
                                : "text-rose-400"
                              : "text-white/40"
                          }`}
                        >
                          {meta.label}
                        </span>
                        <span className="text-[10px] text-white/20">{meta.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Number of questions */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider">
                  Questions
                </label>
                <div className="flex gap-2">
                  {[3, 5, 7, 10].map((n) => (
                    <button
                      key={n}
                      onClick={() => setNumQuestions(n)}
                      className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                        numQuestions === n
                          ? "bg-violet-500/15 border-violet-500/35 text-violet-300"
                          : "bg-white/[0.02] border-white/7 text-white/35 hover:border-white/15 hover:text-white/55"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* XP breakdown preview */}
              <GlassCard className="px-4 py-3">
                <p className="text-[10px] text-white/25 uppercase tracking-wider mb-2.5 font-semibold">
                  XP Breakdown
                </p>
                <div className="space-y-1.5">
                  {[
                    { label: "Completion bonus", xp: BASE_COMPLETION_XP },
                    { label: `Per correct answer (×${numQuestions})`, xp: `${PER_CORRECT_XP} each` },
                    { label: "Perfect score bonus", xp: PERFECT_SCORE_BONUS },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="text-xs text-white/35">{row.label}</span>
                      <span className="text-xs font-mono font-semibold text-amber-400/70">
                        +{row.xp}
                      </span>
                    </div>
                  ))}
                  <div
                    className="flex items-center justify-between pt-2 mt-1"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <span className="text-xs font-semibold text-white/50">Max possible</span>
                    <span className="text-sm font-bold text-amber-400">
                      +{BASE_COMPLETION_XP + numQuestions * PER_CORRECT_XP + PERFECT_SCORE_BONUS}
                    </span>
                  </div>
                </div>
              </GlassCard>
            </div>

            {/* Footer */}
            <div
              className="px-6 py-4 flex-shrink-0"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <button
                onClick={handleGenerate}
                disabled={!workspaceId}
                className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: workspaceId
                    ? "linear-gradient(135deg,#7c3aed,#0891b2)"
                    : "rgba(255,255,255,0.05)",
                  boxShadow: workspaceId
                    ? "0 0 24px rgba(124,58,237,0.3)"
                    : "none",
                }}
              >
                Generate Exam →
              </button>
              {!workspaceId && (
                <p className="text-xs text-rose-400/70 text-center mt-2">
                  Select a workspace first
                </p>
              )}
            </div>
          </>
        )}

        {/* ── PHASE: error ─────────────────────────────────────────────────── */}
        {state.phase === "error" && (
          <div className="flex flex-col items-center justify-center flex-1 px-8 py-12 text-center gap-4">
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
              <p className="text-xs text-white/30 leading-relaxed max-w-xs">{state.message}</p>
            </div>
            <button
              onClick={() => setState({ phase: "setup" })}
              className="px-5 py-2 rounded-xl text-sm font-semibold text-white/70 border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all"
            >
              Try again
            </button>
          </div>
        )}

        {/* ── PHASE: generating ────────────────────────────────────────────── */}
        {state.phase === "generating" && (
          <div className="flex flex-col items-center justify-center flex-1 px-8 py-16 gap-6">
            <div className="relative">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg,rgba(139,92,246,0.2),rgba(6,182,212,0.2))",
                  border: "1px solid rgba(139,92,246,0.3)",
                }}
              >
                <svg className="w-8 h-8 text-violet-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              {/* Spinning ring */}
              <div className="absolute -inset-2 rounded-3xl border-2 border-violet-500/20 animate-spin"
                style={{ animationDuration: "3s", borderTopColor: "rgba(139,92,246,0.6)" }} />
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-sm font-semibold text-white/70">Gemini is crafting your exam…</p>
              <p className="text-xs text-white/25">
                Retrieving context via pgvector · Generating structured questions
              </p>
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-violet-500/50 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── PHASE: taking ─────────────────────────────────────────────────── */}
        {state.phase === "taking" && (() => {
          const { exam, currentQ, answers } = state;
          const q = exam.questions[currentQ];
          const selectedAnswer = answers[currentQ];
          const isLast = currentQ === exam.questions.length - 1;
          const progressPct = Math.round(((currentQ) / exam.questions.length) * 100);

          return (
            <>
              {/* Header */}
              <div
                className="flex-shrink-0 px-6 py-4"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-mono text-white/30">
                      Q{currentQ + 1}/{exam.questions.length}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-md border font-medium uppercase tracking-wide ${
                        exam.difficulty === "easy"
                          ? "text-emerald-400/70 border-emerald-500/20 bg-emerald-500/8"
                          : exam.difficulty === "hard"
                          ? "text-rose-400/70 border-rose-500/20 bg-rose-500/8"
                          : "text-violet-400/70 border-violet-500/20 bg-violet-500/8"
                      }`}
                    >
                      {exam.difficulty}
                    </span>
                  </div>
                  <button
                    onClick={onClose}
                    className="text-xs text-white/20 hover:text-white/50 transition-colors"
                  >
                    Quit
                  </button>
                </div>
                {/* Progress track */}
                <div className="relative h-1 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-500 to-cyan-500 transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* Question + options */}
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
                <div>
                  <p className="text-[10px] text-white/25 uppercase tracking-wider mb-3 font-semibold">
                    Question {currentQ + 1}
                  </p>
                  <h3 className="text-base font-semibold text-white/85 leading-relaxed">
                    {q.question}
                  </h3>
                </div>

                <div className="space-y-2.5">
                  {q.options.map((option, optIdx) => {
                    const isSelected = selectedAnswer === optIdx;
                    return (
                      <button
                        key={optIdx}
                        onClick={() => handleSelectAnswer(optIdx)}
                        className={`w-full flex items-start gap-3 px-4 py-3.5 rounded-xl border text-left transition-all duration-150 ${
                          isSelected
                            ? "border-violet-500/50 shadow-[0_0_20px_rgba(139,92,246,0.1)]"
                            : "border-white/6 hover:border-white/15 hover:bg-white/[0.03]"
                        }`}
                        style={
                          isSelected
                            ? { background: "rgba(139,92,246,0.12)" }
                            : { background: "rgba(255,255,255,0.02)" }
                        }
                      >
                        <span
                          className={`w-6 h-6 flex-shrink-0 rounded-lg flex items-center justify-center text-[11px] font-bold transition-all ${
                            isSelected
                              ? "bg-violet-500/30 text-violet-300 border border-violet-500/50"
                              : "bg-white/5 text-white/30 border border-white/8"
                          }`}
                        >
                          {OPTION_LETTERS[optIdx]}
                        </span>
                        <span className={`text-sm leading-relaxed pt-0.5 ${isSelected ? "text-white/85" : "text-white/50"}`}>
                          {option}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Footer */}
              <div
                className="px-6 py-4 flex-shrink-0"
                style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
              >
                <button
                  onClick={handleNext}
                  disabled={selectedAnswer === null}
                  className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-25 disabled:cursor-not-allowed"
                  style={
                    selectedAnswer !== null
                      ? {
                          background: "linear-gradient(135deg,#7c3aed,#0891b2)",
                          boxShadow: "0 0 20px rgba(124,58,237,0.25)",
                        }
                      : { background: "rgba(255,255,255,0.05)" }
                  }
                >
                  {isLast ? "Submit Exam →" : "Next Question →"}
                </button>
              </div>
            </>
          );
        })()}

        {/* ── PHASE: reviewing ──────────────────────────────────────────────── */}
        {state.phase === "reviewing" && (() => {
          const { exam, answers } = state;
          const { correct, total, pct } = calcScore(exam.questions, answers);
          const xpToEarn = calcXP(exam.questions, answers);
          const { text: verdict, color: verdictColor } = scoreLabel(pct);

          return (
            <>
              {/* Header */}
              <div
                className="flex-shrink-0 px-6 py-5"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-white/25 uppercase tracking-wider mb-1 font-semibold">
                      Exam Results
                    </p>
                    <h2 className="text-sm font-bold text-white/80 truncate">{exam.title}</h2>
                  </div>
                  <div className="text-right">
                    <div className="flex items-end gap-1">
                      <span className="text-3xl font-black tabular-nums text-white">{correct}</span>
                      <span className="text-sm text-white/30 mb-1">/ {total}</span>
                    </div>
                    <span className={`text-xs font-semibold ${verdictColor}`}>{verdict}</span>
                  </div>
                </div>

                {/* Score bar */}
                <div className="mt-3 relative h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${
                      pct >= 80 ? "bg-gradient-to-r from-emerald-500 to-cyan-500" :
                      pct >= 60 ? "bg-gradient-to-r from-violet-500 to-cyan-500" :
                      "bg-gradient-to-r from-rose-500 to-orange-500"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              {/* Questions review */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {exam.questions.map((q, qi) => {
                  const userAnswer = answers[qi];
                  const isCorrect = userAnswer === q.correct_index;
                  const isAnswered = userAnswer !== null;

                  return (
                    <GlassCard key={qi} className="p-4">
                      {/* Question header */}
                      <div className="flex items-start gap-2.5 mb-3">
                        <div
                          className={`w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center mt-0.5 ${
                            isCorrect ? "bg-emerald-500/20" : "bg-rose-500/20"
                          }`}
                        >
                          {isCorrect ? (
                            <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          )}
                        </div>
                        <p className="text-sm text-white/75 leading-relaxed font-medium">{q.question}</p>
                      </div>

                      {/* Options */}
                      <div className="space-y-1.5 ml-8">
                        {q.options.map((opt, oi) => {
                          const isUserChoice = userAnswer === oi;
                          const isRightAnswer = q.correct_index === oi;

                          let optStyle = "bg-white/[0.02] border-white/6 text-white/30";
                          if (isRightAnswer) optStyle = "bg-emerald-500/8 border-emerald-500/25 text-emerald-300/80";
                          if (isUserChoice && !isRightAnswer) optStyle = "bg-rose-500/8 border-rose-500/25 text-rose-300/80";

                          return (
                            <div key={oi} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${optStyle}`}>
                              <span className="text-[10px] font-bold opacity-60 w-4 text-center flex-shrink-0">
                                {OPTION_LETTERS[oi]}
                              </span>
                              <span className="text-xs leading-relaxed flex-1">{opt}</span>
                              {isRightAnswer && (
                                <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                              {isUserChoice && !isRightAnswer && (
                                <svg className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Explanation */}
                      <div
                        className="mt-3 ml-8 px-3 py-2.5 rounded-lg"
                        style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}
                      >
                        <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1 font-semibold">
                          Explanation
                        </p>
                        <p className="text-xs text-white/50 leading-relaxed">{q.explanation}</p>
                      </div>
                    </GlassCard>
                  );
                })}
              </div>

              {/* Footer — XP claim */}
              <div
                className="px-6 py-4 flex-shrink-0"
                style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-white/35">XP to claim</span>
                  <span className="text-lg font-black text-amber-400">+{xpToEarn}</span>
                </div>
                <button
                  onClick={handleClaimXP}
                  className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all"
                  style={{
                    background: "linear-gradient(135deg,#d97706,#b45309)",
                    boxShadow: "0 0 24px rgba(217,119,6,0.3)",
                  }}
                >
                  Claim {xpToEarn} XP →
                </button>
              </div>
            </>
          );
        })()}

        {/* ── PHASE: awarding ───────────────────────────────────────────────── */}
        {state.phase === "awarding" && (
          <div className="flex flex-col items-center justify-center flex-1 px-8 py-16 gap-5">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center animate-pulse"
              style={{
                background: "linear-gradient(135deg,rgba(217,119,6,0.2),rgba(180,83,9,0.2))",
                border: "1px solid rgba(217,119,6,0.3)",
              }}>
              <span className="text-2xl">⚡</span>
            </div>
            <p className="text-sm text-white/50">Recording XP…</p>
          </div>
        )}

        {/* ── PHASE: complete ───────────────────────────────────────────────── */}
        {state.phase === "complete" && (() => {
          const { xpResult, score, total } = state;
          const pct = Math.round((score / total) * 100);
          const { text: verdict, color: verdictColor } = scoreLabel(pct);

          return (
            <div className="flex flex-col items-center justify-center flex-1 px-8 py-10 gap-6 text-center">
              {/* Trophy */}
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg,rgba(251,191,36,0.18),rgba(217,119,6,0.18))",
                  border: "1px solid rgba(251,191,36,0.25)",
                  boxShadow: "0 0 40px rgba(251,191,36,0.12)",
                }}
              >
                <span className="text-4xl">{pct === 100 ? "🏆" : pct >= 80 ? "🎯" : pct >= 60 ? "📚" : "💡"}</span>
              </div>

              <div>
                <p className={`text-xl font-black mb-1 ${verdictColor}`}>{verdict}</p>
                <p className="text-sm text-white/35">
                  {score} / {total} correct · {pct}%
                </p>
              </div>

              {/* XP awarded */}
              <div
                className="w-full rounded-2xl px-6 py-5"
                style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)" }}
              >
                <p className="text-[10px] text-amber-400/50 uppercase tracking-widest mb-2 font-semibold">
                  XP Awarded
                </p>
                <p className="text-4xl font-black text-amber-400 tabular-nums">
                  +{xpResult.xp_earned}
                </p>
                <p className="text-xs text-white/25 mt-1.5">
                  Total: {xpResult.new_xp.toLocaleString()} XP · Level {xpResult.new_level}
                </p>
              </div>

              {/* Level-up notification */}
              {xpResult.leveled_up && (
                <div
                  className="w-full rounded-xl px-4 py-3 flex items-center gap-3"
                  style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)" }}
                >
                  <span className="text-xl flex-shrink-0">🚀</span>
                  <div className="text-left">
                    <p className="text-sm font-bold text-violet-300">Level Up!</p>
                    <p className="text-xs text-violet-400/60">
                      You reached Level {xpResult.new_level}
                    </p>
                  </div>
                </div>
              )}

              {/* Streak */}
              {xpResult.streak_days > 1 && (
                <p className="text-sm text-orange-400/70">
                  🔥 {xpResult.streak_days}-day streak! Keep it up.
                </p>
              )}

              <button
                onClick={onClose}
                className="mt-2 px-8 py-3 rounded-xl text-sm font-bold text-white transition-all"
                style={{
                  background: "linear-gradient(135deg,#7c3aed,#0891b2)",
                  boxShadow: "0 0 24px rgba(124,58,237,0.25)",
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
