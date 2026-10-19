import { AppError } from "../errors.js";

// POST /api/sync/:connector -> starts a run and returns at once. A blocked connector is re-checked first
// (that is how it clears); if it is still blocked the response is 423 with the connector's hint.
export function registerSync(app, { registry, runner, repo }) {
    app.post("/api/sync/:connector", async (req, reply) => {
        const connector = registry.get(req.params.connector);
        if (!connector) throw new AppError(404, "unknown_connector", "No such connector is enabled.");
        const body = req.body ?? {};
        const bad = typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => k !== "account")
            || (body.account !== undefined && (typeof body.account !== "string" || body.account.length > 256));
        if (bad) throw new AppError(400, "invalid_request", 'Body must be empty or {"account": "<id>"}.');
        const account = body.account ?? "";
        if (runner.isRunning(connector.id, account)) throw new AppError(409, "already_running", "A sync is already running for this source.");
        const state = repo.getSyncState(connector.id, account);
        if (state?.state === "blocked") {
            const pre = await connector.preflight();
            if (!pre.ok) throw new AppError(423, "blocked", pre.hint ?? "This source is blocked. Fix the permission and try again.");
            repo.setSyncState(connector.id, account, { state: "idle", last_error_code: null });
        }
        const run = runner.start(connector, account);
        if (!run) throw new AppError(409, "already_running", "A sync is already running for this source.");
        run.done.catch(() => {});
        reply.status(202);
        return { accepted: true, runId: run.runId, state: "running" };
    });
}
