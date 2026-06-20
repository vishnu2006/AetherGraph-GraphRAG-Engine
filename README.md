

```markdown
# AetherGraph

AetherGraph is a real-time collaborative GraphRAG workspace[cite: 1]. Users can upload documents, explore a semantic knowledge graph, search with AI synthesis, run mock exams, generate flashcards, track deadlines, and collaborate in real time[cite: 1].

**Stack:** FastAPI + PostgreSQL/pgvector | Next.js 14 + React Flow | Gemini free-tier AI[cite: 1]

---

## Table of Contents
1. System Architecture Overview
2. Step-by-Step Bootstrap Guide (Windows)
3. Environment Variable Dictionary
4. API Reference
5. AI Onboarding Context
6. Database Connection Verification
7. Troubleshooting

---

## 1. System Architecture Overview

### Frontend Architecture: Next.js 14 App Router (Browser port 3000)
* **Canvas.tsx:** React Flow Canvas handling node/edge rendering and drag-to-move interactions[cite: 1].
* **OmniSearch.tsx:** RAG search panel interface[cite: 1].
* **MockExam.tsx:** Dynamic quiz engine[cite: 1].
* **FlashcardDeck.tsx:** Active recall card generator and display[cite: 1].
* **CalendarPanel.tsx:** Deadline tracking system[cite: 1].
* **GamificationWidget.tsx & SyllabusTracker.tsx:** User XP, levels, streak monitoring, and content unlock gating[cite: 1].
* **lib/api.ts:** Typed HTTP client utilizing `NEXT_PUBLIC_API_URL` and runtime-derived WebSocket connections[cite: 1].

### Backend Architecture: FastAPI Backend (port 8000)
* **Async HTTP Layer (asyncio + asyncpg):** Manages non-blocking CRUD operations for workspaces, nodes, edges, user states, and real-time WebSocket orchestration[cite: 1].
* **Background Workers (FastAPI BackgroundTasks + psycopg2):** Offloads multi-modal document chunking/embedding (`_ingest_file()`) and date extractions (`_extract_calendar_events_bg()`) to a default thread-pool executor[cite: 1].
* **AI Engine:** Leverages the official Google Gemini SDK (`google-generativeai`) using `text-embedding-004` and `gemini-2.5-flash`[cite: 1].

### Database Layer: PostgreSQL 16+ pgvector (Docker port 5432)
* **Tables:** `users`, `workspace_rooms`, `graph_nodes`, `graph_edges`, `calendar_events`, `flashcards`[cite: 1].
* **Extensions:** `pgvector` utilized with the cosine distance operator (`<=>`)[cite: 1].
* **Volume:** `aethergraph_pgdata` to ensure persistence across container restarts[cite: 1].

### WebSocket State-Sync Flow
The frontend maintains a single persistent WebSocket per active workspace room[cite: 1]. The connection URL is derived automatically at runtime by protocol-swapping the REST base URL, preventing duplication[cite: 1]:
* **REST URL:** `http://localhost:8000` $\rightarrow$ **WebSocket URL:** `ws://localhost:8000/ws/room/{access_code}`[cite: 1]

The `ConnectionManager` class in `main.py` handles pure in-memory dictionary routing (`room_code` $\rightarrow$ `[WebSocket]`)[cite: 1]. Scaling past a single-process Uvicorn instance requires adding a Redis pub/sub layer[cite: 1].

---

## 2. Step-by-Step Bootstrap Guide (Windows)

### Prerequisites
Verify installations via your terminal using standard version check commands[cite: 1]:
* **Docker Desktop for Windows** (v4.x minimum)[cite: 1]
* **Python** (v3.11 minimum) -> *Crucial: Check "Add Python to PATH" on installer screen*[cite: 1]
* **Node.js** (v20 LTS minimum)[cite: 1]
* **Git** (Any version)[cite: 1]

### Step 1: Start PostgreSQL with pgvector via Docker
Ensure Docker Desktop is open and running in the background[cite: 1]. From the repository root root, run:
```powershell
docker compose up -d postgres

```

