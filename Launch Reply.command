#!/bin/bash

# {reply} system launcher
# Double-click this file to start the system.

# Get the directory where this script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR/chat"

echo "=========================================="
echo "      🚀 REPLY SYSTEM LAUNCHER 🚀"
echo "=========================================="
echo "Starting Node.js Server..."
echo "Logs will appear below."
echo "------------------------------------------"

# Read port from .env or fallback
PORT=$(grep PORT .env | cut -d '=' -f2)
PORT=${PORT:-45311}

# check if running
if lsof -i :$PORT > /dev/null; then
    echo "⚠️  System is already running on port $PORT."
    echo "Attempting to open browser..."
    open "http://localhost:$PORT"
    echo "Check the UI for health status and service controls."
    exit 0
fi

echo "Cleaning up any dangling worker processes..."
pkill -f background-worker.js || true

# Start Server (which now starts the Worker)
(sleep 3 && open "http://localhost:$PORT") &
npm start

echo "------------------------------------------"
echo "Server stopped."
