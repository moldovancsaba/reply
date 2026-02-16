#!/bin/bash

# Reply System Launcher
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

# check if running
if lsof -i :3000 > /dev/null; then
    echo "⚠️  System seems to be already running on port 3000."
    echo "Attempting to open browser..."
    open "http://localhost:3000"
    echo "Press any key to restart the server, or close this window to keep it running."
    read -n 1
    # kill existing
    kill $(lsof -t -i:3000)
fi

# Start Server
# We use 'npm start' but capturing output could be useful.
# For now, we keep it simple so the user sees the logs.

(sleep 2 && open "http://localhost:3000") &
npm start

echo "------------------------------------------"
echo "Server stopped."
