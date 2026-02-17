# Reply — Your Local-First Digital "Brain"

**Reply** is a privacy-focused, local-first AI assistant that learns from your data (emails, notes, files) to act as your digital extension. It runs entirely on your machine, leveraging local LLMs (Ollama) and vector databases (LanceDB).

## 🚀 Quick Start (POC)

### Prerequisites
*   Node.js (v18+)
*   Ollama (running locally)

### Installation
```bash
git clone https://github.com/moldovancsaba/reply.git
cd reply/chat
npm install
```

### Running the "Brain"
1.  **Start the Server:**
    ```bash
    npm start
    ```
    Access the UI at `http://localhost:3000` (or the port printed in the terminal if 3000 is already in use).

2.  **Ingest Data:**
    *   **Local Files:** `node ingest.js` (scans `knowledge/documents`)
    *   **Gmail Archive:** `node ingest.js --mbox /path/to/archive.mbox`
    *   **Apple Notes:** Click "Sync Notes" in the Web UI.
    *   **Email Sync (live):** Click "Sync Email" in the Web UI. Configure IMAP or Gmail OAuth via Settings (gear icon).

## 🧠 Core Features
*   **Unified Knowledge Base:** Stores vectors of your notes and emails locally.
*   **Hybrid Search:** Combines semantic understanding (Vector) with exact keyword matching (FTS) for 100% retrieval accuracy.
*   **Context-Aware Chat:** Ask questions about your own data; the bot cites sources.

## 📚 Documentation
*   [Architecture Overview](docs/ARCHITECTURE.md)
*   [Ingestion Guide](docs/INGESTION.md)
*   [Coding Standards](docs/CODING_STANDARDS.md)
*   [Developer Handover](docs/HANDOVER.md)
*   [Release Notes](docs/RELEASE_NOTES.md)

## 🛡️ Privacy First
All ingested data remains on your device. Core functionality runs locally (Ollama + LanceDB). Optional connectors (e.g. Gmail OAuth) use external provider APIs only when you configure them.
