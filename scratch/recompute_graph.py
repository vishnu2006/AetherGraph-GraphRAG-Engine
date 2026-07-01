import asyncio
import uuid
import random
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
import sys
import os

# Add backend to path so we can import models if needed, though we can just use raw SQL
sys.path.append(os.path.join(os.path.dirname(__file__), "../backend"))

ASYNC_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:password@localhost:5432/aethergraph",
)

engine = create_async_engine(ASYNC_DATABASE_URL)
SessionLocal = sessionmaker(engine, class_=AsyncSession)

async def recompute():
    async with SessionLocal() as db:
        print("1. Deleting all existing edges to prune hairball...")
        await db.execute(text("DELETE FROM graph_edges"))
        
        print("2. Recomputing Top-2 edges for all nodes...")
        nodes_result = await db.execute(text("SELECT id, workspace_id, embedding, position_x, position_y FROM graph_nodes WHERE embedding IS NOT NULL"))
        nodes = nodes_result.fetchall()
        
        # Color coding fix: ensure all documents have colors, and nodes inherit them.
        print("3. Reassigning document colors to nodes...")
        docs_result = await db.execute(text("SELECT id, color FROM uploaded_documents"))
        docs = docs_result.fetchall()
        tail_colors = ["#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e", "#06b6d4", "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#f43f5e"]
        
        for doc in docs:
            if not doc.color:
                c = random.choice(tail_colors)
                await db.execute(text("UPDATE uploaded_documents SET color = :c WHERE id = :id"), {"c": c, "id": doc.id})
                
        # Nodes that belong to a document get its color in the frontend via API join or we can just update a color column if it exists.
        # Wait, the node schema doesn't have a color column, it joins with uploaded_documents.
        # Let's check if nodes have a color column. In main.py, NodeOut has color: Optional[str].
        # In frontend, ConceptNode uses `data.color`. The API `/api/nodes/{workspace_id}` probably joins them.
        
        # Re-layout and re-edge
        for node in nodes:
            # Find top 2 neighbors
            if isinstance(node.embedding, str):
                vec_literal = node.embedding
            else:
                vec_literal = "[" + ",".join(f"{v:.8f}" for v in node.embedding) + "]"
            neighbors_result = await db.execute(
                text("""
                    SELECT id, 1 - (embedding <=> cast(:vec AS vector)) AS similarity, position_x, position_y
                    FROM graph_nodes
                    WHERE workspace_id = :wid
                      AND id != :nid
                      AND embedding IS NOT NULL
                    ORDER BY embedding <=> cast(:vec AS vector)
                    LIMIT 2
                """),
                {"vec": vec_literal, "wid": node.workspace_id, "nid": node.id}
            )
            neighbors = neighbors_result.fetchall()
            
            has_edge = False
            for neighbor in neighbors:
                if neighbor.similarity > 0.75:
                    has_edge = True
                    await db.execute(
                        text("""
                            INSERT INTO graph_edges (id, workspace_id, source_node_id, target_node_id, relationship_label, weight, created_at)
                            VALUES (:eid, :wid, :src, :tgt, 'Highly Related', :weight, CURRENT_TIMESTAMP)
                        """),
                        {
                            "eid": uuid.uuid4(),
                            "wid": node.workspace_id,
                            "src": neighbor.id,
                            "tgt": node.id,
                            "weight": float(neighbor.similarity)
                        }
                    )
            
            # If no edge, maybe pull it to center or keep it.
            # We won't drastically change positions unless we want to do a full force-directed layout here.
            # A simple clustering: move node closer to its best neighbor
            if neighbors and neighbors[0].similarity > 0.75:
                best = neighbors[0]
                # move halfway towards best neighbor
                new_x = (node.position_x + best.position_x) / 2 + random.uniform(-100, 100)
                new_y = (node.position_y + best.position_y) / 2 + random.uniform(-100, 100)
                await db.execute(text("UPDATE graph_nodes SET position_x = :x, position_y = :y WHERE id = :id"), {"x": new_x, "y": new_y, "id": node.id})

        await db.commit()
        print("Done migrating existing graph data!")

if __name__ == '__main__':
    asyncio.run(recompute())
