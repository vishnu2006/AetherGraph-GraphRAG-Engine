"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LandingPage() {
  const [accessCode, setAccessCode] = useState("");
  const router = useRouter();

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (accessCode.trim()) {
      router.push(`/workspace?join=${accessCode.trim().toUpperCase()}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] relative overflow-hidden">
      {/* Animated background gradient */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-cyan-600/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-violet-500/10 to-cyan-500/10 rounded-full blur-3xl" />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6 py-12">
        {/* Logo/Brand */}
        <div className="mb-10 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-lg font-black shadow-[0_0_32px_rgba(139,92,246,0.5)]">
            A
          </div>
          <span className="text-2xl font-bold tracking-[0.2em] text-white/90 uppercase">
            AetherGraph
          </span>
        </div>

        {/* Hero Headline */}
        <h1 className="text-5xl md:text-7xl font-bold text-center mb-6 bg-gradient-to-r from-white via-violet-200 to-cyan-200 bg-clip-text text-transparent">
          Knowledge Graphs
          <br />
          <span className="text-4xl md:text-6xl">Reimagined</span>
        </h1>

        {/* Description */}
        <p className="text-lg md:text-xl text-white/60 text-center max-w-2xl mb-12 leading-relaxed">
          Transform your documents into an interactive semantic knowledge graph.
          Upload PDFs, explore connections with AI-powered search, generate flashcards,
          and collaborate in real-time with GraphRAG technology.
        </p>

        {/* Actions Section */}
        <div className="flex flex-col items-center gap-6 w-full max-w-md mb-16">
          <Link
            href="/workspace"
            className="w-full text-center group relative px-8 py-4 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 text-white font-semibold text-lg hover:from-violet-500 hover:to-cyan-500 transition-all shadow-[0_0_40px_rgba(139,92,246,0.35)] hover:shadow-[0_0_60px_rgba(139,92,246,0.5)]"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              Enter Workspace Hub
              <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </span>
          </Link>

          <div className="flex items-center gap-4 w-full px-4">
            <div className="h-px bg-white/10 flex-1"></div>
            <span className="text-white/30 text-xs font-semibold uppercase tracking-wider">or join existing</span>
            <div className="h-px bg-white/10 flex-1"></div>
          </div>

          <form onSubmit={handleJoin} className="flex flex-col sm:flex-row gap-3 w-full px-2">
            <input
              type="text"
              placeholder="Enter Room Code (e.g. AX7B92CD)"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 hover:border-white/20 focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none transition-all uppercase text-center tracking-wider"
            />
            <button
              type="submit"
              disabled={!accessCode.trim()}
              className="px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white border border-white/10 hover:border-white/20 font-medium text-sm transition-all disabled:opacity-40 disabled:hover:bg-white/5 flex items-center justify-center gap-2"
            >
              Join Room
            </button>
          </form>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl w-full">
          <div className="p-6 rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10 hover:border-violet-500/30 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center mb-4 group-hover:bg-violet-500/30 transition-colors">
              <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
              </svg>
            </div>
            <h3 className="text-white font-semibold mb-2">Smart Document Ingestion</h3>
            <p className="text-white/50 text-sm">Upload PDFs, TXT, or MD files and watch them transform into interconnected knowledge nodes.</p>
          </div>

          <div className="p-6 rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10 hover:border-cyan-500/30 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center mb-4 group-hover:bg-cyan-500/30 transition-colors">
              <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h3 className="text-white font-semibold mb-2">AI-Powered Search</h3>
            <p className="text-white/50 text-sm">Query your knowledge graph with natural language and get synthesized answers from your documents.</p>
          </div>

          <div className="p-6 rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10 hover:border-emerald-500/30 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center mb-4 group-hover:bg-emerald-500/30 transition-colors">
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="text-white font-semibold mb-2">Real-Time Collaboration</h3>
            <p className="text-white/50 text-sm">Work together with live sync, shared workspaces, and real-time graph updates.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-16 text-white/30 text-xs">
          Powered by Gemini AI & pgvector
        </div>
      </div>
    </div>
  );
}
