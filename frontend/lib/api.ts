/**
 * Typed API client for the AetherGraph FastAPI backend.
 * Import { api } in any component instead of writing raw fetch() calls.
 */

import { createClient } from "@/utils/supabase/client";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─── Shared types ─────────────────────────────────────────────────────────────

export type Workspace = {
  id: string;
  name: string;
  description?: string;
  access_code: string;
};

export type GraphNode = {
  id: string;
  label: string;
  content: string;
  node_type: string;
  unlocked: boolean;
  position_x: number;
  position_y: number;
  created_at: string;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  weight: number;
};

export type SearchResult = {
  node_id: string;
  label: string;
  content: string;
  similarity: number;
  node_type: string;
};

export type SearchResponse = {
  results: SearchResult[];
  synthesized_answer: string | null;
  query: string;
};

// ─── API helpers ──────────────────────────────────────────────────────────────

async function getAuthHeader(): Promise<Record<string, string>> {
  if (typeof window === "undefined") return {};
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` };
  }
  return {};
}

async function req<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const authHeader = await getAuthHeader();
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...authHeader, ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`[${res.status}] ${path} — ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── Exported API object ──────────────────────────────────────────────────────

export const api = {
  workspaces: {
    list: () => req<Workspace[]>("/api/workspaces"),
    create: (name: string, description?: string) =>
      req<Workspace>("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ name, description }),
      }),
  },

  nodes: {
    list: (workspaceId: string) =>
      req<GraphNode[]>(`/api/nodes/${workspaceId}`),
    create: (payload: {
      workspace_id: string;
      label: string;
      content: string;
      node_type?: string;
      position_x?: number;
      position_y?: number;
    }) =>
      req<GraphNode>("/api/nodes", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    unlock: (nodeId: string) =>
      req<{ id: string; unlocked: boolean }>(`/api/nodes/${nodeId}/unlock`, {
        method: "PATCH",
        headers: {},
      }),
  },

  edges: {
    list: (workspaceId: string) =>
      req<GraphEdge[]>(`/api/edges/${workspaceId}`),
    create: (payload: {
      workspace_id: string;
      source_node_id: string;
      target_node_id: string;
      relationship_label?: string;
      weight?: number;
    }) =>
      req<{ id: string; status: string }>("/api/edges", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  },

  upload: async (workspaceId: string, files: File[]): Promise<void> => {
    const form = new FormData();
    form.append("workspace_id", workspaceId);
    files.forEach((f) => form.append("files", f));
    const authHeader = await getAuthHeader();
    const res = await fetch(`${BASE}/api/upload`, {
      method: "POST",
      headers: { ...authHeader },
      body: form,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  },

  search: (
    query: string,
    workspaceId: string,
    topK = 5,
    synthesize = true
  ) =>
    req<SearchResponse>("/api/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        workspace_id: workspaceId,
        top_k: topK,
        synthesize,
      }),
    }),

  documents: {
    list: (workspaceId: string) =>
      req<any[]>(`/api/workspaces/${workspaceId}/documents`),
    delete: (workspaceId: string, documentId: string) =>
      req<{ status: string; document_id: string }>(
        `/api/workspaces/${workspaceId}/documents/${documentId}`,
        { method: "DELETE" }
      ),
  },
};
