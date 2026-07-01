"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import OmniSearch, { ChatMessage as OmniChatMessage } from "@/components/OmniSearch";
import SyllabusTracker from "@/components/SyllabusTracker";
import GamificationWidget from "@/components/GamificationWidget";
import MockExam from "@/components/MockExam";
import CalendarOnly from "@/components/CalendarOnly";
import FlashcardDeck from "@/components/FlashcardDeck";
import DocumentManager from "@/components/DocumentManager";
import LiveCollaboration from "@/components/LiveCollaboration";
import type { BackendNode, BackendEdge } from "@/components/Canvas";

// React Flow uses browser APIs — load Canvas only on the client side
const Canvas = dynamic(() => import("@/components/Canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full">
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-2 h-2 rounded-full bg-violet-500/40 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  ),
});

// ─── Types ────────────────────────────────────────────────────────────────────

type Workspace = {
  id: string;
  name: string;
  description?: string;
  access_code: string;
};

type ChatMessage = {
  text: string;
  ts: string;
  mine?: boolean;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─── Page component ───────────────────────────────────────────────────────────

export default function WorkspacePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center w-full h-full bg-[#0a0a0a] text-white">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full bg-violet-500/40 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    }>
      <WorkspacePageContent />
    </Suspense>
  );
}

function WorkspacePageContent() {
  // ── Core state ───────────────────────────────────────────────────────────
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [nodes, setNodes] = useState<BackendNode[]>([]);
  const [edges, setEdges] = useState<BackendEdge[]>([]);

  const [newName, setNewName] = useState("");
  const [creatingWs, setCreatingWs] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [documentManagerOpen, setDocumentManagerOpen] = useState(false);

  const [uploadStatus, setUploadStatus] = useState<{
    text: string;
    color: "cyan" | "red";
  } | null>(null);

  // ── Gamification / Exam state ─────────────────────────────────────────────
  const [showExam, setShowExam] = useState(false);
  const [xpRefreshKey, setXpRefreshKey] = useState(0);

  // ── Flashcard deck state ──────────────────────────────────────────────────
  const [flashcardNode, setFlashcardNode] = useState<BackendNode | null>(null);

  // ── WebSocket collaboration state ─────────────────────────────────────────
  const wsRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [roomMessages, setRoomMessages] = useState<ChatMessage[]>([]);
  const [roomUserCount, setRoomUserCount] = useState(0);

  // ── OmniSearch chat history state ──────────────────────────────────────────
  const [omniSearchHistory, setOmniSearchHistory] = useState<Record<string, OmniChatMessage[]>>({});
  const [copied, setCopied] = useState(false);

  const searchParams = useSearchParams();
  const router = useRouter();
  const joinCode = searchParams.get("join");
  const supabase = createClient();

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
      }
    };
    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.push("/login");
      }
    });

    return () => subscription.unsubscribe();
  }, [router, supabase]);

  // ─────────────────────────────────────────────────────────────────────────
  // Data fetching
  // ─────────────────────────────────────────────────────────────────────────

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/workspaces`);
      if (!res.ok) return;
      const data: Workspace[] = await res.json();
      setWorkspaces(data);
      if (data.length > 0) setActiveWorkspace((prev) => prev ?? data[0]);
    } catch {
      // Backend not running yet — fail silently in dev
    }
  }, []);

  const fetchGraph = useCallback(async (wsId: string) => {
    try {
      const [nodesRes, edgesRes] = await Promise.all([
        fetch(`${API_BASE}/api/nodes/${wsId}`),
        fetch(`${API_BASE}/api/edges/${wsId}`),
      ]);
      if (nodesRes.ok) setNodes(await nodesRes.json());
      if (edgesRes.ok) setEdges(await edgesRes.json());
    } catch {
      // Swallow while backend is starting
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // WebSocket message handler (all state setters are stable — [] deps correct)
  // ─────────────────────────────────────────────────────────────────────────

  const handleWsMessage = useCallback((msg: Record<string, unknown>) => {
    const t = msg.type as string;
    if (t === "node_move") {
      // A collaborator dragged a node — update its position in our state
      setNodes((prev) =>
        prev.map((n) =>
          n.id === msg.nodeId
            ? { ...n, position_x: msg.x as number, position_y: msg.y as number }
            : n
        )
      );
    } else if (t === "node_add") {
      const incoming = msg.node as BackendNode | null;
      if (incoming) setNodes((prev) => [...prev, incoming]);
    } else if (t === "node_delete") {
      setNodes((prev) => prev.filter((n) => n.id !== msg.nodeId));
    } else if (t === "chat") {
      setRoomMessages((prev) => [
        ...prev,
        { text: msg.text as string, ts: msg.ts as string },
      ]);
    } else if (t === "user_count") {
      setRoomUserCount(msg.count as number);
    } else if (t === "nodes_refreshed") {
      if (activeWorkspace) {
        fetchGraph(activeWorkspace.id);
      }
    }
  }, [activeWorkspace, fetchGraph]);

  // ─────────────────────────────────────────────────────────────────────────
  // WebSocket lifecycle — connect when workspace is selected, disconnect on change
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const prev = wsRef.current;
    if (prev) {
      prev.close();
      wsRef.current = null;
      setWsConnected(false);
    }

    if (!activeWorkspace) return;

    // Convert http(s):// → ws(s)://
    const wsBase = API_BASE.replace(/^https/, "wss").replace(/^http/, "ws");
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${wsBase}/ws/room/${activeWorkspace.access_code}`);
    } catch {
      return; // WebSocket not available (SSR, test env)
    }

    wsRef.current = ws;
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => {
      setWsConnected(false);
      if (wsRef.current === ws) wsRef.current = null;
    };
    ws.onerror = () => setWsConnected(false);
    ws.onmessage = (ev) => {
      try {
        handleWsMessage(JSON.parse(ev.data));
      } catch {
        // Ignore malformed messages
      }
    };

    return () => {
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace?.id, handleWsMessage]);



  useEffect(() => { fetchWorkspaces(); }, [fetchWorkspaces]);
  useEffect(() => {
    if (activeWorkspace) fetchGraph(activeWorkspace.id);
    // Reset room messages when workspace changes
    setRoomMessages([]);
    setRoomUserCount(0);
  }, [activeWorkspace, fetchGraph]);

  useEffect(() => {
    if (joinCode && workspaces.length > 0) {
      const existing = workspaces.find((w) => w.access_code.toUpperCase() === joinCode.toUpperCase());
      if (existing) {
        setActiveWorkspace(existing);
        router.replace("/workspace");
      } else {
        fetch(`${API_BASE}/api/workspaces/code/${joinCode}`)
          .then((res) => {
            if (res.ok) return res.json();
            throw new Error("Workspace not found");
          })
          .then((ws: Workspace) => {
            setWorkspaces((prev) => {
              if (prev.some((p) => p.id === ws.id)) return prev;
              return [ws, ...prev];
            });
            setActiveWorkspace(ws);
            router.replace("/workspace");
          })
          .catch((err) => {
            console.error("Failed to join room by access code:", err);
            router.replace("/workspace");
          });
      }
    }
  }, [joinCode, workspaces, router]);

  // ─────────────────────────────────────────────────────────────────────────
  // Workspace creation
  // ─────────────────────────────────────────────────────────────────────────

  const createWorkspace = async () => {
    const name = newName.trim();
    if (!name || creatingWs) return;
    setCreatingWs(true);
    try {
      const res = await fetch(`${API_BASE}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const ws: Workspace = await res.json();
        setWorkspaces((prev) => [ws, ...prev]);
        setActiveWorkspace(ws);
        setNewName("");
      }
    } finally {
      setCreatingWs(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Pocket Dump upload
  // ─────────────────────────────────────────────────────────────────────────

  const handleUpload = async (files: FileList) => {
    if (!activeWorkspace) {
      setUploadStatus({ text: "Select a workspace before uploading.", color: "red" });
      return;
    }

    const form = new FormData();
    form.append("workspace_id", activeWorkspace.id);
    Array.from(files).forEach((f) => form.append("files", f));

    setUploadStatus({ text: "Uploading…", color: "cyan" });
    try {
      const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: form });
      if (res.ok) {
        setUploadStatus({
          text: "Queued — nodes and calendar events will appear within seconds.",
          color: "cyan",
        });
        setTimeout(() => {
          fetchGraph(activeWorkspace.id);
          setUploadStatus(null);
        }, 4000);
      } else {
        setUploadStatus({ text: "Upload failed — check the backend.", color: "red" });
      }
    } catch {
      setUploadStatus({
        text: "Cannot reach backend — is it running on :8000?",
        color: "red",
      });
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Node callbacks
  // ─────────────────────────────────────────────────────────────────────────

  const handleNodeUnlock = useCallback(async (nodeId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/nodes/${nodeId}/unlock`, {
        method: "PATCH",
      });
      if (res.ok)
        setNodes((prev) =>
          prev.map((n) => (n.id === nodeId ? { ...n, unlocked: true } : n))
        );
    } catch {
      // ignore
    }
  }, []);

  const handleNodeFlashcard = useCallback((node: BackendNode) => {
    setFlashcardNode(node);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // XP callbacks
  // ─────────────────────────────────────────────────────────────────────────

  const handleXPAwarded = useCallback(
    (_xpEarned: number, _newLevel: number) => {
      setXpRefreshKey((k) => k + 1);
      setShowExam(false);
    },
    []
  );

  const handleFlashcardXP = useCallback((_xp: number) => {
    setXpRefreshKey((k) => k + 1);
    setFlashcardNode(null);
  }, []);

  const handleSendChat = useCallback((text: string) => {
    if (!wsRef?.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "chat", text }));
  }, []);

  const handleCopyInvite = () => {
    if (!activeWorkspace) return;
    const inviteUrl = `${window.location.origin}/workspace?join=${activeWorkspace.access_code}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const unlockedCount = nodes.filter((n) => n.unlocked).length;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0a0a0a] text-white">
      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <aside
        className={`flex-shrink-0 flex flex-col border-r transition-all duration-300 z-20 ${
          sidebarOpen ? "w-72 opacity-100" : "w-0 opacity-0 overflow-hidden"
        } border-slate-800/80 bg-slate-950/90 backdrop-blur-xl`}
      >
        {/* Brand */}
        <div
          className="px-5 pt-6 pb-4 flex-shrink-0 border-b border-slate-800/60"
        >
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-[11px] font-black shadow-[0_0_16px_rgba(139,92,246,0.4)]">
              A
            </div>
            <span className="text-sm font-bold tracking-[0.15em] text-white/80 uppercase">
              AetherGraph
            </span>
          </div>
          <p className="text-[10px] text-white/20 mt-0.5 ml-9">
            GraphRAG Study Workspace
          </p>
        </div>

        {/* Workspaces */}
        <div
          className="px-4 py-4 flex-shrink-0 border-b border-slate-800/60"
        >
          <p className="text-[10px] text-white/30 uppercase tracking-widest font-semibold mb-3">
            Workspaces
          </p>
          <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
            {workspaces.length === 0 && (
              <p className="text-xs text-white/15 px-2 py-1.5">
                No workspaces yet — create one below.
              </p>
            )}
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => setActiveWorkspace(ws)}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-all duration-150 ${
                  activeWorkspace?.id === ws.id
                    ? "bg-violet-500/15 border border-violet-500/25 text-violet-300/90"
                    : "text-white/40 hover:bg-white/5 hover:text-white/70 border border-transparent"
                }`}
              >
                <div className="font-medium text-xs truncate">{ws.name}</div>
                <div className="text-[10px] font-mono opacity-40 mt-0.5">
                  {ws.access_code}
                </div>
              </button>
            ))}
          </div>

          <div className="flex gap-1.5 mt-3">
            <input
              type="text"
              placeholder="Workspace name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createWorkspace()}
              className="flex-1 bg-white/5 border border-white/8 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/18 focus:outline-none focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/15 transition-all"
            />
            <button
              onClick={createWorkspace}
              disabled={creatingWs || !newName.trim()}
              className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-30 text-xs font-bold text-white transition-colors"
            >
              +
            </button>
          </div>
        </div>

        {/* Syllabus Tracker */}
        <div
          className="px-4 py-4 flex-shrink-0 border-b border-slate-800/60"
        >
          <p className="text-[10px] text-white/30 uppercase tracking-widest font-semibold mb-3">
            Syllabus Progress
          </p>
          <SyllabusTracker totalNodes={nodes.length} unlockedNodes={unlockedCount} />
        </div>

        {/* Gamification Widget */}
        <div
          className="px-4 py-4 flex-shrink-0 border-b border-slate-800/60"
        >
          <p className="text-[10px] text-white/30 uppercase tracking-widest font-semibold mb-3">
            XP &amp; Ranking
          </p>
          <GamificationWidget apiBase={API_BASE} refreshKey={xpRefreshKey} />

          {/* Mock Exam trigger */}
          <button
            onClick={() => setShowExam(true)}
            disabled={!activeWorkspace}
            className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-xs font-semibold transition-all disabled:opacity-25 disabled:cursor-not-allowed"
            style={
              activeWorkspace
                ? {
                    background: "linear-gradient(135deg,rgba(139,92,246,0.12),rgba(6,182,212,0.12))",
                    border: "1px solid rgba(139,92,246,0.28)",
                    color: "rgba(167,139,250,0.85)",
                  }
                : {
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.25)",
                  }
            }
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Take Mock Exam
          </button>
        </div>

        {/* Pocket Dump */}
        <div className="px-4 py-4 flex-1 min-h-0 overflow-auto">
          <p className="text-[10px] text-white/30 uppercase tracking-widest font-semibold mb-3">
            Pocket Dump
          </p>
          <label
            className="flex flex-col items-center justify-center w-full h-24 rounded-2xl cursor-pointer transition-all group"
            style={{ border: "2px dashed rgba(255,255,255,0.08)" }}
            onMouseOver={(e) =>
              ((e.currentTarget as HTMLElement).style.borderColor = "rgba(139,92,246,0.35)")
            }
            onMouseOut={(e) =>
              ((e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)")
            }
          >
            <input
              type="file"
              multiple
              accept=".pdf,.txt,.md"
              className="hidden"
              onChange={(e) => e.target.files && handleUpload(e.target.files)}
            />
            <svg
              className="w-5 h-5 text-white/15 group-hover:text-violet-400/70 transition-colors mb-1.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <span className="text-[10px] text-white/20 group-hover:text-white/40 transition-colors">
              Drop PDF, TXT, or MD
            </span>
          </label>

          {uploadStatus && (
            <p
              className={`text-xs mt-2.5 leading-relaxed ${
                uploadStatus.color === "cyan" ? "text-cyan-400/70" : "text-red-400/80"
              }`}
            >
              {uploadStatus.text}
            </p>
          )}
        </div>

        {/* Bottom toolbar */}
        <div
          className="px-3 py-2.5 flex-shrink-0 space-y-1.5 border-t border-slate-800/60"
        >
          {/* Calendar toggle */}
          <button
            onClick={() => {
              setCalendarOpen((x) => !x);
              setSearchOpen(false);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all text-xs font-medium ${
              calendarOpen
                ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-300/80"
                : "bg-white/[0.03] border border-white/8 text-white/40 hover:bg-white/[0.06] hover:text-white/70 hover:border-white/15"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Calendar
          </button>

          {/* Omni-Search toggle */}
          <button
            onClick={() => {
              setSearchOpen((x) => !x);
              setCalendarOpen(false);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all text-xs font-medium ${
              searchOpen
                ? "bg-cyan-500/10 border border-cyan-500/25 text-cyan-300/80"
                : "bg-white/[0.03] border border-white/8 text-white/40 hover:bg-white/[0.06] hover:text-white/70 hover:border-white/15"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Omni-Search
            <span className="ml-auto text-white/15 font-normal text-[10px]">⌘K</span>
          </button>

          {/* Document Manager toggle */}
          <button
            onClick={() => {
              setDocumentManagerOpen((x) => !x);
              setSearchOpen(false);
              setCalendarOpen(false);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all text-xs font-medium ${
              documentManagerOpen
                ? "bg-violet-500/10 border border-violet-500/25 text-violet-300/80"
                : "bg-white/[0.03] border border-white/8 text-white/40 hover:bg-white/[0.06] hover:text-white/70 hover:border-white/15"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Documents
          </button>
        </div>
      </aside>

      {/* ── Main canvas ───────────────────────────────────────────────────── */}
      <main className="flex-1 relative overflow-hidden">
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen((x) => !x)}
          className="absolute top-4 left-4 z-30 w-8 h-8 rounded-xl flex items-center justify-center transition-all"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
          aria-label="Toggle sidebar"
        >
          <svg className="w-4 h-4 text-white/35" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {activeWorkspace && (
          <div className="absolute top-4 left-16 right-48 z-30 flex items-center justify-between px-4 py-2.5 rounded-xl backdrop-blur-md border border-slate-800/80 bg-slate-950/75 shadow-lg shadow-black/40 shadow-violet-950/5"
          >
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="text-sm font-semibold text-white/90 truncate">{activeWorkspace.name}</h1>
              <span className="text-white/20">|</span>
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-2 py-0.5 rounded-lg">
                <span className="text-[10px] text-white/50 font-mono select-all uppercase tracking-wider">{activeWorkspace.access_code}</span>
                <button
                  onClick={handleCopyInvite}
                  className="p-1 rounded hover:bg-white/5 text-white/40 hover:text-white/80 transition-colors flex items-center justify-center"
                  title="Copy Invite Link"
                >
                  {copied ? (
                    <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeWorkspace ? (
          <Canvas
            nodes={nodes}
            edges={edges}
            setNodes={setNodes}
            onNodeUnlock={handleNodeUnlock}
            onNodeFlashcard={handleNodeFlashcard}
            wsRef={wsRef}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-10">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
              style={{
                background: "linear-gradient(135deg,rgba(139,92,246,0.12),rgba(6,182,212,0.12))",
                border: "1px solid rgba(139,92,246,0.2)",
                boxShadow: "0 0 40px rgba(139,92,246,0.08)",
              }}
            >
              <svg className="w-8 h-8 text-violet-400/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white/60 mb-2">No workspace selected</h2>
            <p className="text-sm text-white/25 max-w-xs leading-relaxed">
              Create or select a workspace in the left panel to start building your knowledge graph.
            </p>
          </div>
        )}
      </main>

      {/* ── Right panel: Calendar OR OmniSearch ──────────────────────────── */}
      {(calendarOpen || searchOpen) && (
        <aside
          className="w-80 flex-shrink-0 z-20 flex flex-col border-l border-slate-800/80 bg-slate-950/90 backdrop-blur-xl"
        >
          {calendarOpen && (
            <CalendarOnly
              roomCode={activeWorkspace?.access_code ?? null}
              apiBase={API_BASE}
              onClose={() => setCalendarOpen(false)}
            />
          )}
          {searchOpen && (
            <OmniSearch
              workspaceId={activeWorkspace?.id ?? null}
              apiBase={API_BASE}
              onClose={() => setSearchOpen(false)}
              messages={activeWorkspace ? (omniSearchHistory[activeWorkspace.id] || []) : []}
              setMessages={(updater) => {
                if (!activeWorkspace) return;
                setOmniSearchHistory((prev) => {
                  const current = prev[activeWorkspace.id] || [];
                  const next = typeof updater === "function" ? (updater as Function)(current) : updater;
                  return { ...prev, [activeWorkspace.id]: next };
                });
              }}
            />
          )}
        </aside>
      )}

      {/* ── Mock Exam overlay ─────────────────────────────────────────────── */}
      {showExam && (
        <MockExam
          workspaceId={activeWorkspace?.id ?? null}
          apiBase={API_BASE}
          onClose={() => setShowExam(false)}
          onXPAwarded={handleXPAwarded}
        />
      )}

      {/* ── Flashcard Deck overlay ────────────────────────────────────────── */}
      {flashcardNode && (
        <FlashcardDeck
          nodeId={flashcardNode.id}
          nodeLabel={flashcardNode.label}
          apiBase={API_BASE}
          onClose={() => setFlashcardNode(null)}
          onXPAwarded={handleFlashcardXP}
        />
      )}

      {/* ── Document Manager overlay ──────────────────────────────────────── */}
      <DocumentManager
        workspaceId={activeWorkspace?.id ?? null}
        apiBase={API_BASE}
        isOpen={documentManagerOpen}
        onClose={() => setDocumentManagerOpen(false)}
        onDocumentDeleted={() => {
          if (activeWorkspace) fetchGraph(activeWorkspace.id);
        }}
      />

      {/* ── Live Collaboration overlay (persistent top-right) ──────────────── */}
      <LiveCollaboration
        roomCode={activeWorkspace?.access_code ?? null}
        wsRef={wsRef}
        wsConnected={wsConnected}
        chatMessages={roomMessages}
        onSendMessage={handleSendChat}
      />
    </div>
  );
}
