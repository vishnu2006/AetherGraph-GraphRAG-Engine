"use client";

import { useEffect, useState } from "react";

type Document = {
  id: string;
  filename: string;
  file_size: number;
  file_type: string;
  status: string;
  node_count: number;
  uploaded_at: string;
  color?: string;
};

type DocumentManagerProps = {
  workspaceId: string | null;
  apiBase: string;
  isOpen: boolean;
  onClose: () => void;
  onDocumentDeleted?: () => void;
};

export default function DocumentManager({
  workspaceId,
  apiBase,
  isOpen,
  onClose,
  onDocumentDeleted,
}: DocumentManagerProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && workspaceId) {
      fetchDocuments();
    }
  }, [isOpen, workspaceId]);

  const fetchDocuments = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/workspaces/${workspaceId}/documents`);
      if (res.ok) {
        const data: Document[] = await res.json();
        setDocuments(data);
      }
    } catch (error) {
      console.error("Failed to fetch documents:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!confirm("Are you sure you want to delete this document and all its associated nodes?")) {
      return;
    }

    setDeleting(documentId);
    try {
      const res = await fetch(`${apiBase}/api/workspaces/${workspaceId}/documents/${documentId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setDocuments((prev) => prev.filter((doc) => doc.id !== documentId));
        onDocumentDeleted?.();
      }
    } catch (error) {
      console.error("Failed to delete document:", error);
    } finally {
      setDeleting(null);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
      case "processing":
        return "text-cyan-400 bg-cyan-500/10 border-cyan-500/20";
      case "failed":
        return "text-red-400 bg-red-500/10 border-red-500/20";
      default:
        return "text-white/40 bg-white/5 border-white/10";
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Slide-out panel */}
      <div className="absolute right-0 top-0 h-full w-96 bg-[#0a0a0a] border-l border-white/10 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Document Manager</h2>
            <p className="text-xs text-white/40 mt-0.5">
              {documents.length} document{documents.length !== 1 ? "s" : ""} uploaded
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Document list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center h-32">
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
          ) : documents.length === 0 ? (
            <div className="text-center py-12">
              <svg
                className="w-12 h-12 text-white/10 mx-auto mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p className="text-sm text-white/30">No documents uploaded yet</p>
              <p className="text-xs text-white/20 mt-1">Use Pocket Dump to upload files</p>
            </div>
          ) : (
            documents.map((doc) => (
              <div
                key={doc.id}
                className="p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-all group"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {doc.color && (
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: doc.color, boxShadow: `0 0 6px ${doc.color}` }}
                        />
                      )}
                      <h3 className="text-sm font-medium text-white truncate">{doc.filename}</h3>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-white/40">{formatFileSize(doc.file_size)}</span>
                      <span className="text-white/20">•</span>
                      <span className="text-[10px] text-white/40">{doc.file_type.toUpperCase()}</span>
                    </div>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border ${getStatusColor(doc.status)}`}
                  >
                    {doc.status}
                  </span>
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                  <div className="flex items-center gap-3 text-[10px] text-white/40">
                    <span>{doc.node_count} nodes</span>
                    <span className="text-white/20">•</span>
                    <span>{formatDate(doc.uploaded_at)}</span>
                  </div>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    disabled={deleting === doc.id}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-white/30 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Delete document"
                  >
                    {deleting === doc.id ? (
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-sm font-medium text-white/70 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
