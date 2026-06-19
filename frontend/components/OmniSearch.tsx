"use client";

import { useEffect, useRef, useState } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

type SearchResult = {
  node_id: string;
  label: string;
  content: string;
  similarity: number;
  node_type: string;
};

type SearchResponse = {
  results: SearchResult[];
  synthesized_answer: string | null;
  query: string;
};

export type ChatMessage =
  | { id: string; role: "user"; query: string }
  | { id: string; role: "assistant"; response: SearchResponse }
  | { id: string; role: "error"; text: string };

type OmniSearchProps = {
  workspaceId: string | null;
  apiBase: string;
  onClose: () => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const NODE_TYPE_COLORS: Record<string, string> = {
  concept: "text-violet-400/80 bg-violet-500/10 border-violet-500/20",
  document: "text-cyan-400/80 bg-cyan-500/10 border-cyan-500/20",
  summary: "text-blue-400/80 bg-blue-500/10 border-blue-500/20",
  question: "text-amber-400/80 bg-amber-500/10 border-amber-500/20",
  definition: "text-emerald-400/80 bg-emerald-500/10 border-emerald-500/20",
};

function nodeTypeClass(t: string) {
  return NODE_TYPE_COLORS[t] ?? NODE_TYPE_COLORS.concept;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function OmniSearch({
  workspaceId,
  apiBase,
  onClose,
  messages,
  setMessages,
}: OmniSearchProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [topK, setTopK] = useState(5);
  const [synthesize, setSynthesize] = useState(true);

  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed || loading) return;

    if (!workspaceId) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "error",
          text: "Select a workspace first before running a search.",
        },
      ]);
      return;
    }

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", query: trimmed },
    ]);
    setQuery("");
    setLoading(true);

    try {
      const res = await fetch(`${apiBase}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          workspace_id: workspaceId,
          top_k: topK,
          synthesize,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} — ${await res.text()}`);
      }

      const data: SearchResponse = await res.json();
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", response: data },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "error",
          text:
            err instanceof Error
              ? err.message
              : "Search failed — is the backend running on port 8000?",
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400" />
          </span>
          <span className="text-sm font-semibold text-white/85">Omni-Search</span>
          <span className="text-[10px] font-mono text-white/20 border border-white/10 px-1.5 py-0.5 rounded">
            RAG
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close Omni-Search"
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/5 text-white/25 hover:text-white/70 transition-all"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* ── Settings bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-white/5 bg-white/[0.015] flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-white/25 uppercase tracking-wide">
            Top-K
          </span>
          <select
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value))}
            className="bg-white/5 border border-white/10 rounded-md text-xs text-white/60 px-2 py-0.5 focus:outline-none focus:border-white/20 cursor-pointer"
          >
            {[3, 5, 8, 10].map((k) => (
              <option key={k} value={k} className="bg-[#1a1a1a] text-white">
                {k}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10px] text-white/25 uppercase tracking-wide">
            Synthesize
          </span>
          <button
            onClick={() => setSynthesize(!synthesize)}
            role="switch"
            aria-checked={synthesize}
            className={`relative w-8 h-4 rounded-full transition-all duration-200 ${
              synthesize ? "bg-violet-500/70" : "bg-white/10"
            }`}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full transition-all duration-200 ${
                synthesize
                  ? "left-[18px] bg-white shadow-[0_0_4px_rgba(255,255,255,0.6)]"
                  : "left-0.5 bg-white/30"
              }`}
            />
          </button>
        </div>
      </div>

      {/* ── Message thread ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-16 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-cyan-500/8 border border-cyan-500/15 flex items-center justify-center">
              <svg
                className="w-7 h-7 text-cyan-400/40"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-white/30">
                Ask your knowledge graph anything
              </p>
              <p className="text-xs text-white/15 mt-1.5 max-w-[240px] leading-relaxed">
                Queries are matched via cosine similarity, then synthesised by
                Claude using only your uploaded content.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            {/* User bubble */}
            {msg.role === "user" && (
              <div className="flex justify-end">
                <div className="max-w-[88%] bg-violet-600/15 border border-violet-500/20 rounded-2xl rounded-tr-sm px-4 py-2.5">
                  <p className="text-sm text-white/80">{msg.query}</p>
                </div>
              </div>
            )}

            {/* Error bubble */}
            {msg.role === "error" && (
              <div className="flex justify-start">
                <div className="max-w-[92%] bg-red-500/8 border border-red-500/20 rounded-2xl rounded-tl-sm px-4 py-2.5">
                  <p className="text-xs text-red-400/90 leading-relaxed">
                    {msg.text}
                  </p>
                </div>
              </div>
            )}

            {/* Assistant response */}
            {msg.role === "assistant" && (
              <div className="space-y-3">
                {/* Synthesised answer */}
                {msg.response.synthesized_answer && (
                  <div
                    className="bg-[#0f0f0f] border border-cyan-500/20 rounded-2xl rounded-tl-sm px-4 py-3"
                    style={{
                      boxShadow: "0 0 24px rgba(6,182,212,0.04)",
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
                      <span className="text-[9px] font-bold text-cyan-400/60 uppercase tracking-widest">
                        Synthesised Answer
                      </span>
                    </div>
                    <p className="text-sm text-white/75 leading-relaxed whitespace-pre-wrap">
                      {msg.response.synthesized_answer}
                    </p>
                  </div>
                )}

                {/* Retrieved sources */}
                {msg.response.results.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[10px] text-white/20 uppercase tracking-wider font-medium px-0.5">
                      {msg.response.results.length} source
                      {msg.response.results.length !== 1 ? "s" : ""} retrieved
                    </p>
                    {msg.response.results.map((r, i) => (
                      <div
                        key={r.node_id}
                        className="bg-white/[0.025] border border-white/5 rounded-xl px-3 py-2.5 hover:border-white/10 transition-all"
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[10px] font-mono text-white/20 flex-shrink-0">
                            #{i + 1}
                          </span>
                          <span className="text-xs font-medium text-white/55 truncate flex-1 min-w-0">
                            {r.label}
                          </span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <div className="h-0.5 w-10 rounded-full bg-white/5 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-500"
                                style={{
                                  width: `${Math.round(r.similarity * 100)}%`,
                                }}
                              />
                            </div>
                            <span className="text-[10px] font-mono text-white/30 tabular-nums">
                              {(r.similarity * 100).toFixed(0)}%
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-white/30 leading-relaxed line-clamp-3">
                          {r.content}
                        </p>
                        <span
                          className={`mt-2 inline-block text-[9px] font-medium px-1.5 py-0.5 rounded border uppercase tracking-wide ${nodeTypeClass(r.node_type)}`}
                        >
                          {r.node_type}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  !msg.response.synthesized_answer && (
                    <div className="bg-white/[0.02] border border-white/5 rounded-xl px-4 py-3">
                      <p className="text-xs text-white/25">
                        No matching nodes found. Upload documents to your
                        workspace first.
                      </p>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="flex items-center gap-2.5 px-1">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
            <span className="text-xs text-white/20">Searching…</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input ──────────────────────────────────────────────────────────── */}
      <div className="px-4 pb-4 pt-3 border-t border-white/5 flex-shrink-0">
        <div className="flex gap-2 items-center">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) handleSearch();
            }}
            placeholder="Ask your graph…"
            disabled={loading}
            className="flex-1 bg-white/5 border border-white/10 focus:border-cyan-500/35 focus:ring-1 focus:ring-cyan-500/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none transition-all disabled:opacity-50"
          />
          <button
            onClick={handleSearch}
            disabled={!query.trim() || loading}
            className="w-10 h-10 flex-shrink-0 rounded-xl flex items-center justify-center bg-cyan-600/90 hover:bg-cyan-500 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            style={{
              boxShadow: query.trim()
                ? "0 0 20px rgba(6,182,212,0.25)"
                : undefined,
            }}
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/25 border-t-white rounded-full animate-spin" />
            ) : (
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
