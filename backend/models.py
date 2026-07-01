"""
AetherGraph SQLAlchemy models.
Requires: pgvector extension enabled in PostgreSQL, and `pgvector` Python package.
"""

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(100), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # ── Gamification ──────────────────────────────────────────────────────────
    # xp         : total lifetime XP earned across all exam/flashcard completions
    # level      : derived from xp — recomputed on every award (xp // 1000) + 1
    # streak_days: consecutive calendar days with at least one XP award
    # last_active: UTC timestamp of the most recent XP award event
    xp = Column(Integer, nullable=False, default=0)
    level = Column(Integer, nullable=False, default=1)
    streak_days = Column(Integer, nullable=False, default=0)
    last_active = Column(DateTime, nullable=True)

    workspaces = relationship(
        "WorkspaceRoom",
        back_populates="owner",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    calendar_events = relationship(
        "CalendarEvent",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<User id={self.id!s} email={self.email!r} "
            f"level={self.level} xp={self.xp} streak={self.streak_days}>"
        )


class WorkspaceRoom(Base):
    __tablename__ = "workspace_rooms"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    # 12-character alphanumeric join code, globally unique
    access_code = Column(String(12), unique=True, nullable=False, index=True)
    owner_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    owner = relationship("User", back_populates="workspaces", lazy="selectin")
    nodes = relationship(
        "GraphNode",
        back_populates="workspace",
        cascade="all, delete-orphan",
        lazy="select",
    )
    edges = relationship(
        "GraphEdge",
        back_populates="workspace",
        cascade="all, delete-orphan",
        lazy="select",
    )
    calendar_events = relationship(
        "CalendarEvent",
        back_populates="room",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<WorkspaceRoom id={self.id!s} name={self.name!r} code={self.access_code!r}>"


class GraphNode(Base):
    """
    A single knowledge unit inside a workspace.

    `embedding` stores the 384-dimensional vector produced by Gemini
    text-embedding-004 (MRL-truncated from 768 dims).  The pgvector
    `<=>` operator (cosine distance) is used for semantic similarity queries.
    """

    __tablename__ = "graph_nodes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    workspace_id = Column(
        UUID(as_uuid=True),
        ForeignKey("workspace_rooms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    document_id = Column(
        UUID(as_uuid=True),
        ForeignKey("uploaded_documents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    label = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    # Semantic class: "concept" | "document" | "summary" | "question" | "definition"
    node_type = Column(String(50), nullable=False, default="concept")
    # 384-dim float32 vector — matches Gemini text-embedding-004 MRL output
    embedding = Column(Vector(768), nullable=True)
    # Syllabus progress flag — unlocked nodes count toward completion percentage
    unlocked = Column(Boolean, nullable=False, default=False)
    # Canvas layout coordinates (React Flow uses these for initial placement)
    position_x = Column(Float, nullable=False, default=0.0)
    position_y = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    workspace = relationship("WorkspaceRoom", back_populates="nodes", lazy="selectin")
    outgoing_edges = relationship(
        "GraphEdge",
        primaryjoin="GraphEdge.source_node_id == GraphNode.id",
        back_populates="source_node",
        cascade="all, delete-orphan",
        lazy="select",
        foreign_keys="[GraphEdge.source_node_id]",
    )
    incoming_edges = relationship(
        "GraphEdge",
        primaryjoin="GraphEdge.target_node_id == GraphNode.id",
        back_populates="target_node",
        cascade="all, delete-orphan",
        lazy="select",
        foreign_keys="[GraphEdge.target_node_id]",
    )
    flashcards = relationship(
        "Flashcard",
        back_populates="node",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<GraphNode id={self.id!s} label={self.label!r} unlocked={self.unlocked}>"


class GraphEdge(Base):
    """
    A directed relationship between two GraphNodes in the same workspace.
    Supports labelled, weighted parent → child knowledge links.
    """

    __tablename__ = "graph_edges"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    workspace_id = Column(
        UUID(as_uuid=True),
        ForeignKey("workspace_rooms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_node_id = Column(
        UUID(as_uuid=True),
        ForeignKey("graph_nodes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_node_id = Column(
        UUID(as_uuid=True),
        ForeignKey("graph_nodes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    relationship_label = Column(String(100), nullable=True)
    # Edge weight used to set stroke-width on the React Flow canvas
    weight = Column(Float, nullable=False, default=1.0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    workspace = relationship("WorkspaceRoom", back_populates="edges", lazy="selectin")
    source_node = relationship(
        "GraphNode",
        foreign_keys=[source_node_id],
        back_populates="outgoing_edges",
        lazy="selectin",
    )
    target_node = relationship(
        "GraphNode",
        foreign_keys=[target_node_id],
        back_populates="incoming_edges",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return (
            f"<GraphEdge id={self.id!s} "
            f"src={self.source_node_id!s} → tgt={self.target_node_id!s}>"
        )


class CalendarEvent(Base):
    """
    A deadline, milestone, or scheduled event associated with a workspace room.
    Events can be created manually via the API or auto-extracted by the Calendar
    Agent during Pocket Dump background processing.
    """

    __tablename__ = "calendar_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Room association is nullable — events can theoretically be global
    room_id = Column(
        UUID(as_uuid=True),
        ForeignKey("workspace_rooms.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    title = Column(String(255), nullable=False)
    due_date = Column(DateTime, nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="calendar_events", lazy="selectin")
    room = relationship("WorkspaceRoom", back_populates="calendar_events", lazy="selectin")

    def __repr__(self) -> str:
        return f"<CalendarEvent id={self.id!s} title={self.title!r} due={self.due_date}>"


class Flashcard(Base):
    """
    An AI-generated active-recall card linked to a specific knowledge graph node.
    Cards are generated on demand via POST /api/nodes/{node_id}/flashcards using
    Gemini structured output (FlashcardsSchema) and the node's vector context.
    """

    __tablename__ = "flashcards"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    node_id = Column(
        UUID(as_uuid=True),
        ForeignKey("graph_nodes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    front_text = Column(Text, nullable=False)
    back_text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    node = relationship("GraphNode", back_populates="flashcards", lazy="selectin")

    def __repr__(self) -> str:
        return f"<Flashcard id={self.id!s} node_id={self.node_id!s}>"


class UploadedDocument(Base):
    """
    Tracks uploaded documents for the Document Management Hub.
    Stores metadata about uploaded files and links them to workspaces.
    When deleted, cascades to delete associated nodes and edges.
    """

    __tablename__ = "uploaded_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    workspace_id = Column(
        UUID(as_uuid=True),
        ForeignKey("workspace_rooms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    filename = Column(String(255), nullable=False)
    file_size = Column(Integer, nullable=False)  # Size in bytes
    file_type = Column(String(50), nullable=False)  # e.g., "pdf", "txt", "md"
    status = Column(String(50), nullable=False, default="processing")  # "processing" | "completed" | "failed"
    node_count = Column(Integer, nullable=False, default=0)  # Number of nodes created from this document
    color = Column(String(50), nullable=True)  # File-based color provenance
    uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    workspace = relationship("WorkspaceRoom", lazy="selectin")

    def __repr__(self) -> str:
        return f"<Document id={self.id!s} filename={self.filename!r} status={self.status!r}>"
