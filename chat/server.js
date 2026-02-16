/**
 * Reply POC — localhost chat server.
 * Serves the chat UI and /api/suggest-reply for reply suggestions.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { generateReply } = require("./reply-engine.js");

const PORT = process.env.PORT || 3000;
const HTML_PATH = path.join(__dirname, "index.html");

function serveHtml(req, res) {
  fs.readFile(HTML_PATH, (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Error loading chat UI.");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(data);
  });
}

function serveSuggestReply(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let message = "";
    try {
      const json = JSON.parse(body || "{}");
      message = json.message ?? json.text ?? "";
    } catch {
      message = body;
    }
    const suggestion = generateReply(message);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ suggestion }));
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  if (url.pathname === "/api/suggest-reply") {
    serveSuggestReply(req, res);
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    serveHtml(req, res);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Reply chat POC: http://localhost:${PORT}`);
});
