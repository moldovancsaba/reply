/**
 * {reply} - Messages Module
 * Handles message thread loading, display, and sending
 */

import { fetchMessages, sendMessage } from './api.js';
import { appendLinkedText, createPlatformIcon, resolvePlatformTarget } from './platform-icons.js';
import { formatPleasant } from './message-formatter.js';

// State
let messageOffset = 0;
let hasMoreMessages = true;
const MESSAGE_LIMIT = 30;
const SEND_CAPABLE_CHANNELS = new Set(['imessage', 'whatsapp', 'email', 'linkedin']);
const DRAFT_ONLY_CHANNELS = new Set(['telegram', 'discord']);

function normalizeChannelKey(channel) {
    const raw = (channel ?? '').toString().toLowerCase();
    if (raw.includes('whatsapp')) return 'whatsapp';
    if (raw.includes('telegram')) return 'telegram';
    if (raw.includes('discord')) return 'discord';
    if (raw.includes('mail') || raw.includes('email') || raw.includes('gmail') || raw.includes('imap')) return 'email';
    if (raw.includes('linkedin')) return 'linkedin';
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

function channelLabel(channel) {
    const v = String(channel || '').toLowerCase();
    if (v === 'email') return 'Email';
    if (v === 'whatsapp') return 'WhatsApp';
    if (v === 'telegram') return 'Telegram';
    if (v === 'discord') return 'Discord';
    if (v === 'linkedin') return 'LinkedIn';
    return 'iMessage';
}

function setChannelPolicyHint(channel) {
    const hint = document.getElementById('channel-policy-hint');
    if (!hint) return;

    const v = String(channel || '').toLowerCase();
    if (DRAFT_ONLY_CHANNELS.has(v)) {
        hint.style.display = 'block';
        hint.innerHTML = `<strong>Draft-only:</strong> ${channelLabel(v)} sending is disabled in {reply}. Copy/paste and send manually in the channel app.`;
        return;
    }

    hint.textContent = '';
    hint.style.display = 'none';
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
    if (v === 'linkedin') {
        btn.textContent = 'Send LinkedIn';
        btn.disabled = false;
        return;
    }
    if (DRAFT_ONLY_CHANNELS.has(v)) {
        btn.textContent = `${channelLabel(v)} Draft`;
        btn.disabled = true;
        return;
    }
    btn.textContent = 'Send iMessage';
    btn.disabled = false;
}

function applyComposerChannel(channel) {
    const v = String(channel || 'imessage').toLowerCase();
    setSelectedChannel(v);
    setSendButtonForChannel(v);
    setChannelPolicyHint(v);
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
        const loadMoreWrap = messagesEl.querySelector('.load-more-messages-wrap');
        if (loadMoreWrap) loadMoreWrap.remove();

        // Render messages
        messages.forEach(msg => {
            const bubble = document.createElement('div');
            const isFromMe = !!(msg.is_from_me ?? (msg.role === 'me'));
            const channelKey = normalizeChannelKey(msg.channel || msg.source || '');
            bubble.className = `message-bubble ${isFromMe ? 'me' : 'contact'} channel-${channelKey}`;

            const text = document.createElement('div');
            text.className = 'message-text';

            // Use rich formatting for all messages (Markdown/HTML support)
            text.innerHTML = formatPleasant(msg.text || '', { channel: channelKey });
            bubble.appendChild(text);

            const date = msg.date ? new Date(msg.date) : null;
            if (date && !Number.isNaN(date.getTime())) {
                const info = document.createElement('div');
                info.className = 'message-info';
                const channel = msg.channel || msg.source || '';
                info.classList.add('message-info--with-icon');
                const platform = resolvePlatformTarget(msg.text || '', { channelHint: channel }).platform;
                const icon = createPlatformIcon(platform, channel || 'message');
                icon.classList.add('platform-icon--sm');
                info.appendChild(icon);
                const time = document.createElement('span');
                time.textContent = date.toLocaleString();
                info.appendChild(time);

                // Annotation Star Button
                const starBtn = document.createElement('span');
                starBtn.className = 'material-symbols-outlined msg-star-btn';
                starBtn.style.fontSize = '16px';
                starBtn.style.cursor = 'pointer';
                starBtn.style.marginLeft = '6px';
                starBtn.style.color = msg.is_annotated ? '#fbbc04' : '#ccc';
                starBtn.style.transition = 'color 0.2s';
                starBtn.textContent = msg.is_annotated ? 'star' : 'star_border';
                starBtn.title = msg.is_annotated ? 'Remove Golden Example' : 'Mark as Golden Example';

                starBtn.onclick = async (e) => {
                    e.stopPropagation();
                    const nextState = !(starBtn.textContent === 'star');

                    // Optimistic UI update
                    starBtn.textContent = nextState ? 'star' : 'star_border';
                    starBtn.style.color = nextState ? '#fbbc04' : '#ccc';
                    starBtn.title = nextState ? 'Remove Golden Example' : 'Mark as Golden Example';

                    try {
                        const { buildSecurityHeaders } = await import('./api.js');
                        const res = await fetch('/api/messages/annotate', {
                            method: 'POST',
                            headers: buildSecurityHeaders(),
                            body: JSON.stringify({ id: msg.id || msg._id, is_annotated: nextState })
                        });
                        if (!res.ok) throw new Error('Failed to update annotation');
                    } catch (err) {
                        console.error('Annotation failed:', err);
                        // Revert UI on failure
                        starBtn.textContent = !nextState ? 'star' : 'star_border';
                        starBtn.style.color = !nextState ? '#fbbc04' : '#ccc';
                    }
                };
                info.appendChild(starBtn);

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
            btn.type = 'button';
            btn.className = 'btn btn-secondary load-more-messages';
            btn.textContent = 'Load older messages…';
            btn.onclick = () => {
                messageOffset += MESSAGE_LIMIT;
                loadMessages(handle, true);
            };

            const wrap = document.createElement('div');
            wrap.className = 'load-more-messages-wrap';
            wrap.appendChild(btn);
            messagesEl.appendChild(wrap);
        }

        // Keep the view at the newest messages (top of the list)
        if (!append) messagesEl.scrollTop = 0;

        // Default channel: match the most recent incoming message when possible
        if (!append) {
            const inferred = inferDefaultChannelFromMessages(messages);
            if (inferred) {
                window.currentChannel = inferred;
                applyComposerChannel(inferred);
            }
        }

    } catch (error) {
        console.error('Failed to load messages:', error);
        messagesEl.innerHTML = '';
        const errorContainer = document.createElement('div');
        errorContainer.style.padding = '40px';
        errorContainer.style.textAlign = 'center';
        errorContainer.style.color = '#d32f2f';

        const errorMsg = document.createElement('p');
        errorMsg.textContent = 'Failed to load messages';
        errorContainer.appendChild(errorMsg);

        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn btn-secondary mt-md';
        retryBtn.textContent = 'Retry';
        retryBtn.onclick = () => window.loadMessages(handle);
        errorContainer.appendChild(retryBtn);

        messagesEl.appendChild(errorContainer);
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
        applyComposerChannel(channel);

        if (!SEND_CAPABLE_CHANNELS.has(channel)) {
            const copied = await copyToClipboard(text);
            const copyHint = copied ? '\n\nDraft copied to clipboard.' : '';
            alert(`${channelLabel(channel)} is draft-only in {reply}.${copyHint}`);
            return;
        }

        // Guard: if the current contact's handle is a non-iMessage URI (e.g. linkedin://)
        // attempt to find a valid phone/email for iMessage.
        let targetHandle = currentHandle;
        if (channel === 'imessage' && (currentHandle || '').match(/^([a-z]+):\/\//i) && !(currentHandle || '').match(/^imessage:\/\//i)) {
            const normalizedHandle = String(currentHandle).toLowerCase();
            const currentContact = (window.conversations || []).find(c =>
                String(c.handle).toLowerCase() === normalizedHandle ||
                (c.latestHandle && String(c.latestHandle).toLowerCase() === normalizedHandle)
            );

            console.log(`[iMessage] Attempting to resolve iMessage handle for: ${currentHandle}`, { contactFound: !!currentContact });

            if (currentContact && currentContact.channels) {
                const phone = (currentContact.channels.phone || [])[0];
                const email = (currentContact.channels.email || [])[0];
                if (phone) {
                    targetHandle = phone;
                    console.log(`[iMessage] Resolved to phone: ${targetHandle}`);
                } else if (email) {
                    targetHandle = email;
                    console.log(`[iMessage] Resolved to email: ${targetHandle}`);
                } else {
                    const scheme = (currentHandle.match(/^([a-z]+):\/\//i) || [])[1] || 'unknown';
                    alert(`Cannot send iMessage to this contact.\nThis contact's handle is a ${scheme}:// URI and no phone/email is known.\n\nSwitch to ${scheme} or add a phone number/email to their profile.`);
                    return;
                }
            } else {
                const scheme = (currentHandle.match(/^([a-z]+):\/\//i) || [])[1] || 'unknown';
                alert(`Cannot send iMessage to this contact.\nThis contact's handle is a ${scheme}:// URI.\n\nSwitch to ${scheme} or pick a phone number / email address.`);
                return;
            }
        }

        console.log(`[SendMessage] channel=${channel}, targetHandle=${targetHandle}, textLen=${text.length}`);
        // Send message
        const result = await sendMessage(targetHandle, text, channel);
        console.log(`[SendMessage] Result status: ${result?.status}`);

        if (result?.status !== 'ok') {
            alert(`Failed to send message via ${channel}: ${result?.error || 'unknown error'}`);
            return;
        }

        // Clear input
        chatInput.value = '';
        // Refresh contact list to move current contact to top
        if (typeof window.loadConversations === 'function') {
            await window.loadConversations();
        }
        // Load messages for the actual target handle (phone/email) if it differs
        const loadHandle = targetHandle !== currentHandle ? targetHandle : currentHandle;
        await loadMessages(loadHandle);
        try { chatInput.dispatchEvent(new Event('input', { bubbles: true })); } catch { }

        // Optimistically add message to UI
        const bubble = document.createElement('div');
        bubble.className = `message-bubble me channel-${normalizeChannelKey(channel)}`;

        const textEl = document.createElement('div');
        textEl.className = 'message-text';
        appendLinkedText(textEl, text, { channelHint: channel });
        bubble.appendChild(textEl);

        const info = document.createElement('div');
        info.className = 'message-info';
        info.classList.add('message-info--with-icon');
        const platform = resolvePlatformTarget(text, { channelHint: channel }).platform;
        const icon = createPlatformIcon(platform, channel || 'message');
        icon.classList.add('platform-icon--sm');
        info.appendChild(icon);
        const time = document.createElement('span');
        time.textContent = new Date().toLocaleString();
        info.appendChild(time);
        bubble.appendChild(info);

        messagesEl.prepend(bubble);
        messagesEl.scrollTop = 0;

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
    applyComposerChannel(channel);
};