Wait 10–15 seconds for the database health check to pass (`STATUS` should show `healthy`). Schema definitions and database extensions are auto-created by FastAPI upon initial startup.

### Step 2: Set up the Python Virtual Environment

Navigate to the backend directory, initialize your environment, and activate it:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1

```

(If PowerShell returns an execution-policy error, run `Set-ExecutionPolicy ExecutionPolicy RemoteSigned -Scope CurrentUser` first, then retry activation).

### Step 3: Install Backend Dependencies & Configure Env

```powershell
pip install -r requirements.txt
copy .env.example .env

```

Open `backend\.env` in your text editor and append your Gemini key:

```text
GEMINI_API_KEY=your-actual-gemini-key-here

```

### Step 4: Launch the FastAPI Backend

```powershell
uvicorn main:app --reload --host 0.0.0.0 --port 8000

```

Verify the backend server is live by navigating to the interactive Swagger documentation at: `http://localhost:8000/docs`.

### Step 5: Install Frontend Dependencies & Launch

Open a **completely separate terminal window**, navigate to the frontend directory, configure the environment mapping, and launch the dev server:

```powershell
cd frontend
npm install
copy .env.local.example .env.local
npm run dev

```

Open your browser and navigate to `http://localhost:3000` to start testing the live canvas.

---

## 3. Environment Variable Dictionary

### `backend/.env`

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | **Yes** | placeholder | Obtained from Google AI Studio.

 |
| `DATABASE_URL` | No | `postgresql+asyncpg://postgres:password@localhost:5432/aethergraph` | Non-blocking async database connections.

 |
| `SYNC_DATABASE_URL` | No | `postgresql://postgres:password@localhost:5432/aethergraph` | Blocking sync connections for threadpool workers.

 |
| `GEMINI_CHAT_MODEL` | No | `gemini-2.5-flash` | Target model instance for conversational chat features.

 |

### `frontend/.env.local`

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | **Yes** | `http://localhost:8000` | Target Base REST URL for client fetches and client WS swaps.

 |

---

## 4. API Reference

### Core CRUD Operations

* `GET /api/workspaces` - List available workspace environments.


* `POST /api/workspaces` - Generate a unique workspace room code.


* `GET /api/nodes/{workspace_id}` - Fetch active graph nodes.


* `POST /api/nodes` - Inject a new knowledge coordinate block into the graph.


* `PATCH /api/nodes/{node_id}/unlock` - Toggle client opacity gating on a specific node.


* `GET /api/edges/{workspace_id}` - Retrieve graph edge linkages.


* `POST /api/edges` - Persist a structural graph edge.



### AI Integrated Modules

* `POST /api/upload` - Pocket Dump pipeline. Accepts document files and responds with a `202 Accepted` status while processing via async task threads.


* `POST /api/search` - GraphRAG search using localized cosine similarity filtering and generative synthesis.


* `POST /api/generate-exam` - Pulls underlying node text blocks to formulate structured JSON multiple-choice questions.


* `POST /api/nodes/{node_id}/flashcards` - Localized context generation yielding structured flashcard arrays.


* `GET/POST /api/rooms/{room_code}/calendar` - Query or extract contextual calendar schedules.



### Gamification & Sockets

* `POST /api/award-xp` | `GET /api/leaderboard` - Updates behavioral user XP levels, streaks, and ranking metrics.


* `WS /ws/room/{room_code}` - Bi-directional communication channel for canvas syncing.



---

## 5. AI Onboarding Context

*(Note for AI Assistants/Agents taking over development: Read this completely before changing code)*

### 5.1 Embedding Strategy: Matryoshka 384-dim Truncation

The architecture uses Google's `text-embedding-004` model with `output_dimensionality=384`. This relies on Matryoshka Representation Learning (MRL). The first 384 dimensions capture semantic signals while halving pgvector storage and comparison footprints. The database enforces a strict `Vector(384)` constraint in `models.py`. Do not alter this dimension count without executing a full database migration. Use `_embed_document` and `_embed_query` asymmetrically for document ingestion and retrieval queries respectively to avoid degrading accuracy scores.

### 5.2 Thread-Pool Pattern for Gemini Calls

