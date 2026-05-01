#!/bin/bash

# {reply} Setup Script
# Initializes the environment for local development and data syncing.

PROJECT_ROOT=$(pwd)
CHAT_DIR="$PROJECT_ROOT/chat"
DATA_DIR="$CHAT_DIR/data"
KNOWLEDGE_DIR="$PROJECT_ROOT/knowledge"
LANCEDB_DIR="$KNOWLEDGE_DIR/lancedb"

echo "🚀 Starting {reply} environment setup..."

# 1. Create Directories
echo "📁 Creating data directories..."
mkdir -p "$DATA_DIR"
mkdir -p "$LANCEDB_DIR"

# 2. Initialize .env
if [ ! -f "$CHAT_DIR/.env" ]; then
    echo "📄 Creating .env from template..."
    cat << 'ENV' > "$CHAT_DIR/.env"
# Gemini API Key (Required for 'Refine' and Training)
GOOGLE_API_KEY=your_gemini_api_key_here

# Port for the chat server
PORT=3000

# Security policy
REPLY_OPERATOR_TOKEN=reply-local-operator-token-2026
REPLY_SECURITY_REQUIRE_OPERATOR_TOKEN=true
REPLY_SECURITY_LOCAL_WRITES_ONLY=true
REPLY_SECURITY_REQUIRE_HUMAN_APPROVAL=true

# WhatsApp Send Settings
REPLY_WHATSAPP_SEND_TRANSPORT=openclaw_cli
REPLY_WHATSAPP_ALLOW_OPENCLAW_SEND=true
REPLY_WHATSAPP_DESKTOP_FALLBACK_ON_OPENCLAW_FAILURE=false

# Paths for local databases (Adjust to your system)
REPLY_IMESSAGE_DB_PATH=$HOME/Library/Messages/chat.db
REPLY_WHATSAPP_DB_PATH=$HOME/Library/Group\ Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite
REPLY_KNOWLEDGE_DB_PATH=$PROJECT_ROOT/knowledge/lancedb
REPLY_CONTACTS_DB_PATH=$PROJECT_ROOT/chat/data/contacts.db
ENV
    echo "⚠️  Please update GOOGLE_API_KEY in chat/.env"
else
    echo "✅ .env already exists."
fi

# 3. Validate system databases
echo "🔍 Validating system database access..."
if [ -f "$HOME/Library/Messages/chat.db" ]; then
    echo "✅ Found system iMessage database."
else
    echo "❌ System iMessage database not found at standard path."
fi

if [ -f "$HOME/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite" ]; then
    echo "✅ Found system WhatsApp database."
else
    echo "❌ System WhatsApp database not found at standard path."
fi

# 4. Initialize local chat.db if it doesn't exist
if [ ! -f "$DATA_DIR/chat.db" ]; then
    echo "🏗️  Initializing local chat.db unified store..."
    sqlite3 "$DATA_DIR/chat.db" "CREATE TABLE IF NOT EXISTS unified_messages (id TEXT PRIMARY KEY, text TEXT, source TEXT, handle TEXT, timestamp TEXT, path TEXT);"
else
    echo "✅ Local chat.db already exists."
fi

echo "✨ Setup complete! You can now start the server with 'node chat/server.js'."
