/**
 * {reply} - Messages Module
 * Handles message thread loading, display, and sending
 */

import { fetchMessages, sendMessage } from './api.js';

// State
let messageOffset = 0;
let hasMoreMessages = true;
const MESSAGE_LIMIT = 30;

function channelEmoji(channel) {
    const raw = (channel ?? '').toString().toLowerCase();
    const key =
        raw.includes('whatsapp') ? 'whatsapp' :
            (raw.includes('mail') || raw.includes('email') || raw.includes('gmail') || raw.includes('imap')) ? 'email' :
                'imessage';
    const override = window.replySettings?.ui?.channels?.[key]?.emoji;
    if (override) return override;
    if (key === 'whatsapp') return '🟢';
    if (key === 'email') return '📧';
    if (raw.includes('messenger')) return '🔷';
    if (raw.includes('instagram')) return '🔴';
    if (raw.includes('linkedin')) return 'ℹ️';
    return '💬';
}

function normalizeChannelKey(channel) {
    const raw = (channel ?? '').toString().toLowerCase();
    if (raw.includes('whatsapp')) return 'whatsapp';
    if (raw.includes('mail') || raw.includes('email') || raw.includes('gmail') || raw.includes('imap')) return 'email';
    return 'imessage';
}

function getSelectedChannel() {
    const sel = document.getElementById('channel-select');
    return (sel?.value || 'imessage').toLowerCase();
}

function setSelectedChannel(channel) {
    const sel = document.getElementById('channel-select');
    if (!sel) return;
    const v = String(channel || '').toLowerCase();
    if (!v) return;
    const exists = Array.from(sel.options).some(o => o.value === v);
    if (exists) sel.value = v;
}

function setSendButtonForChannel(channel) {
    const btn = document.getElementById('btn-send');
    if (!btn) return;

    const v = String(channel || 'imessage').toLowerCase();
    if (v === 'email') {
        btn.textContent = 'Send Email';
        btn.disabled = false;
        return;
    }
    if (v === 'whatsapp') {
        btn.textContent = 'Send WhatsApp';
        btn.disabled = false;
        return;
    }
    btn.textContent = 'Send iMessage';
    btn.disabled = false;
}

function inferDefaultChannelFromMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return null;
    const lastIncoming = messages.find(m => !(m.is_from_me ?? (m.role === 'me')));
    return (lastIncoming?.channel || '').toString().toLowerCase() || null;
}

async function copyToClipboard(text) {
    if (!text) return false;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { }

    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
    } catch {
        return false;
    }
}

/**
 * Load message thread for a contact
 * @param {string} handle - Contact handle
 * @param {boolean} append - Whether to append to existing messages or replace
 */
