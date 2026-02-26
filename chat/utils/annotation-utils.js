/**
 * {reply} - Annotation Utilities
 * Queue-based auto-annotation to prevent SQLite write races.
 */

const contactStore = require("../contact-store");

const annotationQueue = [];
let processingAnnotation = false;

async function processAnnotationQueue() {
    if (processingAnnotation || annotationQueue.length === 0) return;
    processingAnnotation = true;
    try {
        while (annotationQueue.length > 0) {
            const { channel, handle, text, resolve, reject } = annotationQueue.shift();
            try {
                const result = await _internalAutoAnnotate(channel, handle, text);
                resolve(result);
            } catch (err) {
                console.error("[AutoAnnotate] Error in queue:", err);
                reject(err);
            }
        }
    } finally {
        processingAnnotation = false;
    }
}

async function _internalAutoAnnotate(channel, handle, text) {
    try {
        const { addDocuments } = require("../vector-store");
        const dateStr = new Date().toLocaleString();
        const formatted = `[${dateStr}] Me: ${text}`;
        const msgId = `urn:reply:manual:${Date.now()}`;
        await addDocuments([{
            id: msgId,
            text: formatted,
            source: channel,
            path: `${channel}://${handle}`,
            is_annotated: true
        }]);

        const { saveMessages } = require("../message-store");
        await saveMessages([{
            id: msgId,
            text: text,
            source: channel,
            handle: handle,
            timestamp: new Date().toISOString(),
            path: `${channel}://${handle}`
        }]);

        await contactStore.updateLastContacted(handle, new Date().toISOString(), { channel });

        return { id: msgId };
    } catch (e) {
        console.error("Auto-annotation failed:", e.message);
        throw e;
    }
}

function autoAnnotateSentMessage(channel, handle, text) {
    return new Promise((resolve, reject) => {
        annotationQueue.push({ channel, handle, text, resolve, reject });
        processAnnotationQueue().catch(reject);
    });
}

module.exports = {
    autoAnnotateSentMessage
};