Google Gemini SDK calls (`genai.embed_content`, `model.generate_content`) are synchronous and blocking. Executing them inside asynchronous endpoints will block Uvicorn's event loop. Offload all generative calls within async pathways using `await asyncio.to_thread(blocking_call, *args)` to safeguard concurrent execution. Background tasks called via `BackgroundTasks.add_task` execute in separate system worker threads natively and must use traditional synchronous calls.

### 5.3 Database Session Gating

Async endpoints use `AsyncSessionLocal` (via `asyncpg` driver), whereas background worker paths utilize `SyncSessionLocal` (via `psycopg2` driver). Workers execute where an active event loop does not exist; utilizing an async session here will throw a `RuntimeError`. Always separate database tracking logic cleanly along this boundary.

### 5.4 Gemini Structured Outputs

Exams, flashcards, and calendar extractions use dedicated model instances with explicit Pydantic `response_schema` constraints and `response_mime_type="application/json"` parameters configured at initialization. Do not swap these mechanisms to use the general unstructured `_chat_model`.

### 5.5 Canvas Hosting Architecture

React Flow node transformations are compiled into a singular custom component `ConceptNode` registered inside `Canvas.tsx` under `nodeTypes = { concept: ConceptNode }`. System coordinates are tracked using absolute positional floating points (`position_x`, `position_y`). Drag interactions trigger `onNodeDragStop`, which simultaneously broadcasts updates over the WebSocket for client views and commits positional entries to the REST API database layer. Locked items match `unlocked: false`, which adjusts opacity layers and suppresses child buttons natively.

### 5.6 Rate Limiting & Pacing

`_chunk_text()` isolates text sequences into 400-word containers with a 60-word overlap structure. An intentional `time.sleep(0.12)` is embedded between individual generation blocks to keep ingestion loads safe from the 1,500 requests/minute free-tier threshold. Do not strip this sleep interval away.

### 5.7 Authentication and Stale Code

* **Auth Stub:** Currently, no login architecture is deployed. A fixed constant UUID (`00000000-0000-0000-0000-000000000001`) acts as a mock profile placeholder.


* **Dockerfile Artifact:** `backend/Dockerfile` includes an ancient `RUN python -c "from sentence_transformers import..."` directive. The system has migrated completely to Gemini embeddings, and `sentence_transformers` is not part of the active dependency configurations. Delete this specific line to prevent container compilation breaks.



---

## 6. Database Connection Verification

The configuration credentials within `main.py` are explicitly aligned to the local environment variables running inside `docker-compose.yml`:

* **User / Password:** `postgres` / `password`

* **Database Target:** `aethergraph`

* **Port Mapping:** `5432:5432`


Note: The backend reads `localhost` when run locally outside Docker, whereas internal Docker components use the internal network DNS service name `postgres`. The template configuration inside `backend/.env.example` defaults safely to `localhost`.

---

## 7. Troubleshooting

* **`psycopg2.OperationalError: could not connect to server`**
The database engine container is either down or booting up. Execute `docker compose ps` to inspect active states and check logs using `docker compose logs postgres`.


* **`google.api_core.exceptions.InvalidArgument: API key not valid`**
The API string inside your `backend/.env` is either missing or malformed. Renew your parameters from your Google AI Studio dashboard.


* **`RuntimeError: no running event loop`**
A thread-bound background worker is mistakenly executing an asynchronous method using `AsyncSessionLocal`. Re-route the process block to rely entirely on `SyncSessionLocal`.


* **`pgvector.exceptions.DimensionMismatch`**
The embedding dimension string does not evaluate to 384. Verify that `output_dimensionality=384` is properly passed to the active Gemini encoder function.


* **Frontend returns "Failed to fetch" on API requests**
The backend script is not running or the frontend configuration tracking inside `.env.local` is misaligned. Verify core API access by visiting `http://localhost:8000/docs` in your browser.


* **`ModuleNotFoundError: sentence_transformers` (Docker Build Fail)**
Remove the stale sentence-transformer setup layers inside `backend/Dockerfile` as detailed in section 5.7.



```

```