export async function loadMessages(handle, append = false) {
    const messagesEl = document.getElementById('messages');
    if (!messagesEl) return;

    try {
        // Show loading state
        if (!append) {
            messagesEl.innerHTML = '<div style="padding:40px; text-align:center; color:#888;">Loading messages...</div>';
            messageOffset = 0;
        }

        // Fetch messages
        const messages = await fetchMessages(handle, messageOffset, MESSAGE_LIMIT);

        // Update state
        hasMoreMessages = messages.length === MESSAGE_LIMIT;

        if (!append) {
            messagesEl.innerHTML = '';
        }

        // Remove "Load More" button if it exists
        const loadMoreBtn = messagesEl.querySelector('.load-more-messages');
        if (loadMoreBtn) loadMoreBtn.remove();

        // Render messages (server returns newest-first; we keep newest at top)
        messages.forEach(msg => {
            const bubble = document.createElement('div');
            const isFromMe = !!(msg.is_from_me ?? (msg.role === 'me'));
            const channelKey = normalizeChannelKey(msg.channel || msg.source || '');
            bubble.className = `message-bubble ${isFromMe ? 'me' : 'contact'} channel-${channelKey}`;

            const text = document.createElement('div');
            text.textContent = msg.text || '';
            bubble.appendChild(text);

            const date = msg.date ? new Date(msg.date) : null;
            if (date && !Number.isNaN(date.getTime())) {
                const info = document.createElement('div');
                info.className = 'message-info';
                const channel = msg.channel || msg.source || '';
                info.textContent = `${channelEmoji(channel)} ${date.toLocaleString()}`;
                const src = (msg.source || '').toString();
                const ch = (msg.channel || '').toString();
                info.title = [ch ? `Channel: ${ch}` : null, src ? `Source: ${src}` : null].filter(Boolean).join('\n');
                bubble.appendChild(info);
            }

            messagesEl.appendChild(bubble);
        });

        // Add "Load More" button if there are more messages
        if (hasMoreMessages) {
            const btn = document.createElement('button');
            btn.className = 'load-more-messages';
            btn.textContent = 'Load Older Messages...';
            btn.style.cssText = 'margin:1rem auto; padding:0.5rem 1rem; cursor:pointer; display:block;';
            btn.onclick = () => {
                messageOffset += MESSAGE_LIMIT;
                loadMessages(handle, true);
            };
            messagesEl.appendChild(btn);
        }

        // Keep the view at the newest messages (top of the list)
        if (!append) messagesEl.scrollTop = 0;

        // Default channel: match the most recent incoming message when possible
        if (!append) {
            const inferred = inferDefaultChannelFromMessages(messages);
            if (inferred) {
                window.currentChannel = inferred;
                setSelectedChannel(inferred);
                setSendButtonForChannel(inferred);
            }
        }

    } catch (error) {
        console.error('Failed to load messages:', error);
        messagesEl.innerHTML = `
      <div style="padding:40px; text-align:center; color:#d32f2f;">
        <p>Failed to load messages</p>
        <button onclick="window.loadMessages('${handle}')" style="margin-top:1rem; padding:0.5rem 1rem; cursor:pointer;">
          Retry
        </button>
      </div>
    `;
    }
}

/**
 * Send a message to the current contact
 */
export async function handleSendMessage() {
    const chatInput = document.getElementById('chat-input');
    const messagesEl = document.getElementById('messages');
    const currentHandle = window.currentHandle;

    if (!chatInput || !currentHandle) return;

    const text = chatInput.value.trim();
    if (!text) return;

    try {
        const channel = getSelectedChannel();
        window.currentChannel = channel;
        setSendButtonForChannel(channel);

        // Send message
        const result = await sendMessage(currentHandle, text, channel);

        if (result.status === 'ok') {
            // Clear input
            chatInput.value = '';
            try { chatInput.dispatchEvent(new Event('input', { bubbles: true })); } catch { }

            // Optimistically add message to UI
            const bubble = document.createElement('div');
            bubble.className = `message-bubble me channel-${normalizeChannelKey(channel)}`;

            const textEl = document.createElement('div');
            textEl.textContent = text;
            bubble.appendChild(textEl);

            const info = document.createElement('div');
            info.className = 'message-info';
            info.textContent = `${channelEmoji(channel)} ${new Date().toLocaleString()}`;
            bubble.appendChild(info);

            messagesEl.prepend(bubble);
            messagesEl.scrollTop = 0;
        } else {
            alert('Send failed: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Failed to send message:', error);
        // WhatsApp send is best-effort; offer clipboard fallback.
        const channel = getSelectedChannel();
        if (channel === 'whatsapp') {
            const ok = await copyToClipboard(text);
            const extra = ok ? '\n\nCopied to clipboard as a fallback.' : '';
            alert(`WhatsApp send failed: ${error?.message || String(error)}${extra}`);
            return;
        }
        alert('Error: ' + (error?.message || String(error)));
    }
}

// Export to window for onclick handlers
window.loadMessages = loadMessages;
window.handleSendMessage = handleSendMessage;
window.setSelectedChannel = (channel) => {
    setSelectedChannel(channel);
    setSendButtonForChannel(channel);
};
