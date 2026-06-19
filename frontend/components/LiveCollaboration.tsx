"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChatMessage = {
  text: string;
  ts: string;
  mine?: boolean;
};

type LiveCollaborationProps = {
  roomCode: string | null;
  wsRef?: React.RefObject<WebSocket | null>;
  wsConnected?: boolean;
  chatMessages?: ChatMessage[];
  onSendMessage?: (text: string) => void;
};

export default function LiveCollaboration({
  roomCode,
  wsRef,
  wsConnected = false,
  chatMessages = [],
  onSendMessage,
}: LiveCollaborationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Auto-scroll chat ───────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // ── Send chat message ──────────────────────────────────────────────────────
  const handleSendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    onSendMessage?.(text);
    setChatInput("");
  }, [chatInput, onSendMessage]);

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <>
      {/* Status indicator (persistent top-right) */}
      <div className="fixed top-4 right-4 z-40">
        <button
          onClick={() => setIsOpen((x) => !x)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl backdrop-blur-xl transition-all"
          style={{
            background: isOpen ? "rgba(10,10,10,0.9)" : "rgba(10,10,10,0.7)",
            border: isOpen ? "1px solid rgba(139,92,246,0.3)" : "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 transition-all ${
              wsConnected ? "bg-emerald-500" : "bg-white/15"
            }`}
            style={wsConnected ? { boxShadow: "0 0 8px rgba(16,185,129,0.8)" } : undefined}
          />
          <span className="text-xs font-medium text-white/70">
            {wsConnected ? "Live" : "Offline"}
          </span>
          {wsConnected && chatMessages.length > 0 && (
            <span className="text-[10px] text-violet-400/80 font-mono">
              {chatMessages.length}
            </span>
          )}
          <svg
            className={`w-3.5 h-3.5 text-white/40 transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Chat panel (slide-out from top-right) */}
      {isOpen && (
        <div className="fixed top-16 right-4 z-40 w-80 rounded-2xl backdrop-blur-xl shadow-2xl flex flex-col max-h-[500px]"
          style={{
            background: "rgba(10,10,10,0.95)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 transition-all ${
                  wsConnected ? "bg-emerald-500" : "bg-white/15"
                }`}
                style={wsConnected ? { boxShadow: "0 0 8px rgba(16,185,129,0.8)" } : undefined}
              />
              <span className="text-xs font-semibold text-white/80">
                {wsConnected ? `Room ${roomCode ?? "—"}` : "Not Connected"}
              </span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="w-6 h-6 flex items-center justify-center rounded-lg text-white/25 hover:text-white/55 hover:bg-white/5 transition-all"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Message list */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {!wsConnected && (
              <div className="text-center py-8">
                <p className="text-xs text-white/30">Not connected to workspace</p>
                <p className="text-[10px] text-white/15 mt-1">
                  Open a workspace to enable live collaboration
                </p>
              </div>
            )}
            {wsConnected && chatMessages.length === 0 && (
              <div className="text-center py-8">
                <p className="text-xs text-white/30">No messages yet</p>
                <p className="text-[10px] text-white/15 mt-1">
                  Messages are broadcast to everyone in this room
                </p>
              </div>
            )}
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.mine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className="max-w-[80%] px-3 py-2 rounded-2xl"
                  style={
                    msg.mine
                      ? {
                          background: "rgba(139,92,246,0.18)",
                          border: "1px solid rgba(139,92,246,0.2)",
                          borderBottomRightRadius: "4px",
                        }
                      : {
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.06)",
                          borderBottomLeftRadius: "4px",
                        }
                  }
                >
                  <p className="text-xs text-white/70 leading-relaxed">{msg.text}</p>
                  <p className="text-[9px] text-white/20 mt-1 text-right tabular-nums">
                    {formatTime(msg.ts)}
                  </p>
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input */}
          {wsConnected && (
            <div className="flex items-center gap-2 px-3 py-3 border-t border-white/10">
              <input
                type="text"
                placeholder="Message the room…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
                className="flex-1 bg-white/[0.03] border border-white/8 focus:border-violet-500/40 focus:outline-none rounded-xl px-3 py-2 text-xs text-white placeholder-white/18 transition-all"
              />
              <button
                onClick={handleSendChat}
                disabled={!chatInput.trim()}
                className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-xl transition-all disabled:opacity-25"
                style={{ background: "rgba(139,92,246,0.2)", border: "1px solid rgba(139,92,246,0.3)" }}
              >
                <svg className="w-3.5 h-3.5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
