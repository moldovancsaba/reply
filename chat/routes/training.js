/**
 * Agent training: golden examples and pending suggestions (LanceDB).
 */

const { writeJson, readJsonBody } = require("../utils/server-utils.js");
const {
    getGoldenExamples,
    getPendingSuggestions,
    deleteDocument,
    addDocuments,
    setGoldenAnnotation,
} = require("../vector-store.js");

const LIST_LIMIT = 500;

async function serveAnnotationsGet(req, res) {
    if (req.method !== "GET") {
        writeJson(res, 405, { error: "Method not allowed" });
        return;
    }
    try {
        const [annotations, pending] = await Promise.all([
            getGoldenExamples(LIST_LIMIT),
            getPendingSuggestions(LIST_LIMIT),
        ]);
        writeJson(res, 200, { annotations, pending });
    } catch (e) {
        console.error("[Training] GET annotations:", e);
        writeJson(res, 500, { error: e.message || "Failed to load training data" });
    }
}

async function serveAnnotationsDelete(req, res) {
    if (req.method !== "DELETE") {
        writeJson(res, 405, { error: "Method not allowed" });
        return;
    }
    try {
        const body = await readJsonBody(req);
        const id = body.id != null ? String(body.id).trim() : "";
        if (!id) {
            writeJson(res, 400, { error: "Missing id" });
            return;
        }
        await deleteDocument(id);
        writeJson(res, 200, { status: "ok" });
    } catch (e) {
        console.error("[Training] DELETE annotation:", e);
        writeJson(res, 500, { error: e.message || "Delete failed" });
    }
}

/**
 * POST /api/messages/annotate
 * Body: { id, is_annotated } toggles golden flag on an existing document.
 * Body: { id, text, is_annotated: true } inserts a new synthetic golden (training refine flow).
 */
async function serveMessageAnnotate(req, res) {
    if (req.method !== "POST") {
        writeJson(res, 405, { error: "Method not allowed" });
        return;
    }
    try {
        const body = await readJsonBody(req);
        const id = body.id != null ? String(body.id).trim() : "";
        if (!id) {
            writeJson(res, 400, { error: "Missing id" });
            return;
        }

        const hasText = typeof body.text === "string" && body.text.trim().length > 0;
        const isAnnotated = Boolean(body.is_annotated);

        if (hasText && isAnnotated) {
            await addDocuments([
                {
                    id,
                    text: body.text.trim(),
                    source: "training_synthetic",
                    path: "manual://training",
                    is_annotated: true,
                },
            ]);
            writeJson(res, 200, { status: "ok" });
            return;
        }

        await setGoldenAnnotation(id, isAnnotated);
        writeJson(res, 200, { status: "ok" });
    } catch (e) {
        console.error("[MessageAnnotate]", e);
        writeJson(res, 500, { error: e.message || "Annotation failed" });
    }
}

module.exports = {
    serveAnnotationsGet,
    serveAnnotationsDelete,
    serveMessageAnnotate,
};
