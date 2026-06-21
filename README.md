# AetherGraph

A real-time collaborative GraphRAG knowledge engine.

---

AetherGraph transforms static documents into **interactive, collaborative knowledge graphs**. Upload files, visualize their concepts as a connected network of nodes, brainstorm in real-time with team members, and interact with your documents using AI-powered study aids and context-aware chat.

## Key Features

* **🗺️ Interactive Knowledge Canvas**: Documents are converted into structural node networks. Users can visually explore concepts, unlock nodes, and map out relationships on a dynamic, responsive canvas.
* **👥 Live Collaboration**: Workspaces sync instantly. Multiple users can join the same room to drag, drop, edit, and modify the knowledge graph simultaneously.
* **💬 Omni-Search RAG Chat**: Chat with your entire document collection. The engine retrieves context directly from the graph database to deliver cited, hallucination-free answers.
* **🎓 Active-Recall Tools**: Instantly generate structured mock exams and interactive flashcard decks extracted directly from your study materials.
* **📅 AI Calendar Agent**: Upload a syllabus or document, and AetherGraph automatically identifies deadlines and exam dates, scheduling them onto your workspace calendar.

## How it Works

1. **Upload**: Drop your PDFs or text documents into the workspace.
2. **Analyze**: The backend parses the files, fragments them semantically, and embeds them into a database.
3. **Map**: Chunks are visualised as nodes on the canvas. Similar concepts are linked together automatically.
4. **Collaborate & Study**: Work with your team live, test yourself with mock exams, or chat with your documents.

## Core Tech Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Frontend** | Next.js 14, React Flow v11 | Client interface, interactive canvas, and responsive panels |
| **Backend** | FastAPI, Python | Asynchronous API, background task processor, and WS server |
| **Database** | PostgreSQL with pgvector | Relational database with vector similarity search |
| **AI Engine** | Google Gemini API | Text embedding generation, synthesis, and structured utility generation |

## Quickstart (Local Development)

### Prerequisites
- **Docker**
- **Node.js v20+**
- **Python 3.11 / 3.12**

### Step 1: Database Setup
Launch PostgreSQL with the vector extension:
```bash
docker compose up -d postgres
```

### Step 2: Backend Setup
1. Navigate to the backend directory and activate a virtual environment:
   ```bash
   cd backend
   python -m venv .venv
   # Windows:
   .venv\Scripts\activate
   # macOS/Linux:
   source .venv/bin/activate
   ```
2. Install python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Set your Google Gemini API key in a `.env` file:
   ```env
   DATABASE_URL=postgresql+asyncpg://postgres:password@localhost:5432/aethergraph
   SYNC_DATABASE_URL=postgresql://postgres:password@localhost:5432/aethergraph
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
4. Start the backend:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

### Step 3: Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd ../frontend
   ```
2. Install packages and start the Next.js development server:
   ```bash
   npm install
   npm run dev
   ```
3. Open [http://localhost:3000](http://localhost:3000) in your browser.

## License

This project is licensed under the MIT License.