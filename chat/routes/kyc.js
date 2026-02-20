const path = require("path");
const { execFile } = require("child_process");
const contactStore = require("../contact-store.js");
const { mergeProfile } = require("../kyc-merge.js");

// Helper functions that will be refactored into a utils.js file later
function writeJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => resolve(body));
        req.on("error", reject);
    });
}

async function readJsonBody(req) {
    const body = await readRequestBody(req);
    if (!body) return {};
    try {
        return JSON.parse(body);
    } catch {
        return {};
    }
}


/**
 * API Endpoint: /api/kyc
 * GET  /api/kyc?handle=...
 * POST /api/kyc { handle, displayName/profession/relationship/intro } (accepts legacy {name, role} too)
 */
async function serveKyc(req, res, url, authorizeSensitiveRoute) {
  if (req.method === "GET") {
    if (!authorizeSensitiveRoute(req, res, {
      route: "/api/kyc",
      action: "read-kyc",
    })) {
      return;
    }
    const handle = url.searchParams.get("handle");
    if (!handle) {
      writeJson(res, 400, { error: "Missing handle" });
      return;
    }

    const contact = contactStore.findContact(handle);
    writeJson(res, 200, {
      handle,
      displayName: contact?.displayName || contact?.name || handle,
      profession: contact?.profession || "",
      relationship: contact?.relationship || "",
      intro: contact?.intro || "",
      notes: Array.isArray(contact?.notes) ? contact.notes : [],
      channels: contact?.channels || { phone: [], email: [] },
      pendingSuggestions: Array.isArray(contact?.pendingSuggestions) ? contact.pendingSuggestions : [],
      rejectedSuggestions: Array.isArray(contact?.rejectedSuggestions) ? contact.rejectedSuggestions : [],
    });
    return;
  }

  if (req.method === "POST") {
    try {
      const json = await readJsonBody(req);
      if (!authorizeSensitiveRoute(req, res, {
        route: "/api/kyc",
        action: "update-kyc",
        payload: json,
      })) {
        return;
      }
      const handle = json.handle;
      if (!handle) {
        writeJson(res, 400, { error: "Missing handle" });
        return;
      }

      const data = {
        displayName: (json.displayName ?? json.name ?? "").trim(),
        profession: (json.profession ?? json.role ?? "").trim(),
        relationship: (json.relationship ?? "").trim(),
        intro: (json.intro ?? "").trim(),
      };

      // Don't overwrite with empty strings
      Object.keys(data).forEach((k) => {
        if (!data[k]) delete data[k];
      });

      const contact = contactStore.updateContact(handle, data);
      writeJson(res, 200, { status: "ok", contact });
    } catch (e) {
      writeJson(res, 500, { error: e.message });
    }
    return;
  }

  writeJson(res, 405, { error: "Method not allowed" });
}


function analyzeContactInChild(handle) {
  const childScript = path.join(__dirname, "../kyc-analyze-child.js");
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [childScript, String(handle)],
      {
        cwd: __dirname,
        timeout: 5 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
        env: process.env
      },
      (err, stdout, stderr) => {
        if (err) {
          const signal = err.signal || null;
          const code = typeof err.code === "number" ? err.code : null;
          const suffix = signal ? ` (signal ${signal})` : code !== null ? ` (code ${code})` : "";
          const details = String((stderr || stdout || "")).trim();
          const msg =
            signal === "SIGSEGV" || /segmentation fault/i.test(details)
              ? `Analyzer crashed with a segmentation fault${suffix}.`
              : `Analyzer failed${suffix}.`;
          return reject(new Error(details ? `${msg} ${details}` : msg));
        }

        const out = String(stdout || "").trim();
        let parsed = null;
        try {
          parsed = out ? JSON.parse(out) : null;
        } catch {
          const details = String((stderr || stdout || "")).trim();
          return reject(new Error(details ? `Analyzer returned invalid JSON. ${details}` : "Analyzer returned invalid JSON."));
        }

        if (!parsed || parsed.status !== "ok") {
          return reject(new Error(parsed?.error || "Analyzer failed."));
        }

        resolve(parsed.profile || null);
      }
    );
  });
}

function analyzeContactDeduped(handle, analysisInFlightByHandle) {
  const key = String(handle || "").trim();
  if (!key) return Promise.reject(new Error("Missing handle"));
  const existing = analysisInFlightByHandle.get(key);
  if (existing) return existing;

  const p = analyzeContactInChild(key)
    .finally(() => {
      analysisInFlightByHandle.delete(key);
    });
  analysisInFlightByHandle.set(key, p);
  return p;
}


async function serveAnalyzeContact(req, res, authorizeSensitiveRoute, analysisInFlightByHandle) {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const payload = await readJsonBody(req);
    if (!authorizeSensitiveRoute(req, res, {
      route: "/api/analyze-contact",
      action: "analyze-contact",
      payload,
    })) {
      return;
    }
    try {
      const handle = (payload?.handle || "").toString().trim();
      if (!handle) {
        writeJson(res, 400, { error: "Missing handle" });
        return;
      }

      const profile = await analyzeContactDeduped(handle, analysisInFlightByHandle);
      let updatedContact = null;
      if (profile) {
        updatedContact = await mergeProfile(profile);
      }

      writeJson(res, 200, {
        status: "ok",
        contact: updatedContact,
        message: profile ? "Analysis complete" : "Not enough data for analysis"
      });
    } catch (e) {
      console.error("Analysis error:", e);
      writeJson(res, 500, { error: e.message });
    }
}

module.exports = {
    serveKyc,
    serveAnalyzeContact,
};
