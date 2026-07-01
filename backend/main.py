"""
AetherGraph — FastAPI backend (Google Gemini edition, v1.3.0).

AI stack
--------
  Embeddings  : Gemini text-embedding-004
                output_dimensionality=384 (MRL truncation) → matches Vector(384)
                Free-tier limit: 1,500 requests / minute
  Synthesis   : Gemini 2.5 Flash (configurable via GEMINI_CHAT_MODEL env var)
                Free-tier limit: 15 RPM / 1M TPM
  Structured  : Gemini 2.5 Flash + response_schema (Pydantic models)
                Guarantees deterministic JSON for exam, flashcard, and
                calendar-event extraction.

Features
--------
  FEATURE 1  Pocket Dump            — POST /api/upload
  FEATURE 2  Omni-Search RAG        — POST /api/search
  FEATURE 3  Mock Exam Engine       — POST /api/generate-exam
  FEATURE 4  Gamification           — POST /api/award-xp
                                    — GET  /api/leaderboard
                                    — GET  /api/users/{user_id}
  FEATURE 5  Calendar Agent         — GET  /api/rooms/{room_code}/calendar
                                    — POST /api/rooms/{room_code}/calendar
  FEATURE 6  Flashcard Generation   — POST /api/nodes/{node_id}/flashcards
  FEATURE 7  WebSocket Collab       — WS   /ws/room/{room_code}
"""

import asyncio
import io
import json as _json
import os
import secrets
from pathlib import Path
import random

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")
import string
import time
import uuid
import jwt
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Optional

import google.generativeai as genai
import PyPDF2
from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from models import (
    Base,
    CalendarEvent,
    Flashcard,
    GraphEdge,
    GraphNode,
    UploadedDocument,
    User,
    WorkspaceRoom,
)

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

ASYNC_DATABASE_URL: str = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:password@localhost:5432/aethergraph",
)
SYNC_DATABASE_URL: str = os.getenv(
    "SYNC_DATABASE_URL",
    "postgresql://postgres:password@localhost:5432/aethergraph",
)
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "your-gemini-api-key-placeholder")
GEMINI_EMBED_MODEL: str = "models/gemini-embedding-001"
GEMINI_CHAT_MODEL: str = os.getenv("GEMINI_CHAT_MODEL", "gemini-2.5-flash")

# ─────────────────────────────────────────────────────────────────────────────
# Gemini SDK initialisation
# ─────────────────────────────────────────────────────────────────────────────

genai.configure(api_key=GEMINI_API_KEY)

# Reusable synthesis model (RAG answers)
_chat_model = genai.GenerativeModel(
    model_name=GEMINI_CHAT_MODEL,
    system_instruction=(
        "You are AetherGraph's knowledge synthesis engine. "
        "You receive retrieved context chunks from a user's personal knowledge graph. "
        "Answer the question concisely and accurately, citing source numbers "
        "(e.g. [Source 1]). If the answer is not present in the context, "
        "say so explicitly rather than hallucinating."
    ),
)

# ─────────────────────────────────────────────────────────────────────────────
# Embedding helpers (synchronous — correct for thread-pool context)
# ─────────────────────────────────────────────────────────────────────────────


def _embed_document(content: str) -> List[float]:
    result = genai.embed_content(
        model=GEMINI_EMBED_MODEL,
        content=content,
        task_type="retrieval_document",
        output_dimensionality=768,
    )
    return result["embedding"]


def _embed_query(content: str) -> List[float]:
    result = genai.embed_content(
        model=GEMINI_EMBED_MODEL,
        content=content,
        task_type="retrieval_query",
        output_dimensionality=768,
    )
    return result["embedding"]


# ─────────────────────────────────────────────────────────────────────────────
# Gamification helpers
# ─────────────────────────────────────────────────────────────────────────────


def _calculate_level(xp: int) -> int:
    """Level 1 = 0–999 XP, Level 2 = 1000–1999 XP, …"""
    return 1 + (xp // 1000)


def _xp_in_level(xp: int) -> int:
    """XP accumulated within the current level (0–999)."""
    return xp % 1000


def _xp_to_next_level(xp: int) -> int:
    """XP still needed to reach the next level."""
    return (_calculate_level(xp) * 1000) - xp


# ─────────────────────────────────────────────────────────────────────────────
# Database engines
# ─────────────────────────────────────────────────────────────────────────────

async_engine = create_async_engine(ASYNC_DATABASE_URL, echo=False, pool_pre_ping=True)
AsyncSessionLocal = sessionmaker(
    async_engine, class_=AsyncSession, expire_on_commit=False
)

sync_engine = create_engine(SYNC_DATABASE_URL, pool_pre_ping=True)
SyncSessionLocal = sessionmaker(sync_engine, expire_on_commit=False)

# ─────────────────────────────────────────────────────────────────────────────
# App lifespan — schema creation + safe column migrations
# ─────────────────────────────────────────────────────────────────────────────

# ADD COLUMN IF NOT EXISTS is idempotent — safe on databases that predate a
# feature.  New tables (calendar_events, flashcards) are handled by create_all.
_COLUMN_MIGRATIONS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS xp          INTEGER   NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS level       INTEGER   NOT NULL DEFAULT 1",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_days INTEGER   NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TIMESTAMP",
    "ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS document_id UUID",
    "ALTER TABLE graph_nodes ALTER COLUMN embedding TYPE vector(768)",
    "ALTER TABLE uploaded_documents ADD COLUMN IF NOT EXISTS color VARCHAR(50)",
]


_main_loop = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _main_loop
    _main_loop = asyncio.get_running_loop()
    async with async_engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        # create_all is idempotent — skips tables that already exist
        await conn.run_sync(Base.metadata.create_all)
        for stmt in _COLUMN_MIGRATIONS:
            await conn.execute(text(stmt))
    yield
    await async_engine.dispose()


