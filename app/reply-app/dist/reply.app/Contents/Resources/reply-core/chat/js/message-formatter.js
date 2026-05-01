/**
 * {reply} - Message Formatter
 * Handles cleaning and formatting messages for "Pleasant Viewing"
 */

// Allowed HTML tags for sanitization
const ALLOWED_TAGS = [
    'b', 'i', 'u', 'strong', 'em', 'a', 'p', 'br', 'ul', 'ol', 'li',
    'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'code', 'pre', 'blockquote'
];

/**
 * Sanitize HTML using DOMPurify to prevent XSS attacks.
 * Falls back to a basic escape function if DOMPurify is not available.
 * @param {string} html - The HTML string to sanitize
 * @returns {string} - Sanitized HTML string
 */
function sanitizeHtml(html) {
    if (!html) return "";

    // Use DOMPurify if available (loaded via CDN)
    if (typeof window.DOMPurify !== 'undefined') {
        return window.DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ALLOWED_TAGS,
            ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'id', 'style'],
            ALLOW_DATA_ATTR: false,
            ADD_ATTR: ['target'], // Allow target="_blank" for links
        });
    }

    // Fallback: Basic escaping if DOMPurify is not loaded
    console.warn('[message-formatter] DOMPurify not available, using basic escape fallback');
    return html
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function basicMarkdown(text) {
    if (!text) return "";

    let html = text
        // Code blocks
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Bold / Italic
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/__(.*?)__/g, '<strong>$1</strong>')
        .replace(/_(.*?)_/g, '<em>$1</em>')
        // Links
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>')
        // Lists (simple)
        .replace(/^\s*[-*+]\s+(.*)/gm, '<li>$1</li>')
        // Newlines to <br> (but not if already handled by p/li/etc)
        .replace(/\n(?!<(li|ul|ol|pre|code|blockquote|p|h[1-6]|div))/g, '<br>');

    // Wrap groups of <li> in <ul>
    html = html.replace(/(<li>.*<\/li>)+/g, (match) => `<ul>${match}</ul>`);

    return html;
}

export function cleanMessageText(text) {
    if (!text) return { subject: "", body: "", attachments: [] };

    // 1. Extract Attachments from placeholder if present
    const attachmentMatch = text.match(/\[ATTACHMENTS: (.*?)\]/);
    let attachments = [];
    let clean = text;
    if (attachmentMatch) {
        try {
            attachments = JSON.parse(attachmentMatch[1]);
            clean = clean.replace(/\[ATTACHMENTS: .*?\]/, "").trim();
        } catch (e) {
            console.warn("Failed to parse attachments:", e);
        }
    }

    // 2. Separate Subject if present
    const subjectMatch = clean.match(/Subject: (.*?)(?:\n|$)/i);
    let subject = "";
    if (subjectMatch) {
        subject = subjectMatch[1].trim();
        clean = clean.replace(/Subject: .*?(\n|$)/i, "").trim();
    }

    return {
        subject: subject,
        body: clean.trim(),
        attachments: attachments
    };
}

export function formatPleasant(text, options = {}) {
    const { subject, body, attachments } = cleanMessageText(text);
    const isEmail = options.channel === 'email' || text.includes('Subject:');

    let html = "";
    if (subject) {
        html += `<div class="msg-pleasant-subject"><strong>Subject:</strong> ${subject}</div>`;
    }

    let processedBody = body;
    if (isEmail) {
        // If it's an email, it might already contain HTML. Sanitize it.
        processedBody = sanitizeHtml(body);
    } else {
        // For chat messages, apply markdown
        processedBody = basicMarkdown(body);
    }

    html += `<div class="msg-pleasant-body">${processedBody}</div>`;

    if (attachments && attachments.length > 0) {
        html += `<div class="msg-attachment-list">`;
        attachments.forEach(att => {
            html += `
                <a href="#" class="msg-attachment-item" onclick="event.preventDefault(); alert('Attachment downloads will be implemented in a follow-up')">
                    <span class="material-symbols-outlined" style="font-size:16px;">attachment</span>
                    <span>${att.name || 'document'} (${(att.size / 1024).toFixed(1)} KB)</span>
                </a>`;
        });
        html += `</div>`;
    }
    return html;
}
