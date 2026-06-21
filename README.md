# AetherGraph

A real-time collaborative GraphRAG knowledge engine.

## Overview
AetherGraph is a collaborative knowledge workspace that parses unstructured documents (PDF/TXT), builds a semantic concept graph, and enables real-time multi-user interaction. The platform integrates document ingestion, vector-based semantic search (GraphRAG), active-recall utility generation (mock exams, flashcards), and live WebSocket-based state synchronization on an interactive canvas.

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Frontend** | Next.js 14 (TypeScript, App Router), React Flow v11 | Client-side visual canvas, real-time collaboration panels, interactive widgets. |
| **Backend** | FastAPI (Python 3.12), SQLAlchemy, Uvicorn | High-performance asynchronous API, background task worker, WebSocket manager. |
| **Database** | PostgreSQL with pgvector extension | Relational storage for users, workspaces, nodes, and high-dimensional vectors. |
| **AI Engine** | Google Gemini API (gemini-2.5-flash, gemini-embedding-001) | Embeddings, semantic querying, structured output synthesis. |
| **Protocols** | WebSockets, REST HTTP | Bi-directional collaborative state updates and standard CRUD operations. |

## Key Architectural Mechanics

* **GraphRAG Pipeline**: Uploaded documents are parsed and segmented into semantic text chunks. To prevent Gemini API rate limits, the ingestion loop features a pacing delay (`time.sleep(0.12)`). Chunks are embedded using `models/gemini-embedding-001` with an `output_dimensionality` constraint of 768. The resulting coordinates are indexed using HNSW operator-based cosine similarity (`<=>`) in PostgreSQL.
* **Real-Time Synchronization**: Collaboration is powered by a stateless, bi-directional WebSocket system. When a workspace is loaded, the client establishes a persistent connection to the FastAPI backend. User interactions (e.g., node movements via `onNodeDragStop` or node deletions) immediately broadcast JSON payloads containing structural coordinates or state changes. The server disseminates these payloads to all other clients connected to the same room code, keeping the canvas in sync.
* **Structured AI Output**: Active-recall tools (flashcards and mock exams) bypass erratic regex-based string parsing. Instead, the backend defines structured Pydantic models (e.g., `ExamSchema`, `FlashcardsSchema`) and configures the Gemini generative model with `response_mime_type="application/json"` and the schema structure. Gemini outputs deterministic JSON, guaranteeing syntax safety and zero serialization errors.

## Database Schema & Vector Math

AetherGraph stores high-dimensional document chunk coordinates in the `graph_nodes` table using the `vector(768)` type. Cosine similarity is used to map semantic proximity across text fragments, establishing cross-document graph edges. 

The query below shows how the backend queries similarity:

```sql
SELECT 
    id::text AS node_id, 
    label, 
    content, 
    node_type,
    1 - (embedding <=> cast(:vec AS vector)) AS similarity 
FROM 
    graph_nodes 
WHERE 
    workspace_id = cast(:wid AS uuid)
    AND embedding IS NOT NULL 
ORDER BY 
    embedding <=> cast(:vec AS vector) 
LIMIT 
    :top_k;
```

### Why Cosine Distance (`<=>`) is Used
Euclidean (L2) distance (`<->`) measures the straight-line distance between two points in space. In semantic search, text segments vary in length and frequency of terms, which significantly scales vector magnitudes. Because cosine distance measures the angle between vectors rather than their magnitudes, it detects semantic alignment and thematic similarity independently of document length.

## Quickstart (Local Development)

### Prerequisites
- **Docker** (for running PostgreSQL)
- **Node.js v20+**
- **Python 3.11 or 3.12**

### Step 1: Run PostgreSQL
Launch the database container with the pgvector extension preconfigured:
```bash
docker compose up -d postgres
```

### Step 2: Set Up Backend
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a Python virtual environment:
   ```bash
   python -m venv .venv
   # Windows:
   .venv\Scripts\activate
   # macOS/Linux:
   source .venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Create a `.env` file in the `backend/` directory using `.env.example` as a template and configure your `GEMINI_API_KEY`:
   ```env
   DATABASE_URL=postgresql+asyncpg://postgres:password@localhost:5432/aethergraph
   SYNC_DATABASE_URL=postgresql://postgres:password@localhost:5432/aethergraph
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
5. Run the FastAPI development server:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

### Step 3: Set Up Frontend
1. Navigate to the frontend directory:
   ```bash
   cd ../frontend
   ```
2. Install the package dependencies:
   ```bash
   npm install
   ```
3. Start the Next.js development server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## License & Contributing

### Contributing
Contributions are welcome. Please open an issue to discuss proposed changes before submitting a pull request.

### License
This project is licensed under the MIT License. See the LICENSE file for details.