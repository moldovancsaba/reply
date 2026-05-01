/**
 * {reply} - Message Cleaner (Backend)
 * Handles stripping HTML/CSS and extracting core content from raw message streams.
 */

function cleanMessageText(text) {
    if (!text) return "";

    // 1. Remove style and script blocks first
    let clean = text
        .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, "")
        .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, "");

    // 2. Remove tags but keep specific semantic markers
    if (/<[a-z][\s\S]*>/i.test(clean)) {
        clean = clean
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ");
    }

    return clean.trim();
}

/**
 * Extracts attachments from a mailparser object or raw message.
 * (Placeholder for attachment logic)
 */
function extractAttachments(parsed) {
    if (!parsed?.attachments) return [];
    return parsed.attachments.map(att => ({
        filename: att.filename,
        contentType: att.contentType,
        size: att.size,
        contentId: att.contentId
    }));
}

module.exports = {
    cleanMessageText,
    extractAttachments
};
