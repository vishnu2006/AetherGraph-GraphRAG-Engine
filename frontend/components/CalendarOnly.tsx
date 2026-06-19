"use client";

import { useCallback, useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type CalendarEvent = {
  id: string;
  title: string;
  due_date: string | null;   // "YYYY-MM-DD"
  description: string | null;
  created_at: string;
};

type CalendarOnlyProps = {
  roomCode: string | null;
  apiBase: string;
  onClose: () => void;
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function today(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function formatDate(iso: string): string {
  const d = parseLocalDate(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type Group = "overdue" | "today" | "week" | "later" | "undated";

function groupEvent(event: CalendarEvent): Group {
  if (!event.due_date) return "undated";
  const t = today();
  const d = parseLocalDate(event.due_date);
  const diff = daysBetween(t, d);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 7) return "week";
  return "later";
}

const GROUP_META: Record<Group, { label: string; color: string; dot: string }> = {
  overdue: { label: "Overdue", color: "text-rose-400", dot: "bg-rose-500" },
  today:   { label: "Today",   color: "text-amber-400", dot: "bg-amber-500" },
  week:    { label: "This Week", color: "text-cyan-400", dot: "bg-cyan-500" },
  later:   { label: "Later",   color: "text-violet-400", dot: "bg-violet-500" },
  undated: { label: "No Date", color: "text-white/30",  dot: "bg-white/15" },
};

const GROUP_ORDER: Group[] = ["overdue", "today", "week", "later", "undated"];

// ─── Add-event form state ─────────────────────────────────────────────────────

type AddForm = {
  title: string;
  due_date: string;
  description: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function CalendarOnly({
  roomCode,
  apiBase,
  onClose,
}: CalendarOnlyProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AddForm>({ title: "", due_date: "", description: "" });
  const [saving, setSaving] = useState(false);

  // ── Fetch calendar events ──────────────────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    if (!roomCode) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/rooms/${roomCode}/calendar`);
      if (res.ok) setEvents(await res.json());
    } catch {
      // Backend not running — silent fail
    } finally {
      setLoading(false);
    }
  }, [apiBase, roomCode]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // ── Submit new event ───────────────────────────────────────────────────────
  const handleAddEvent = useCallback(async () => {
    if (!roomCode || !form.title.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/api/rooms/${roomCode}/calendar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          due_date: form.due_date || null,
          description: form.description.trim() || null,
        }),
      });
      if (res.ok) {
        const created: CalendarEvent = await res.json();
        setEvents((prev) => [...prev, created]);
        setForm({ title: "", due_date: "", description: "" });
        setShowAdd(false);
      }
    } finally {
      setSaving(false);
    }
  }, [apiBase, roomCode, form, saving]);

  // ── Group events ──────────────────────────────────────────────────────────
  const grouped = GROUP_ORDER.reduce<Record<Group, CalendarEvent[]>>(
    (acc, g) => ({ ...acc, [g]: [] }),
    {} as Record<Group, CalendarEvent[]>
  );
  events.forEach((e) => grouped[groupEvent(e)].push(e));

  // Sort each group by due_date ascending
  (["overdue", "today", "week", "later"] as Group[]).forEach((g) => {
    grouped[g].sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    });
  });

  const totalEvents = events.length;
  const overdueCount = grouped.overdue.length;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg,rgba(16,185,129,0.2),rgba(6,182,212,0.2))",
              border: "1px solid rgba(16,185,129,0.28)",
            }}
          >
            <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-white/75">Calendar</p>
            {overdueCount > 0 && (
              <p className="text-[9px] text-rose-400/70">
                {overdueCount} overdue
              </p>
            )}
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

      {/* ── Calendar Content ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* Add event button */}
        <div className="px-3 pt-3 pb-1.5">
          <button
            onClick={() => setShowAdd((x) => !x)}
            disabled={!roomCode}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all disabled:opacity-30"
            style={{
              background: showAdd ? "rgba(16,185,129,0.08)" : "rgba(255,255,255,0.02)",
              border: showAdd
                ? "1px solid rgba(16,185,129,0.25)"
                : "1px solid rgba(255,255,255,0.07)",
              color: showAdd ? "rgba(52,211,153,0.85)" : "rgba(255,255,255,0.35)",
            }}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d={showAdd ? "M6 18L18 6M6 6l12 12" : "M12 4v16m8-8H4"} />
            </svg>
            {showAdd ? "Cancel" : "Add Milestone"}
          </button>

          {/* Add event form */}
          {showAdd && (
            <div
              className="mt-2 rounded-xl p-3 space-y-2"
              style={{
                background: "rgba(16,185,129,0.04)",
                border: "1px solid rgba(16,185,129,0.12)",
              }}
            >
              <input
                type="text"
                placeholder="Event title…"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full bg-white/4 border border-white/8 focus:border-emerald-500/40 focus:outline-none rounded-lg px-3 py-2 text-xs text-white placeholder-white/18 transition-all"
              />
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                className="w-full bg-white/4 border border-white/8 focus:border-emerald-500/40 focus:outline-none rounded-lg px-3 py-2 text-xs text-white/60 transition-all"
                style={{ colorScheme: "dark" }}
              />
              <textarea
                placeholder="Description (optional)…"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className="w-full bg-white/4 border border-white/8 focus:border-emerald-500/40 focus:outline-none rounded-lg px-3 py-2 text-xs text-white placeholder-white/18 transition-all resize-none"
              />
              <button
                onClick={handleAddEvent}
                disabled={!form.title.trim() || saving}
                className="w-full py-2 rounded-lg text-xs font-bold text-white transition-all disabled:opacity-30"
                style={{ background: "linear-gradient(135deg,#059669,#0891b2)" }}
              >
                {saving ? "Saving…" : "Save Event"}
              </button>
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-10">
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-emerald-500/30 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && totalEvents === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="text-xs text-white/20">
              No milestones yet.
            </p>
            <p className="text-[10px] text-white/12 mt-1 leading-relaxed">
              Upload documents to auto-extract deadlines, or add one manually.
            </p>
          </div>
        )}

        {/* Event groups */}
        {!loading && (
          <div className="px-3 pb-4 space-y-4">
            {GROUP_ORDER.map((g) => {
              const list = grouped[g];
              if (list.length === 0) return null;
              const meta = GROUP_META[g];

              return (
                <div key={g}>
                  {/* Group header */}
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${meta.dot}`} />
                    <span className={`text-[10px] font-semibold uppercase tracking-widest ${meta.color}`}>
                      {meta.label}
                    </span>
                    <span className="text-[9px] text-white/15 font-mono ml-auto">
                      {list.length}
                    </span>
                  </div>

                  {/* Event cards */}
                  <div className="space-y-1.5">
                    {list.map((ev) => {
                      const daysLeft = ev.due_date
                        ? daysBetween(today(), parseLocalDate(ev.due_date))
                        : null;

                      return (
                        <div
                          key={ev.id}
                          className="rounded-xl px-3 py-2.5"
                          style={{
                            background:
                              g === "overdue"
                                ? "rgba(244,63,94,0.06)"
                                : g === "today"
                                ? "rgba(245,158,11,0.06)"
                                : "rgba(255,255,255,0.025)",
                            border:
                              g === "overdue"
                                ? "1px solid rgba(244,63,94,0.15)"
                                : g === "today"
                                ? "1px solid rgba(245,158,11,0.2)"
                                : "1px solid rgba(255,255,255,0.05)",
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-semibold text-white/75 leading-snug flex-1 min-w-0">
                              {ev.title}
                            </p>
                            {daysLeft !== null && (
                              <span
                                className={`text-[9px] font-mono font-bold flex-shrink-0 tabular-nums ${
                                  daysLeft < 0
                                    ? "text-rose-400/80"
                                    : daysLeft === 0
                                    ? "text-amber-400/80"
                                    : "text-white/25"
                                }`}
                              >
                                {daysLeft < 0
                                  ? `${Math.abs(daysLeft)}d ago`
                                  : daysLeft === 0
                                  ? "Today"
                                  : `${daysLeft}d`}
                              </span>
                            )}
                          </div>
                          {ev.due_date && (
                            <p className="text-[9px] text-white/25 mt-0.5 tabular-nums">
                              {formatDate(ev.due_date)}
                            </p>
                          )}
                          {ev.description && (
                            <p className="text-[10px] text-white/30 mt-1.5 leading-relaxed line-clamp-2">
                              {ev.description}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
