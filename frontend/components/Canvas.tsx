"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  addEdge,
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  Edge,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  NodeProps,
  Panel,
  Position,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";

// ─── Backend shape types ──────────────────────────────────────────────────────

export type BackendNode = {
  id: string;
  label: string;
  content: string;
  node_type: string;
  unlocked: boolean;
  position_x: number;
  position_y: number;
  created_at: string;
  document_id?: string;
};

export type BackendEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  weight: number;
};

// ─── Custom node data ─────────────────────────────────────────────────────────

type ConceptNodeData = {
  label: string;
  content: string;
  unlocked: boolean;
  node_type: string;
  document_id?: string;
  onUnlock: (id: string) => void;
  onFlashcard?: (id: string) => void;
};

// ─── Color maps ───────────────────────────────────────────────────────────────

const TYPE_BORDER: Record<string, string> = {
  concept:    "rgba(139, 92, 246, 0.4)",  // Violet
  document:   "rgba(6, 182, 212, 0.4)",   // Cyan
  summary:    "rgba(59, 130, 246, 0.4)",   // Blue
  question:   "rgba(245, 158, 11, 0.55)",  // Amber (Brighter)
  definition: "rgba(16, 185, 129, 0.55)",  // Emerald (Brighter)
};

const TYPE_GLOW: Record<string, string> = {
  concept:    "rgba(139, 92, 246, 0.22)",
  document:   "rgba(6, 182, 212, 0.22)",
  summary:    "rgba(59, 130, 246, 0.22)",
  question:   "rgba(245, 158, 11, 0.32)",
  definition: "rgba(16, 185, 129, 0.32)",
};

const TYPE_DOT: Record<string, string> = {
  concept:    "bg-violet-400",
  document:   "bg-cyan-400",
  summary:    "bg-blue-400",
  question:   "bg-amber-400",
  definition: "bg-emerald-400",
};

const TYPE_BADGE: Record<string, string> = {
  concept:    "text-violet-400/75 bg-violet-500/10 border-violet-500/20",
  document:   "text-cyan-400/75 bg-cyan-500/10 border-cyan-500/20",
  summary:    "text-blue-400/75 bg-blue-500/10 border-blue-500/20",
  question:   "text-amber-400/75 bg-amber-500/10 border-amber-500/20",
  definition: "text-emerald-400/75 bg-emerald-500/10 border-emerald-500/20",
};

const DOC_COLORS = [
  { border: "rgba(236,72,153,0.4)", glow: "rgba(236,72,153,0.22)", dot: "bg-pink-400", badge: "text-pink-400/75 bg-pink-500/10 border-pink-500/20" },
  { border: "rgba(249,115,22,0.4)", glow: "rgba(249,115,22,0.22)", dot: "bg-orange-400", badge: "text-orange-400/75 bg-orange-500/10 border-orange-500/20" },
  { border: "rgba(132,204,22,0.4)", glow: "rgba(132,204,22,0.22)", dot: "bg-lime-400", badge: "text-lime-400/75 bg-lime-500/10 border-lime-500/20" },
  { border: "rgba(56,189,248,0.4)", glow: "rgba(56,189,248,0.22)", dot: "bg-sky-400", badge: "text-sky-400/75 bg-sky-500/10 border-sky-500/20" },
  { border: "rgba(168,85,247,0.4)", glow: "rgba(168,85,247,0.22)", dot: "bg-purple-400", badge: "text-purple-400/75 bg-purple-500/10 border-purple-500/20" },
];

function getDocColors(docId?: string) {
  if (!docId) return { border: TYPE_BORDER.document, glow: TYPE_GLOW.document, dot: TYPE_DOT.document, badge: TYPE_BADGE.document };
  let hash = 0;
  for (let i = 0; i < docId.length; i++) hash = docId.charCodeAt(i) + ((hash << 5) - hash);
  return DOC_COLORS[Math.abs(hash) % DOC_COLORS.length];
}

