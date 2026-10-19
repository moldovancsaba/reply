import http from "node:http";

export type Behave = { models?: { name: string }[]; hang?: boolean; status?: number; response?: string; delayMs?: number };
export type Fake = { url: string; behave: Behave; seen: { generate: Record<string, unknown>[]; aborted: number }; close: () => Promise<void> };

// A stand-in for a local Ollama: /api/tags lists models, /api/generate answers according to `behave` (changeable per test).
export async function fakeOllama(behave: Behave = {}): Promise<Fake> {
  const seen = { generate: [] as Record<string, unknown>[], aborted: 0 };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      if (req.url === "/api/tags") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ models: fake.behave.models ?? [{ name: "fake:1" }] })); return; }
      if (req.url === "/api/generate") {
        seen.generate.push(JSON.parse(body));
        res.on("close", () => { if (!res.writableEnded) seen.aborted++; });
        if (fake.behave.hang) return;
        if (fake.behave.status) { res.statusCode = fake.behave.status; res.end("{}"); return; }
        if (fake.behave.delayMs) await new Promise((r) => setTimeout(r, fake.behave.delayMs));
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ response: fake.behave.response ?? "Yes, 6 works. Where should we meet?" }));
        return;
      }
      res.statusCode = 404; res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as import("node:net").AddressInfo).port;
  const fake: Fake = { url: `http://127.0.0.1:${port}`, behave, seen, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
  return fake;
}
