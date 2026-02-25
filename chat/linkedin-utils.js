/**
 * {reply} - LinkedIn Utilities
 * Shared logic for handle normalization.
 */

/**
 * Normalizes a LinkedIn name, handle, or URL into a standard internal handle.
 * Format: linkedin://normalizedname
 * @param {string} input - Raw name (e.g., "Sunil D"), handle (e.g., "sunild"), or URL.
 * @returns {string} Normalized internal handle.
 */
function normalizeLinkedInHandle(input) {
    if (!input) return "";

    // 1. Remove scheme if present
    let clean = String(input)
        .replace(/^(imessage:\/\/|whatsapp:\/\/|mailto:|telegram:\/\/|discord:\/\/|signal:\/\/|viber:\/\/|linkedin:\/\/|messenger:\/\/|instagram:\/\/|sms:\/\/)/i, "")
        .trim();

    // 2. Remove URL parts if it's a profile URL
    // e.g., https://www.linkedin.com/in/sunil-d-123/ -> sunil-d-123
    if (clean.includes("linkedin.com/in/")) {
        clean = clean.split("linkedin.com/in/")[1].split("/")[0].split("?")[0];
    }

    // 3. Basic normalization: lowercase, remove spaces, remove special characters
    // This matches the logic in ingest-linkedin-contacts.js
    let normalized = clean
        .toLowerCase()
        .replace(/\s+/g, "") // Remove all spaces
        .replace(/[^\w-]/g, ""); // Keep alphanumeric and hyphens

    if (!normalized) return "";

    return `linkedin://${normalized}`;
}

module.exports = {
    normalizeLinkedInHandle
};