// ─── Custom node component ────────────────────────────────────────────────────

function ConceptNode({ id, data, selected }: NodeProps<ConceptNodeData>) {
  const [expanded, setExpanded] = useState(false);

  const [expanded, setExpanded] = useState(false);

  let borderColor, glowColor, dotClass, badgeClass;
  if (data.node_type === "document" && data.document_id) {
    const docColor = getDocColors(data.document_id);
    borderColor = data.unlocked ? docColor.border : "rgba(255, 255, 255, 0.12)";
    glowColor = docColor.glow;
    dotClass = docColor.dot;
    badgeClass = docColor.badge;
  } else {
    borderColor = data.unlocked ? (TYPE_BORDER[data.node_type] ?? TYPE_BORDER.concept) : "rgba(255, 255, 255, 0.12)";
    glowColor = TYPE_GLOW[data.node_type] ?? TYPE_GLOW.concept;
    dotClass = TYPE_DOT[data.node_type] ?? TYPE_DOT.concept;
    badgeClass = TYPE_BADGE[data.node_type] ?? TYPE_BADGE.concept;
  }

  const shortContent =
    data.content.length > 130 ? data.content.slice(0, 130) + "…" : data.content;

  // Enhance the shadow glows and rings based on unlock status & selection
  const shadowStyle = data.unlocked
    ? selected
      ? `0 0 0 2px ${borderColor}, 0 12px 36px ${glowColor.replace("0.22", "0.45").replace("0.32", "0.55")}, 0 0 72px ${glowColor.replace("0.22", "0.35").replace("0.32", "0.45")}`
      : `0 6px 24px -2px ${glowColor}, inset 0 1px 2px rgba(255,255,255,0.06)`
    : `0 2px 8px rgba(0, 0, 0, 0.5)`;

  return (
    <div
      className={`relative min-w-[210px] max-w-[290px] rounded-2xl transition-all duration-500 ease-in-out backdrop-blur-md bg-slate-900/80 border border-slate-700/50 ${
        !data.unlocked
          ? "opacity-50 saturate-50 hover:opacity-75"
          : "opacity-100 saturate-100 hover:scale-[1.015]"
      }`}
      style={{
        borderColor: data.unlocked ? borderColor : "rgba(100, 116, 139, 0.2)",
        boxShadow: shadowStyle,
      }}
    >
      {/* React Flow connection handles */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-white/10 !border !border-white/20 hover:!bg-white/40 !transition-colors !rounded-full"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-white/10 !border !border-white/20 hover:!bg-white/40 !transition-colors !rounded-full"
      />

      <div className="px-4 pt-3.5 pb-3">
        {/* Header row */}
        <div className="flex items-start gap-2 mb-2.5">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass} ${
                data.unlocked ? "animate-pulse" : "opacity-30"
              }`}
              style={
                data.unlocked
                  ? { boxShadow: `0 0 8px ${borderColor}` }
                  : undefined
              }
            />
            <span className="text-sm font-bold text-slate-100 truncate leading-tight">
              {data.label}
            </span>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <span
              className={`text-[9px] font-bold px-1.5 py-[3px] rounded-md border uppercase tracking-wide flex-shrink-0 ${badgeClass}`}
            >
              {data.node_type}
            </span>
            <span
              className={`text-[8px] font-bold px-1.5 py-[2px] rounded-md border uppercase tracking-wider flex-shrink-0 ${
                data.unlocked
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : "bg-slate-800/80 border-slate-700/50 text-slate-400"
              }`}
            >
              {data.unlocked ? "Unlocked" : "Locked"}
            </span>
          </div>
        </div>

        {/* Body */}
        {data.unlocked ? (
          <>
            <p className="text-xs text-slate-300 leading-relaxed">
              {expanded ? data.content : shortContent}
            </p>
            {data.content.length > 130 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((x) => !x);
                }}
                className="mt-1.5 text-[10px] text-white/20 hover:text-white/50 transition-colors"
              >
                {expanded ? "collapse" : "expand"}
              </button>
            )}

            {/* Flashcard trigger — only on unlocked nodes */}
            {data.onFlashcard && (
              <div className="mt-2.5 pt-2 flex items-center justify-between"
                style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    data.onFlashcard!(id);
                  }}
                  className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-lg
                             bg-cyan-500/8 text-cyan-400/60 border border-cyan-500/15
                             hover:bg-cyan-500/16 hover:text-cyan-400/90 hover:border-cyan-500/30
                             transition-all"
                  title="Generate flashcards for this node"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  Flashcards
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2">
            <svg
              className="w-3.5 h-3.5 text-white/20 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <span className="text-[10px] text-white/20">Locked</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                data.onUnlock(id);
              }}
              className="ml-auto text-[10px] px-2 py-0.5 rounded-lg bg-violet-500/15 text-violet-400/70 hover:bg-violet-500/25 hover:text-violet-300 transition-all border border-violet-500/20"
            >
              Unlock
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── nodeTypes must be defined outside the component to avoid re-renders ─────

const nodeTypes = { conceptNode: ConceptNode };

// ─── Canvas component ─────────────────────────────────────────────────────────

type CanvasProps = {
  nodes: BackendNode[];
  edges: BackendEdge[];
  setNodes?: React.Dispatch<React.SetStateAction<BackendNode[]>>;
  onNodeUnlock: (nodeId: string) => void;
  /** Called when the user clicks the Flashcard button on an unlocked node. */
  onNodeFlashcard?: (node: BackendNode) => void;
  /**
   * Ref to the active room WebSocket.  When provided, Canvas broadcasts
   * node drag-stop events ({type:"node_move"}) to all collaborators in the room.
   */
  wsRef?: React.RefObject<WebSocket | null>;
};

export default function Canvas({
  nodes: backendNodes,
  edges: backendEdges,
  setNodes: parentSetNodes,
  onNodeUnlock,
  onNodeFlashcard,
  wsRef,
}: CanvasProps) {
  // Convert backend nodes → ReactFlow nodes
  const rfNodes = useMemo<Node<ConceptNodeData>[]>(
    () =>
      backendNodes.map((n) => ({
        id: n.id,
        type: "conceptNode",
        position: { x: n.position_x, y: n.position_y },
        data: {
          label: n.label,
          content: n.content,
          unlocked: n.unlocked,
          node_type: n.node_type,
          document_id: n.document_id,
          onUnlock: onNodeUnlock,
          onFlashcard: onNodeFlashcard ? () => onNodeFlashcard(n) : undefined,
        },
      })),
    [backendNodes, onNodeUnlock, onNodeFlashcard]
  );

  // Convert backend edges → ReactFlow edges
  const rfEdges = useMemo<Edge[]>(
    () =>
      backendEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "smoothstep",
        animated: true,
        label: e.label,
        style: {
          stroke: "rgba(139,92,246,0.3)",
          strokeWidth: Math.max(1, (e.weight ?? 1) * 1.5),
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "rgba(139,92,246,0.5)",
          width: 14,
          height: 14,
        },
        labelStyle: { fill: "rgba(255,255,255,0.28)", fontSize: 10 },
        labelBgStyle: {
          fill: "rgba(10,10,10,0.85)",
          stroke: "rgba(139,92,246,0.2)",
          strokeWidth: 1,
          rx: 4,
        },
      })),
    [backendEdges]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  // Keep ReactFlow state in sync when parent data changes
  useEffect(() => setNodes(rfNodes), [rfNodes, setNodes]);
  useEffect(() => setEdges(rfEdges), [rfEdges, setEdges]);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "smoothstep",
            animated: true,
            style: { stroke: "rgba(139,92,246,0.3)", strokeWidth: 1.5 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: "rgba(139,92,246,0.5)",
            },
          },
          eds
        )
      ),
    [setEdges]
  );

  // Broadcast node position update to collaborators after a drag ends
  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, draggedNode: Node) => {
      if (!draggedNode || !draggedNode.id || !draggedNode.position) return;

      // 1. Update parent state locally
      if (parentSetNodes) {
        parentSetNodes((prev) =>
          prev.map((n) =>
            n.id === draggedNode.id
              ? { ...n, position_x: draggedNode.position.x, position_y: draggedNode.position.y }
              : n
          )
        );
      }

      // 2. Broadcast WebSocket message
      if (wsRef?.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "node_move",
            nodeId: draggedNode.id,
            x: draggedNode.position.x,
            y: draggedNode.position.y,
          })
        );
      }

      // 3. Persist to database
      const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      fetch(`${API_BASE}/api/nodes/${draggedNode.id}/position`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: draggedNode.position.x, y: draggedNode.position.y }),
      }).catch((err) => console.error("Failed to save node position:", err));
    },
    [wsRef, parentSetNodes]
  );

  const onNodesDelete = useCallback(
    (deletedNodes: Node[]) => {
      deletedNodes.forEach((node) => {
        if (!node || !node.id) return;
        const nodeId = node.id;

        // 1. Update parent state locally
        if (parentSetNodes) {
          parentSetNodes((prev) => prev.filter((n) => n.id !== nodeId));
        }

        // 2. Broadcast WebSocket message
        if (wsRef?.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "node_delete",
              nodeId: nodeId,
            })
          );
        }

        // 3. Persist deletion to database
        const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
        fetch(`${API_BASE}/api/nodes/${nodeId}`, {
          method: "DELETE",
        }).catch((err) => console.error("Failed to delete node:", err));
      });
    },
    [wsRef, parentSetNodes]
  );

  return (
    <div className="w-full h-full" style={{ background: "#0a0a0a" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.35, minZoom: 0.3 }}
        minZoom={0.08}
        maxZoom={4}
        defaultEdgeOptions={{
          type: "smoothstep",
          animated: true,
          style: { stroke: "rgba(139,92,246,0.3)", strokeWidth: 1.5 },
        }}
        deleteKeyCode={["Backspace", "Delete"]}
        multiSelectionKeyCode="Shift"
        selectionKeyCode="Shift"
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="rgba(255,255,255,0.035)"
          size={1.5}
          gap={30}
        />

        <Controls
          position="bottom-left"
          showInteractive={false}
          style={{
            background: "rgba(15,15,15,0.85)",
            borderColor: "rgba(255,255,255,0.07)",
            borderRadius: "12px",
            overflow: "hidden",
          }}
        />

        <MiniMap
          position="bottom-right"
          nodeColor={(n) => {
            const d = n.data as ConceptNodeData;
            if (!d.unlocked) return "rgba(255,255,255,0.04)";
            return (
              {
                document:   "rgba(6,182,212,0.55)",
                question:   "rgba(245,158,11,0.55)",
                definition: "rgba(16,185,129,0.55)",
                summary:    "rgba(59,130,246,0.55)",
                concept:    "rgba(139,92,246,0.55)",
              }[d.node_type] ?? "rgba(139,92,246,0.55)"
            );
          }}
          maskColor="rgba(0,0,0,0.72)"
          style={{
            background: "rgba(12,12,12,0.85)",
            borderColor: "rgba(255,255,255,0.06)",
            borderRadius: "12px",
          }}
        />

        {/* Empty state panel */}
        {nodes.length === 0 && (
          <Panel position="top-center">
            <div
              className="mt-20 px-8 py-5 rounded-2xl text-center pointer-events-none"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
                backdropFilter: "blur(12px)",
              }}
            >
              <p className="text-sm text-white/25 font-medium">Canvas is empty</p>
              <p className="text-xs text-white/12 mt-1.5">
                Upload documents or create nodes to populate the graph
              </p>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