app = FastAPI(
    title="AetherGraph API",
    version="1.3.0",
    description=(
        "GraphRAG workspace — Pocket Dump · Omni-Search · Mock Exam Engine · "
        "Gamification · Calendar Agent · Flashcards · WebSocket Collab (Gemini free tier)"
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────────────────────────────────────
# DB dependency
# ─────────────────────────────────────────────────────────────────────────────


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


SUPABASE_JWT_SECRET: str = os.getenv("SUPABASE_JWT_SECRET", "placeholder")
security = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> uuid.UUID:
    token = credentials.credentials
    try:
        header = jwt.get_unverified_header(token)
        payload = jwt.decode(token, options={"verify_signature": False})
        user_id_str = payload.get("sub")
        email = payload.get("email", "unknown@example.com")
        if not user_id_str:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        user_id = uuid.UUID(user_id_str)
        
        # Sync logic
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            new_user = User(
                id=user_id,
                email=email,
                username=email.split("@")[0],
                hashed_password="oauth",
                xp=0,
                level=1,
                streak_days=0
            )
            db.add(new_user)
            await db.commit()

        return user_id
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Auth error: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schemas — Core
# ─────────────────────────────────────────────────────────────────────────────


class WorkspaceCreate(BaseModel):
    name: str
    description: Optional[str] = None


class WorkspaceOut(BaseModel):
    id: str
    name: str
    description: Optional[str]
    access_code: str

    model_config = {"from_attributes": True}


class NodeCreate(BaseModel):
    workspace_id: str
    label: str
    content: str
    node_type: str = "concept"
    position_x: float = 0.0
    position_y: float = 0.0


class NodeOut(BaseModel):
    id: str
    label: str
    content: str
    node_type: str
    unlocked: bool
    position_x: float
    position_y: float
    document_id: Optional[str] = None
    color: Optional[str] = None

    model_config = {"from_attributes": True}


class EdgeCreate(BaseModel):
    workspace_id: str
    source_node_id: str
    target_node_id: str
    relationship_label: Optional[str] = None
    weight: float = 1.0


class SearchQuery(BaseModel):
    query: str
    workspace_id: str
    top_k: int = 5
    synthesize: bool = True


class SearchResult(BaseModel):
    node_id: str
    label: str
    content: str
    similarity: float
    node_type: str


class SearchResponse(BaseModel):
    results: List[SearchResult]
    synthesized_answer: Optional[str]
    query: str


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schemas — Exam Engine (FEATURE 3)
# ─────────────────────────────────────────────────────────────────────────────


class ExamQuestion(BaseModel):
    question: str
    options: List[str]   # exactly 4 items
    correct_index: int   # 0-based index into options
    explanation: str     # why the correct answer is correct


class ExamSchema(BaseModel):
    title: str
    topic: str
    questions: List[ExamQuestion]


class GenerateExamRequest(BaseModel):
    workspace_id: str
    topic: Optional[str] = None
    num_questions: int = 5
    difficulty: str = "medium"   # "easy" | "medium" | "hard"


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schemas — Gamification (FEATURE 4)
# ─────────────────────────────────────────────────────────────────────────────


class AwardXPRequest(BaseModel):
    xp_amount: int
    reason: str = "exam_completion"


class AwardXPResponse(BaseModel):
    user_id: str
    new_xp: int
    new_level: int
    xp_in_level: int
    xp_to_next_level: int
    leveled_up: bool
    streak_days: int


class LeaderboardEntry(BaseModel):
    rank: int
    user_id: str
    username: str
    xp: int
    level: int
    streak_days: int
    xp_in_level: int


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schemas — Calendar (FEATURE 5)
# ─────────────────────────────────────────────────────────────────────────────


class CalendarEventCreate(BaseModel):
    title: str
    due_date: Optional[str] = None   # "YYYY-MM-DD" or None
    description: Optional[str] = None


class CalendarEventOut(BaseModel):
    id: str
    title: str
    due_date: Optional[str]
    description: Optional[str]
    created_at: str


# Internal-only schemas for Gemini structured output — not exposed in the API
class _CalEventRaw(BaseModel):
    title: str
    due_date: str        # "YYYY-MM-DD" or empty string if undetermined
    description: str


class _CalExtractSchema(BaseModel):
    events: List[_CalEventRaw]


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schemas — Flashcards (FEATURE 6)
# ─────────────────────────────────────────────────────────────────────────────


class FlashcardItem(BaseModel):
    front_text: str
    back_text: str


class FlashcardsSchema(BaseModel):
    cards: List[FlashcardItem]


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schemas — Document Management (FEATURE 8)
# ─────────────────────────────────────────────────────────────────────────────


class DocumentOut(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    filename: str
    file_size: int
    file_type: str
    status: str
    node_count: int
    color: Optional[str] = None
    uploaded_at: datetime

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────────────────────────
# Module-level Gemini structured-output models
# (defined once — GenerationConfig is applied at construction time)
# ─────────────────────────────────────────────────────────────────────────────

# Exam generation — guarantees ExamSchema shape
_exam_gen_model = genai.GenerativeModel(
    model_name=GEMINI_CHAT_MODEL,
    generation_config=genai.GenerationConfig(
        response_mime_type="application/json",
        response_schema=ExamSchema,
    ),
)

# Flashcard generation — guarantees FlashcardsSchema shape
_flashcard_gen_model = genai.GenerativeModel(
    model_name=GEMINI_CHAT_MODEL,
    generation_config=genai.GenerationConfig(
        response_mime_type="application/json",
        response_schema=FlashcardsSchema,
    ),
)

# Calendar event extraction — guarantees _CalExtractSchema shape
_calendar_extract_model = genai.GenerativeModel(
    model_name=GEMINI_CHAT_MODEL,
    generation_config=genai.GenerationConfig(
        response_mime_type="application/json",
        response_schema=_CalExtractSchema,
    ),
)


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 7 — WebSocket ConnectionManager
# ─────────────────────────────────────────────────────────────────────────────


class ConnectionManager:
    """
    In-memory registry of active WebSocket connections grouped by room_code.
    Each workspace's access_code is used as the room_code key.
    Thread-safe for asyncio: all mutations happen on the event-loop thread.
    """

    def __init__(self) -> None:
        self._rooms: dict[str, list[WebSocket]] = {}

    async def connect(self, ws: WebSocket, room_code: str) -> int:
        """Accept the connection and register it.  Returns the new room size."""
        await ws.accept()
        self._rooms.setdefault(room_code, []).append(ws)
        return len(self._rooms[room_code])

    def disconnect(self, ws: WebSocket, room_code: str) -> int:
        """Remove the connection.  Returns the remaining room size."""
        room = self._rooms.get(room_code, [])
        if ws in room:
            room.remove(ws)
        if not room:
            self._rooms.pop(room_code, None)
        return len(self._rooms.get(room_code, []))

    async def broadcast(
        self,
        room_code: str,
        message: dict,
        exclude: Optional[WebSocket] = None,
    ) -> None:
        """
        Send `message` (JSON-serialised) to every connection in `room_code`
        except `exclude`.  Silently drops dead connections.
        """
        payload = _json.dumps(message)
        dead: list[WebSocket] = []
        for conn in list(self._rooms.get(room_code, [])):
            if conn is exclude:
                continue
            try:
                await conn.send_text(payload)
            except Exception:
                dead.append(conn)
        for conn in dead:
            self.disconnect(conn, room_code)

    def room_size(self, room_code: str) -> int:
        return len(self._rooms.get(room_code, []))


_ws_manager = ConnectionManager()


# ─────────────────────────────────────────────────────────────────────────────
# Utility — text extraction and chunking
# ─────────────────────────────────────────────────────────────────────────────


def _extract_text(content: bytes, filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext == "pdf":
        reader = PyPDF2.PdfReader(io.BytesIO(content))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages).strip()
    return content.decode("utf-8", errors="replace").strip()


def _chunk_text(raw: str, chunk_size: int = 400, overlap: int = 60) -> List[str]:
    words = raw.split()
    chunks: List[str] = []
    i = 0
    while i < len(words):
        segment = " ".join(words[i : i + chunk_size])
        if segment.strip():
            chunks.append(segment)
        i += chunk_size - overlap
    return chunks


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 1 — Pocket Dump background worker (sync, runs in threadpool)
# ─────────────────────────────────────────────────────────────────────────────


def _ingest_file(file_content: bytes, filename: str, workspace_id: str, doc_id: str) -> None:
    raw_text = _extract_text(file_content, filename)
    if not raw_text:
        print(f"[Pocket Dump] {filename!r} - no extractable text, skipping.")
        with SyncSessionLocal() as db:
            try:
                doc = db.query(UploadedDocument).filter(UploadedDocument.id == uuid.UUID(doc_id)).first()
                if doc:
                    doc.status = "failed"
                    db.commit()
            except Exception as exc:
                db.rollback()
                print(f"[Pocket Dump] Failed to update document record to failed: {exc}")
        return

    chunks = _chunk_text(raw_text)
    total = len(chunks)
    print(f"[Pocket Dump] {filename!r} -> {total} chunks")

    with SyncSessionLocal() as db:
        try:
            # Query existing document record
            doc = db.query(UploadedDocument).filter(UploadedDocument.id == uuid.UUID(doc_id)).first()
            if not doc:
                file_ext = filename.split(".")[-1].lower() if "." in filename else "unknown"
                tail_colors = ["#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e", "#06b6d4", "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#f43f5e"]
                doc_color = random.choice(tail_colors)
                doc = UploadedDocument(
                    id=uuid.UUID(doc_id),
                    workspace_id=uuid.UUID(workspace_id),
                    filename=filename,
                    file_size=len(file_content),
                    file_type=file_ext,
                    status="processing",
                    node_count=0,
                    color=doc_color,
                )
                db.add(doc)
                db.commit()
            
            # Query max y position to prevent overlapping multiple documents
            max_y_result = db.execute(
                text("SELECT MAX(position_y) FROM graph_nodes WHERE workspace_id = cast(:wid AS uuid)"),
                {"wid": workspace_id}
            ).scalar()
            start_y = float(max_y_result or 0.0)
            if start_y > 0:
                start_y += 350.0

            doc_offset_x = float(random.randint(-150, 150))
            doc_offset_y = float(random.randint(-100, 100))

            actual_nodes = 0
            # Create nodes
            for i, chunk in enumerate(chunks):
                try:
                    embedding_vector: Optional[List[float]] = _embed_document(chunk)
                except Exception as embed_err:
                    print(f"[Pocket Dump] Embed error chunk {i + 1}/{total}: {embed_err}")
                    embedding_vector = None

                words = [w.strip(".,!?()[]{}") for w in chunk.split()]
                words = [w for w in words if w and len(w) > 3]
                title = " ".join(words[:5]).title()
                label = f"{title}..." if title else f"{filename} part {i+1}"

                is_duplicate = False
                closest_nodes = []

                # Similarity check BEFORE creating node
                if embedding_vector:
                    try:
                        vec_literal = "[" + ",".join(f"{v:.8f}" for v in embedding_vector) + "]"
                        closest_nodes_rows = db.execute(
                            text("""
                                SELECT id, label, content, 1 - (embedding <=> cast(:vec AS vector)) AS similarity
                                FROM graph_nodes
                                WHERE workspace_id = cast(:wid AS uuid)
                                  AND embedding IS NOT NULL
                                ORDER BY embedding <=> cast(:vec AS vector)
                                LIMIT 2
                            """),
                            {
                                "vec": vec_literal,
                                "wid": workspace_id,
                            }
                        ).fetchall()

                        if closest_nodes_rows:
                            if closest_nodes_rows[0].similarity > 0.90:
                                is_duplicate = True
                                # Append provenance to existing node
                                db.execute(
                                    text("""
                                        UPDATE graph_nodes 
                                        SET content = content || '\n\n[Also appears in Document: ' || :doc_id || ']'
                                        WHERE id = :nid
                                    """),
                                    {"doc_id": filename, "nid": closest_nodes_rows[0].id}
                                )
                                print(f"[Pocket Dump] Skipped chunk (duplicate similarity {closest_nodes_rows[0].similarity:.4f}). Appended to {closest_nodes_rows[0].id}")
                            else:
                                for row in closest_nodes_rows:
                                    if row.similarity > 0.75:
                                        closest_nodes.append(row)
                    except Exception as sim_err:
                        print(f"[Pocket Dump] Similarity check failed: {sim_err}")

                if not is_duplicate:
                    new_node_id = uuid.uuid4()
                    
                    # Compute spatial layout relative to neighbor
                    if closest_nodes:
                        parent_row = db.execute(
                            text("SELECT position_x, position_y FROM graph_nodes WHERE id = :nid"),
                            {"nid": closest_nodes[0].id}
                        ).first()
                        if parent_row:
                            base_x = parent_row.position_x
                            base_y = parent_row.position_y
                        else:
                            base_x = float((i % 8) * 340) + doc_offset_x
                            base_y = start_y + float((i // 8) * 220) + doc_offset_y
                            
                        dx = random.uniform(200, 350) * random.choice([1, -1])
                        dy = random.uniform(100, 250) * random.choice([1, -1])
                        final_x = base_x + dx
                        final_y = base_y + dy
                    else:
                        final_x = float((i % 8) * 340) + doc_offset_x
                        final_y = start_y + float((i // 8) * 220) + doc_offset_y

                    db.add(
                        GraphNode(
                            id=new_node_id,
                            workspace_id=uuid.UUID(workspace_id),
                            document_id=uuid.UUID(doc_id),
                            label=label,
                            content=chunk,
                            node_type="document",
                            embedding=embedding_vector,
                            unlocked=True,
                            position_x=final_x,
                            position_y=final_y,
                        )
                    )
                    actual_nodes += 1

                    for c_node in closest_nodes:
                        # Create cross-document connection edge
                        db.add(
                            GraphEdge(
                                id=uuid.uuid4(),
                                workspace_id=uuid.UUID(workspace_id),
                                source_node_id=uuid.UUID(str(c_node.id)),
                                target_node_id=new_node_id,
                                relationship_label="Highly Related",
                                weight=float(c_node.similarity)
                            )
                        )
                        print(f"[Pocket Dump] Linked node {new_node_id} to existing node {c_node.id} (similarity: {c_node.similarity:.4f})")

                time.sleep(0.12)   # respect 1,500 RPM free-tier ceiling

            # Update document status and node count
            doc.status = "completed"
            doc.node_count = actual_nodes
            
            # Retrieve room_code for WebSocket broadcast before committing
            ws_room = db.query(WorkspaceRoom).filter(WorkspaceRoom.id == uuid.UUID(workspace_id)).first()
            room_code = ws_room.access_code if ws_room else None
            
            db.commit()
            print(f"[Pocket Dump] OK {total} nodes committed for {filename!r}")
            
            # Broadcast websocket update
            if room_code and _main_loop is not None:
                asyncio.run_coroutine_threadsafe(
                    _ws_manager.broadcast(room_code, {"type": "nodes_refreshed"}),
                    _main_loop
                )
        except Exception as exc:
            db.rollback()
            print(f"[Pocket Dump] DB error for {filename!r}: {exc}")
            # Try to update document status to failed
            try:
                doc.status = "failed"
                db.commit()
            except:
                pass


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 5 — Calendar Agent background worker (sync, runs in threadpool)
#
# Extracts implicit deadlines/milestones from uploaded documents using Gemini
# structured output, then persists them as CalendarEvent rows.
# ─────────────────────────────────────────────────────────────────────────────


def _extract_calendar_events_bg(
    file_content: bytes, filename: str, workspace_id: str, user_id: uuid.UUID
) -> None:
    """Parse a document for date-bearing events and save them to the DB."""
    raw_text = _extract_text(file_content, filename)
    if not raw_text.strip():
        return

    # Limit to first ~2 000 words to stay within token budget
    sample = " ".join(raw_text.split()[:2000])

    import datetime
    current_year = datetime.datetime.now().year

    prompt = (
        "Analyze the following document excerpt and extract ANY explicit or implicit "
        "events, deadlines, appointments, timeline milestones, or important dates. "
        "Be highly lenient. If a date or timeline is mentioned, extract it.\n\n"
        f"Context: Assume the current year is {current_year}.\n"
        f"Document filename: {filename!r}\n\n"
        f"Content:\n{sample}\n\n"
        "For each event: title should be concise (under 60 chars), "
        "due_date must be a string in YYYY-MM-DD format (infer the year if missing). "
        "description should explain the event in one sentence."
    )

    try:
        response = _calendar_extract_model.generate_content(prompt)
        extracted = _CalExtractSchema.model_validate_json(response.text.strip())
    except Exception as exc:
        print(f"[Calendar Agent] Extract error for {filename!r}: {exc}")
        return

    if not extracted.events:
        print(f"[Calendar Agent] No events found in {filename!r}.")
        return

    with SyncSessionLocal() as db:
        saved = 0
        try:
            for evt in extracted.events:
                due_dt: Optional[datetime] = None
                if evt.due_date:
                    try:
                        due_dt = datetime.strptime(evt.due_date, "%Y-%m-%d")
                    except ValueError:
                        pass

                db.add(
                    CalendarEvent(
                        id=uuid.uuid4(),
                        user_id=user_id,
                        room_id=uuid.UUID(workspace_id),
                        title=evt.title[:255],
                        due_date=due_dt,
                        description=evt.description or None,
                    )
                )
                saved += 1
            db.commit()
            print(f"[Calendar Agent] OK {saved} events saved from {filename!r}")
        except Exception as exc:
            db.rollback()
            print(f"[Calendar Agent] DB error for {filename!r}: {exc}")


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 1 endpoint — POST /api/upload
# ─────────────────────────────────────────────────────────────────────────────


@app.post("/api/upload", status_code=202)
async def pocket_dump(
    background_tasks: BackgroundTasks,
    workspace_id: str = Form(...),
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user),
):
    queued = []
    for upload in files:
        raw_bytes = await upload.read()
        fname = upload.filename or "unnamed"
        doc_id = uuid.uuid4()
        
        # Immediately save a row to this table before triggering background ingestion
        file_ext = fname.split(".")[-1].lower() if "." in fname else "unknown"
        doc = UploadedDocument(
            id=doc_id,
            workspace_id=uuid.UUID(workspace_id),
            filename=fname,
            file_size=len(raw_bytes),
            file_type=file_ext,
            status="processing",
            node_count=0
        )
        db.add(doc)
        await db.commit()

        # Embedding + node creation
        background_tasks.add_task(_ingest_file, raw_bytes, fname, workspace_id, str(doc_id))
        # Calendar event extraction (runs concurrently with ingestion)
        background_tasks.add_task(
            _extract_calendar_events_bg, raw_bytes, fname, workspace_id, user_id
        )
        queued.append(
            {"filename": fname, "size_bytes": len(raw_bytes), "status": "queued"}
        )
    return {
        "status": "accepted",
        "queued_count": len(queued),
        "files": queued,
        "message": "Processing via Gemini: node embeddings + calendar extraction.",
    }


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 8 — Document Management  GET /api/documents, DELETE /api/documents/{id}
# ─────────────────────────────────────────────────────────────────────────────


@app.get("/api/workspaces/{workspace_id}/documents", response_model=List[DocumentOut])
async def list_workspace_documents(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
):
    """List all documents for a workspace."""
    result = await db.execute(
        select(UploadedDocument)
        .where(UploadedDocument.workspace_id == uuid.UUID(workspace_id))
        .order_by(UploadedDocument.uploaded_at.desc())
    )
    documents = result.scalars().all()
    return documents


@app.delete("/api/workspaces/{workspace_id}/documents/{file_id}")
async def delete_workspace_document(
    workspace_id: str,
    file_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a document and all its associated nodes and edges using document_id.
    """
    doc = await db.execute(
        select(UploadedDocument).where(
            UploadedDocument.id == uuid.UUID(file_id),
            UploadedDocument.workspace_id == uuid.UUID(workspace_id)
        )
    )
    doc_obj = doc.scalar_one_or_none()
    
    if not doc_obj:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Delete all edges that were created from this document's nodes
    await db.execute(
        text("""
            DELETE FROM graph_edges
            WHERE source_node_id IN (
                SELECT id FROM graph_nodes
                WHERE document_id = :doc_id
            )
            OR target_node_id IN (
                SELECT id FROM graph_nodes
                WHERE document_id = :doc_id
            )
        """),
        {"doc_id": uuid.UUID(file_id)}
    )
    
    # Delete all nodes belonging to this document
    await db.execute(
        text("""
            DELETE FROM graph_nodes
            WHERE document_id = :doc_id
        """),
        {"doc_id": uuid.UUID(file_id)}
    )
    
    # Delete the document record
    await db.delete(doc_obj)
    await db.commit()
    
    # Broadcast nodes_refreshed to clients in the room
    ws_room = await db.execute(
        select(WorkspaceRoom).where(WorkspaceRoom.id == uuid.UUID(workspace_id))
    )
    ws_room_obj = ws_room.scalar_one_or_none()
    if ws_room_obj and _main_loop is not None:
        await _ws_manager.broadcast(ws_room_obj.access_code, {"type": "nodes_refreshed"})
        
    return {"status": "deleted", "document_id": file_id}


@app.get("/api/workspaces/code/{access_code}", response_model=WorkspaceOut)
async def get_workspace_by_code(access_code: str, db: AsyncSession = Depends(get_db)):
    """Look up a workspace room by its alphanumeric join access code."""
    result = await db.execute(
        select(WorkspaceRoom).where(WorkspaceRoom.access_code == access_code.upper())
    )
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace room not found")
    return WorkspaceOut(
        id=str(workspace.id),
        name=workspace.name,
        description=workspace.description,
        access_code=workspace.access_code,
    )


# Legacy endpoints for fallback support
@app.get("/api/documents", response_model=List[DocumentOut])
async def list_documents(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Legacy endpoint to list all documents for a workspace."""
    return await list_workspace_documents(workspace_id, db)


@app.delete("/api/documents/{document_id}")
async def delete_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Legacy endpoint to delete a document."""
    doc = await db.execute(
        select(UploadedDocument).where(UploadedDocument.id == uuid.UUID(document_id))
    )
    doc_obj = doc.scalar_one_or_none()
    if not doc_obj:
        raise HTTPException(status_code=404, detail="Document not found")
    return await delete_workspace_document(str(doc_obj.workspace_id), document_id, db)


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 2 — Omni-Search RAG  POST /api/search
# ─────────────────────────────────────────────────────────────────────────────


@app.post("/api/search", response_model=SearchResponse)
async def omni_search(payload: SearchQuery, db: AsyncSession = Depends(get_db)):
    try:
        query_vec: List[float] = await asyncio.to_thread(_embed_query, payload.query)
        print(f"[Search API] Generated query embedding of length {len(query_vec)}")
    except Exception as exc:
        import traceback
        print(f"[Search API] Embedding generation failed for query {payload.query!r}: {exc}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Embedding query failed: {exc}")

    vec_literal = "[" + ",".join(f"{v:.8f}" for v in query_vec) + "]"

    rows = (
        await db.execute(
            text(
                """
                SELECT id::text AS node_id, label, content, node_type,
                       1 - (embedding <=> cast(:vec AS vector)) AS similarity
                FROM   graph_nodes
                WHERE  workspace_id = cast(:wid AS uuid)
                  AND  embedding IS NOT NULL
                ORDER  BY embedding <=> cast(:vec AS vector)
                LIMIT  :top_k
                """
            ),
            {"vec": vec_literal, "wid": payload.workspace_id, "top_k": payload.top_k},
        )
    ).fetchall()

    search_results = [
        SearchResult(
            node_id=r.node_id, label=r.label, content=r.content,
            similarity=float(r.similarity), node_type=r.node_type,
        )
        for r in rows
    ]

    synthesized_answer: Optional[str] = None
    if payload.synthesize:
        if not search_results:
            synthesized_answer = "No source documents found in this workspace. Please upload some files first."
        else:
            ctx = "\n\n---\n\n".join(
                f"[Source {i + 1}: {r.label}]\n{r.content}"
                for i, r in enumerate(search_results)
            )
            try:
                response = await asyncio.to_thread(
                    _chat_model.generate_content,
                    f"Retrieved context:\n\n{ctx}\n\n---\n\nQuestion: {payload.query}",
                )
                synthesized_answer = response.text
            except Exception as exc:
                import traceback
                print(f"[Search API] Gemini API Generation Failed: {exc}")
                traceback.print_exc()
                synthesized_answer = f"[Synthesis unavailable: {exc}]"

    return SearchResponse(
        results=search_results, synthesized_answer=synthesized_answer, query=payload.query
    )


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 3 — Mock Exam Engine  POST /api/generate-exam
# ─────────────────────────────────────────────────────────────────────────────


@app.post("/api/generate-exam")
async def generate_exam(
    payload: GenerateExamRequest, db: AsyncSession = Depends(get_db)
):
    # Step 1: Retrieve context
    if payload.topic:
        query_vec = await asyncio.to_thread(_embed_query, payload.topic)
        vec_literal = "[" + ",".join(f"{v:.8f}" for v in query_vec) + "]"
        sql_rows = (
            await db.execute(
                text(
                    """
                    SELECT label, content
                    FROM   graph_nodes
                    WHERE  workspace_id = cast(:wid AS uuid)
                      AND  embedding IS NOT NULL
                    ORDER  BY embedding <=> cast(:vec AS vector)
                    LIMIT  8
                    """
                ),
                {"vec": vec_literal, "wid": payload.workspace_id},
            )
        ).fetchall()
        context_chunks = [f"[{r.label}]\n{r.content}" for r in sql_rows]
    else:
        orm_rows = (
            await db.execute(
                select(GraphNode)
                .where(GraphNode.workspace_id == uuid.UUID(payload.workspace_id))
                .where(GraphNode.unlocked == True)
                .order_by(GraphNode.created_at.desc())
                .limit(8)
            )
        ).scalars().all()
        context_chunks = [f"[{n.label}]\n{n.content}" for n in orm_rows]

    if not context_chunks:
        raise HTTPException(
            status_code=400,
            detail=(
                "No content found in this workspace. "
                "Use Pocket Dump to upload documents first."
            ),
        )

    context_text = "\n\n---\n\n".join(context_chunks)
    topic_str = payload.topic or "the general concepts present in the content"

    prompt = (
        f"You are an expert educator generating a quiz. "
        f"Based ONLY on the following knowledge base content, create a "
        f"{payload.difficulty} difficulty multiple-choice exam with exactly "
        f"{payload.num_questions} questions about: {topic_str}.\n\n"
        f"Knowledge base:\n\n{context_text}\n\n"
        f"Hard requirements:\n"
        f"- Each question must have EXACTLY 4 answer options.\n"
        f"- correct_index must be an integer 0, 1, 2, or 3.\n"
        f"- All questions must be answerable from the provided content.\n"
        f"- Explanations must cite the source material.\n"
        f"- Generate EXACTLY {payload.num_questions} questions.\n"
        f"- Vary between recall, comprehension, and application questions."
    )

    try:
        response = await asyncio.to_thread(_exam_gen_model.generate_content, prompt)
        exam_data = ExamSchema.model_validate_json(response.text.strip())
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Gemini exam generation failed: {exc}",
        )

    valid_questions: List[ExamQuestion] = []
    for q in exam_data.questions:
        if len(q.options) < 2:
            continue
        if not (0 <= q.correct_index < len(q.options)):
            q = q.model_copy(update={"correct_index": 0})
        valid_questions.append(q)

    if not valid_questions:
        raise HTTPException(
            status_code=500,
            detail="Exam generation produced no valid questions. Try a more specific topic.",
        )

    return {
        "exam_id": str(uuid.uuid4()),
        "title": exam_data.title,
        "topic": exam_data.topic,
        "questions": [q.model_dump() for q in valid_questions],
        "workspace_id": payload.workspace_id,
        "difficulty": payload.difficulty,
        "num_questions": len(valid_questions),
    }


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 4 — Gamification
# ─────────────────────────────────────────────────────────────────────────────


@app.post("/api/award-xp", response_model=AwardXPResponse)
async def award_xp(
    payload: AwardXPRequest, 
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user)
):
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    old_level = user.level

    user.xp += payload.xp_amount
    user.level = _calculate_level(user.xp)

    now = datetime.utcnow()
    if user.last_active is not None:
        delta_days = (now.date() - user.last_active.date()).days
        if delta_days == 0:
            pass
        elif delta_days == 1:
            user.streak_days += 1
        else:
            user.streak_days = 1
    else:
        user.streak_days = 1

    user.last_active = now

    await db.commit()
    await db.refresh(user)

    return AwardXPResponse(
        user_id=str(user.id),
        new_xp=user.xp,
        new_level=user.level,
        xp_in_level=_xp_in_level(user.xp),
        xp_to_next_level=_xp_to_next_level(user.xp),
        leveled_up=(user.level > old_level),
        streak_days=user.streak_days,
    )


@app.get("/api/leaderboard", response_model=List[LeaderboardEntry])
async def get_leaderboard(limit: int = 10, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User).order_by(User.xp.desc()).limit(limit)
    )
    users = result.scalars().all()
    return [
        LeaderboardEntry(
            rank=i + 1,
            user_id=str(u.id),
            username=u.username,
            xp=u.xp,
            level=u.level,
            streak_days=u.streak_days,
            xp_in_level=_xp_in_level(u.xp),
        )
        for i, u in enumerate(users)
    ]


@app.get("/api/users/me")
async def get_my_stats(
    user_id: uuid.UUID = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": str(user.id),
        "username": user.username,
        "xp": user.xp,
        "level": user.level,
        "streak_days": user.streak_days,
        "xp_in_level": _xp_in_level(user.xp),
        "xp_to_next_level": _xp_to_next_level(user.xp),
        "last_active": user.last_active.isoformat() if user.last_active else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 5 — Calendar Agent API routes
# ─────────────────────────────────────────────────────────────────────────────


@app.get("/api/rooms/{room_code}/calendar", response_model=List[CalendarEventOut])
async def get_calendar(room_code: str, db: AsyncSession = Depends(get_db)):
    ws_result = await db.execute(
        select(WorkspaceRoom).where(WorkspaceRoom.access_code == room_code)
    )
    workspace = ws_result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=404, detail="Room not found")

    result = await db.execute(
        select(CalendarEvent)
        .where(CalendarEvent.room_id == workspace.id)
        .order_by(CalendarEvent.due_date.asc().nullslast())
    )
    events = result.scalars().all()
    return [
        CalendarEventOut(
            id=str(e.id),
            title=e.title,
            due_date=e.due_date.strftime("%Y-%m-%d") if e.due_date else None,
            description=e.description,
            created_at=e.created_at.isoformat(),
        )
        for e in events
    ]


@app.post(
    "/api/rooms/{room_code}/calendar",
    response_model=CalendarEventOut,
    status_code=201,
)
async def create_calendar_event(
    room_code: str,
    payload: CalendarEventCreate,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user),
):
    ws_result = await db.execute(
        select(WorkspaceRoom).where(WorkspaceRoom.access_code == room_code)
    )
    workspace = ws_result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=404, detail="Room not found")

    due_dt: Optional[datetime] = None
    if payload.due_date:
        try:
            due_dt = datetime.strptime(payload.due_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(
                status_code=422,
                detail="due_date must be YYYY-MM-DD format",
            )

    event = CalendarEvent(
        id=uuid.uuid4(),
        user_id=user_id,
        room_id=workspace.id,
        title=payload.title[:255],
        due_date=due_dt,
        description=payload.description,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)

    return CalendarEventOut(
        id=str(event.id),
        title=event.title,
        due_date=event.due_date.strftime("%Y-%m-%d") if event.due_date else None,
        description=event.description,
        created_at=event.created_at.isoformat(),
    )


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 6 — Flashcard Generation  POST /api/nodes/{node_id}/flashcards
#
# Architecture
# ────────────
# 1. Load the target node and its embedding from the async DB session.
# 2. Find the 3 most semantically similar sibling nodes (vector KNN) to
#    provide Gemini with richer context about the knowledge neighbourhood.
# 3. Build a structured prompt and call Gemini with response_schema=FlashcardsSchema.
# 4. Persist the generated cards to the flashcards table and return them.
# ─────────────────────────────────────────────────────────────────────────────


@app.post("/api/nodes/{node_id}/flashcards")
async def generate_flashcards(node_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(GraphNode).where(GraphNode.id == uuid.UUID(node_id))
    )
    node = result.scalar_one_or_none()
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")

    # Capture values before the session is potentially invalidated
    node_embedding = node.embedding
    node_content = node.content
    node_label = node.label
    workspace_id_str = str(node.workspace_id)

    # Retrieve neighbouring context via pgvector KNN
    context = ""
    if node_embedding is not None:
        vec_literal = "[" + ",".join(f"{v:.8f}" for v in node_embedding) + "]"
        sibling_rows = (
            await db.execute(
                text(
                    """
                    SELECT label, content
                    FROM   graph_nodes
                    WHERE  workspace_id = cast(:wid AS uuid)
                      AND  id           != cast(:nid AS uuid)
                      AND  embedding    IS NOT NULL
                    ORDER  BY embedding <=> cast(:vec AS vector)
                    LIMIT  3
                    """
                ),
                {"vec": vec_literal, "wid": workspace_id_str, "nid": node_id},
            )
        ).fetchall()
        if sibling_rows:
            context = "\n\n".join(f"[{r.label}]\n{r.content}" for r in sibling_rows)

    prompt = (
        "Generate active-recall flashcards for the following knowledge node.\n\n"
        f"Node title: {node_label}\n"
        f"Node content:\n{node_content}\n"
        + (f"\nRelated context from the same graph:\n{context}\n" if context else "")
        + "\nRequirements:\n"
        "- Generate between 4 and 8 flashcards.\n"
        "- front_text: a concise question or prompt that tests understanding.\n"
        "- back_text: a clear, complete answer derived from the content.\n"
        "- Vary types: definition recall, concept explanation, application, compare/contrast.\n"
        "- Do NOT copy sentences verbatim — rephrase into active-recall format.\n"
        "- Each card should be self-contained (no cross-card dependencies)."
    )

    try:
        response = await asyncio.to_thread(
            _flashcard_gen_model.generate_content, prompt
        )
        flashcards_data = FlashcardsSchema.model_validate_json(response.text.strip())
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Flashcard generation failed: {exc}",
        )

    if not flashcards_data.cards:
        raise HTTPException(
            status_code=500,
            detail="No flashcards were generated. Try an unlocked node with more content.",
        )

    saved: list[dict] = []
    for card in flashcards_data.cards:
        fc = Flashcard(
            id=uuid.uuid4(),
            node_id=uuid.UUID(node_id),
            front_text=card.front_text,
            back_text=card.back_text,
        )
        db.add(fc)
        saved.append({"id": str(fc.id), "front_text": fc.front_text, "back_text": fc.back_text})

    await db.commit()

    return {
        "node_id": node_id,
        "node_label": node_label,
        "cards": saved,
        "total": len(saved),
    }


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 7 — WebSocket Collaboration  WS /ws/room/{room_code}
#
# Message protocol (JSON):
#   Client → Server:
#     {type: "node_move", nodeId, x, y}   — canvas drag-stop
#     {type: "node_add",  node}            — new node created locally
#     {type: "chat",      text}            — room chat message
#     {type: "ping"}                       — keepalive
#
#   Server → Client:
#     {type: "connected",   room_code, room_size}   — welcome on connect
#     {type: "user_count",  count}                  — on join/leave
#     {type: "node_move",   nodeId, x, y}           — broadcast (others only)
#     {type: "node_add",    node}                   — broadcast (others only)
#     {type: "chat",        text, ts}               — broadcast (all)
#     {type: "pong"}                                — keepalive response
# ─────────────────────────────────────────────────────────────────────────────


@app.websocket("/ws/room/{room_code}")
async def websocket_room(websocket: WebSocket, room_code: str):
    size = await _ws_manager.connect(websocket, room_code)

    # Welcome the connecting client
    await websocket.send_text(
        _json.dumps({"type": "connected", "room_code": room_code, "room_size": size})
    )
    # Announce the new participant to everyone else
    await _ws_manager.broadcast(
        room_code, {"type": "user_count", "count": size}, exclude=websocket
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = _json.loads(raw)
            except Exception:
                continue   # drop malformed messages

            msg_type = msg.get("type")

            if msg_type == "node_move":
                await _ws_manager.broadcast(
                    room_code,
                    {
                        "type": "node_move",
                        "nodeId": msg.get("nodeId"),
                        "x": msg.get("x"),
                        "y": msg.get("y"),
                    },
                    exclude=websocket,
                )

            elif msg_type == "node_add":
                await _ws_manager.broadcast(
                    room_code,
                    {"type": "node_add", "node": msg.get("node")},
                    exclude=websocket,
                )

            elif msg_type == "node_delete":
                await _ws_manager.broadcast(
                    room_code,
                    {
                        "type": "node_delete",
                        "nodeId": msg.get("nodeId"),
                    },
                    exclude=websocket,
                )

            elif msg_type == "chat":
                # Chat broadcasts to ALL connections including the sender so
                # the sender sees their message reflected with a server timestamp.
                await _ws_manager.broadcast(
                    room_code,
                    {
                        "type": "chat",
                        "text": str(msg.get("text", ""))[:1000],
                        "ts": datetime.utcnow().isoformat(),
                    },
                )

            elif msg_type == "ping":
                await websocket.send_text(_json.dumps({"type": "pong"}))

    except WebSocketDisconnect:
        remaining = _ws_manager.disconnect(websocket, room_code)
        await _ws_manager.broadcast(
            room_code, {"type": "user_count", "count": remaining}
        )


# ─────────────────────────────────────────────────────────────────────────────
# Workspace CRUD
# ─────────────────────────────────────────────────────────────────────────────

_CODE_ALPHABET = string.ascii_uppercase + string.digits


def _generate_access_code(length: int = 12) -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(length))


async def _ensure_default_user(db: AsyncSession) -> None:
    result = await db.execute(select(User).where(User.id == _DEFAULT_USER_ID))
    if result.scalar_one_or_none() is None:
        db.add(
            User(
                id=_DEFAULT_USER_ID,
                email="default@aethergraph.local",
                username="default",
                hashed_password="__placeholder__",
                xp=0,
                level=1,
                streak_days=0,
            )
        )
        await db.commit()


@app.post("/api/workspaces", response_model=WorkspaceOut, status_code=201)
async def create_workspace(
    payload: WorkspaceCreate,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user)
):
    # await _ensure_default_user(db)
    workspace = WorkspaceRoom(
        id=uuid.uuid4(),
        name=payload.name,
        description=payload.description,
        access_code=_generate_access_code(),
        owner_id=user_id,
    )
    db.add(workspace)
    await db.commit()
    await db.refresh(workspace)
    return WorkspaceOut(
        id=str(workspace.id),
        name=workspace.name,
        description=workspace.description,
        access_code=workspace.access_code,
    )


@app.get("/api/workspaces", response_model=List[WorkspaceOut])
async def list_workspaces(
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user)
):
    result = await db.execute(
        select(WorkspaceRoom)
        .where(WorkspaceRoom.owner_id == user_id)
        .order_by(WorkspaceRoom.created_at.desc())
    )
    return [
        WorkspaceOut(
            id=str(w.id), name=w.name,
            description=w.description, access_code=w.access_code,
        )
        for w in result.scalars().all()
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Node CRUD
# ─────────────────────────────────────────────────────────────────────────────


@app.post("/api/nodes", response_model=NodeOut, status_code=201)
async def create_node(payload: NodeCreate, db: AsyncSession = Depends(get_db)):
    embedding_vector = await asyncio.to_thread(_embed_document, payload.content)
    node = GraphNode(
        id=uuid.uuid4(),
        workspace_id=uuid.UUID(payload.workspace_id),
        label=payload.label,
        content=payload.content,
        node_type=payload.node_type,
        embedding=embedding_vector,
        unlocked=False,
        position_x=payload.position_x,
        position_y=payload.position_y,
    )
    db.add(node)
    await db.commit()
    await db.refresh(node)
    return NodeOut(
        id=str(node.id), label=node.label, content=node.content,
        node_type=node.node_type, unlocked=node.unlocked,
        position_x=node.position_x, position_y=node.position_y,
    )


@app.get("/api/nodes/{workspace_id}", response_model=List[NodeOut])
async def list_nodes(workspace_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(GraphNode, UploadedDocument.color)
        .outerjoin(UploadedDocument, GraphNode.document_id == UploadedDocument.id)
        .where(GraphNode.workspace_id == uuid.UUID(workspace_id))
        .order_by(GraphNode.created_at)
    )
    return [
        NodeOut(
            id=str(n.id), label=n.label, content=n.content,
            node_type=n.node_type, unlocked=n.unlocked,
            position_x=n.position_x, position_y=n.position_y,
            document_id=str(n.document_id) if n.document_id else None,
            color=color
        )
        for n, color in result.all()
    ]


@app.patch("/api/nodes/{node_id}/unlock")
async def unlock_node(node_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(GraphNode).where(GraphNode.id == uuid.UUID(node_id))
    )
    node = result.scalar_one_or_none()
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    node.unlocked = True
    await db.commit()
    return {"id": node_id, "unlocked": True}


@app.delete("/api/nodes/{node_id}")
async def delete_node(node_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(GraphNode).where(GraphNode.id == uuid.UUID(node_id))
    )
    node = result.scalar_one_or_none()
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    
    workspace_id = node.workspace_id
    
    await db.delete(node)
    await db.commit()
    
    # Broadcast to websocket
    ws_room = await db.execute(
        select(WorkspaceRoom).where(WorkspaceRoom.id == workspace_id)
    )
    ws_room_obj = ws_room.scalar_one_or_none()
    if ws_room_obj and _main_loop is not None:
        await _ws_manager.broadcast(
            ws_room_obj.access_code,
            {"type": "node_delete", "nodeId": node_id}
        )
        
    return {"status": "deleted", "node_id": node_id}


# ─────────────────────────────────────────────────────────────────────────────
# Edge CRUD
# ─────────────────────────────────────────────────────────────────────────────


@app.post("/api/edges", status_code=201)
async def create_edge(payload: EdgeCreate, db: AsyncSession = Depends(get_db)):
    edge = GraphEdge(
        id=uuid.uuid4(),
        workspace_id=uuid.UUID(payload.workspace_id),
        source_node_id=uuid.UUID(payload.source_node_id),
        target_node_id=uuid.UUID(payload.target_node_id),
        relationship_label=payload.relationship_label,
        weight=payload.weight,
    )
    db.add(edge)
    await db.commit()
    return {"id": str(edge.id), "status": "created"}


@app.get("/api/edges/{workspace_id}")
async def list_edges(workspace_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(GraphEdge).where(GraphEdge.workspace_id == uuid.UUID(workspace_id))
    )
    return [
        {
            "id": str(e.id),
            "source": str(e.source_node_id),
            "target": str(e.target_node_id),
            "label": e.relationship_label,
            "weight": e.weight,
        }
        for e in result.scalars().all()
    ]


class PositionUpdatePayload(BaseModel):
    x: float
    y: float


@app.patch("/api/nodes/{node_id}/position")
async def update_node_position(
    node_id: str,
    payload: PositionUpdatePayload,
    db: AsyncSession = Depends(get_db),
):
    """Update a node's position coordinates."""
    result = await db.execute(
        select(GraphNode).where(GraphNode.id == uuid.UUID(node_id))
    )
    node = result.scalar_one_or_none()
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    node.position_x = payload.x
    node.position_y = payload.y
    await db.commit()
    return {"id": node_id, "position_x": payload.x, "position_y": payload.y}


# ─────────────────────────────────────────────────────────────────────────────
# Health check
# ─────────────────────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "aethergraph-api",
        "version": "1.3.0",
        "ai_backend": "google-gemini",
        "embed_model": GEMINI_EMBED_MODEL,
        "chat_model": GEMINI_CHAT_MODEL,
        "ws_rooms": len(_ws_manager._rooms),
    }
