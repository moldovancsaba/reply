# System Architecture

## Overview
**Reply** follows a minimalist, local-first architecture designed for privacy, speed, and maintainability. It avoids heavy frameworks and cloud dependencies.

## High-Level Diagram

```mermaid
graph TD
    User[User / Web UI] -->|HTTP POST| Server[Node.js Server]
    Server -->|Sync Request| SyncEngine[Ingestion Scripts]
    Server -->|Query| VectorDB[(LanceDB)]
    Server -->|Context + Prompt| LLM[Ollama (Local LLM)]
    
    subgraph "Ingestion Pipeline"
        SyncEngine -->|Read| AppleNotes[Apple Notes (AppleScript)]
        SyncEngine -->|Stream| Mbox[Email Archives (.mbox)]
        SyncEngine -->|Scan| LocalFiles[Local Docs (.md/.txt)]
        SyncEngine -->|Embed & Index| VectorDB
    end
```

## Core Components

### 1. The "Brain" (Vector Store)
*   **Technology:** LanceDB (Node.js)
*   **Model:** `Xenova/all-MiniLM-L6-v2` (Local Embedding Model)
*   **Storage:** `knowledge/lancedb`
*   **Search Strategy:** **Hybrid Search** (Reciprocal Rank Fusion of Vector Similarity + BM25 Keyword Search).

### 2. The Interaction Layer (Server)
*   **Technology:** Node.js (Vanilla HTTP Server)
*   **Key Files:**
    *   `server.js`: API endpoints and static file serving.
    *   `reply-engine.js`: Orchestrates the LLM prompt construction.
    *   `knowledge.js`: Interface for querying the vector store.

### 3. The Ingestion Layer
*   **Design Pattern:** Delta-Sync & Streaming.
*   **Key Files:**
    *   `ingest.js`: Handles file and mbox ingestion. features async generators for memory-efficient processing.
    *   `sync-notes.js`: Bridges Node.js and macOS Apple Notes via `osascript`.

### 4. The Intelligence Layer (LLM)
*   **Technology:** Ollama
*   **Integration:** `ollama` npm package.
*   **Role:** Generates natural language responses based on retrieved context.

## Design Principles
1.  **Local-First:** No reliance on external APIs for core functionality.
2.  **Dependency-Minimal:** Use standard libraries where possible.
3.  **Future-Proof:** Data is stored in open formats (LanceDB, JSON) to ensure portability.
