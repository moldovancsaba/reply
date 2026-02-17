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
    
    subgraph "Background Services"
        Worker[Background Worker (background-worker.js)] -->|Poll| AppleMessages[Messages.app]
        Worker -->|Proactive Intelligence| ContactStore[(Contact Store)]
        Worker -->|Embed| VectorDB
    end

    subgraph "Ingestion Pipeline"
        SyncEngine -->|Read| AppleNotes[Apple Notes (AppleScript)]
        SyncEngine -->|Optional OAuth| GmailAPI[Gmail API]
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

### 5. Background Services
*   **Unified Background Worker (`background-worker.js`):** A lightweight service that handles message polling, vectorization, proactive drafting, and KYC extraction.
*   **Worker Strategy**: To prevent system overload, the worker uses a single-threaded "Intelligence Pipeline." Heavy tasks (like LLM drafting) are only triggered for new data.
*   **Load Management**:
    *   **Low-Level Polling**: Direct SQLite queries on `chat.db` are sub-millisecond and near-zero CPU.
    *   **CPU Throttling**: The poll interval is configurable via Settings (`worker.pollIntervalSeconds`) and is clamped to 10–3600 seconds.
    *   **Scalability**: Mail sync is supported; additional channels can be added as separate workers or modular fetchers within the same throttled loop.

## Design Principles
1.  **Local-First:** No reliance on external APIs for core functionality. Optional connectors (e.g. Gmail OAuth) are opt-in.
2.  **Dependency-Minimal:** Use standard libraries where possible.
3.  **Future-Proof:** Data is stored in open formats (LanceDB, JSON) to ensure portability.
