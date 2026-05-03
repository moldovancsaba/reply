/**
 * {reply} - Messages Module
 * Handles message thread loading, display, and sending
 */

import { fetchMessages, sendMessage } from './api.js';
import { APP_DISPLAY_NAME } from './branding.js';
import { applyIconFallback, setMaterialIcon } from './icon-fallback.js';
import { UI } from './ui.js';
import { appendLinkedText, createPlatformIcon, resolvePlatformTarget } from './platform-icons.js';
import { formatPleasant } from './message-formatter.js';

// State
const MESSAGE_LIMIT = 20;
const THREAD_CACHE_VERSION = 'v5';
const SEND_CAPABLE_CHANNELS = new Set(['imessage', 'whatsapp', 'email', 'linkedin']);
const DRAFT_ONLY_CHANNELS = new Set(['telegram', 'discord']);
let activeThreadLoadToken = 0;
let sendInFlight = false;
let gapObserver = null;
let threadWindowState = null;

function threadCacheKey(handle) {
    return `reply.thread.${THREAD_CACHE_VERSION}.${encodeURIComponent(String(handle || ''))}`;
}

function readCachedThread(handle) {
    try {
        const raw = window.localStorage?.getItem(threadCacheKey(handle));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed) return null;
        if (!Array.isArray(parsed.messages) && !Array.isArray(parsed.newestMessages)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeCachedThread(handle, payload) {
    try {
        if (!window.localStorage || !handle || !payload || typeof payload !== 'object') return;
        window.localStorage.setItem(threadCacheKey(handle), JSON.stringify({
            ...payload,
            cachedAt: new Date().toISOString(),
        }));
    } catch {
        // Non-blocking cache only.
    }
}

function compareMessagesAscending(a, b) {
    const at = a?.date ? new Date(a.date).getTime() : 0;
    const bt = b?.date ? new Date(b.date).getTime() : 0;
    return at - bt;
}

function sortMessagesAscending(messages) {
    return [...(Array.isArray(messages) ? messages : [])].sort(compareMessagesAscending);
}

function dedupeMessages(messages) {
    const out = [];
    const seen = new Set();
    for (const msg of Array.isArray(messages) ? messages : []) {
        const key = String(msg?.id || `${msg?.path || ''}|${msg?.date || ''}|${msg?.text || ''}`);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(msg);
    }
    return out;
}

function createMessageBubble(msg) {
    const row = document.createElement('div');
    const bubble = document.createElement('div');
    const isFromMe = !!(msg.is_from_me ?? (msg.role === 'me'));
    const channelKey = normalizeChannelKey(msg.channel || msg.source || '');
    row.className = `message-row ${isFromMe ? 'me' : 'contact'}`;
    bubble.className = `message-bubble ${isFromMe ? 'me' : 'contact'} channel-${channelKey}`;

    const text = document.createElement('div');
    text.className = 'message-text';
    text.innerHTML = formatPleasant(msg.text || '', { channel: channelKey });
    applyIconFallback(text);
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

        const starBtn = document.createElement('span');
        starBtn.className = 'material-symbols-outlined msg-star-btn';
        starBtn.style.fontSize = '16px';
        starBtn.style.cursor = 'pointer';
        starBtn.style.marginLeft = '6px';
        starBtn.style.color = msg.is_annotated ? '#fbbc04' : '#ccc';
        starBtn.style.transition = 'color 0.2s';
        setMaterialIcon(starBtn, msg.is_annotated ? 'star' : 'star-border', {
            label: msg.is_annotated ? 'Remove Golden Example' : 'Mark as Golden Example',
            tooltip: msg.is_annotated ? 'Remove Golden Example' : 'Mark as Golden Example',
        });

        starBtn.onclick = async (e) => {
            e.stopPropagation();
            const currentState = starBtn.dataset.iconName === 'star';
            const nextState = !currentState;

            starBtn.style.color = nextState ? '#fbbc04' : '#ccc';
            setMaterialIcon(starBtn, nextState ? 'star' : 'star-border', {
                label: nextState ? 'Remove Golden Example' : 'Mark as Golden Example',
                tooltip: nextState ? 'Remove Golden Example' : 'Mark as Golden Example',
            });

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
                starBtn.style.color = !nextState ? '#fbbc04' : '#ccc';
                setMaterialIcon(starBtn, !nextState ? 'star' : 'star-border', {
                    label: !nextState ? 'Remove Golden Example' : 'Mark as Golden Example',
                    tooltip: !nextState ? 'Remove Golden Example' : 'Mark as Golden Example',
                });
            }
        };
        info.appendChild(starBtn);

        const src = (msg.source || '').toString();
        const ch = (msg.channel || '').toString();
        info.title = [ch ? `Channel: ${ch}` : null, src ? `Source: ${src}` : null].filter(Boolean).join('\n');
        bubble.appendChild(info);
    }

    row.appendChild(bubble);
    return row;
}

function loadedMessageCount(state) {
    return dedupeMessages([...(state?.oldestMessages || []), ...(state?.newestMessages || [])]).length;
}

function remainingGapCount(state) {
    return Math.max(0, Number(state?.total || 0) - loadedMessageCount(state));
}

function ensureGapObserver(messagesEl) {
    if (gapObserver) gapObserver.disconnect();
    gapObserver = new IntersectionObserver((entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (!threadWindowState?.hasGap || threadWindowState.loadingGap) return;
        loadThreadGapChunk(messagesEl).catch((error) => {
            console.error('Failed to load gap chunk:', error);
        });
    }, { root: messagesEl, rootMargin: '120px 0px 120px 0px', threshold: 0.1 });
}

function updateGapIndicator(messagesEl) {
    const indicator = messagesEl.querySelector('.message-gap-indicator');
    if (!indicator) return;
    const remaining = remainingGapCount(threadWindowState);
    if (remaining <= 0) {
        indicator.remove();
        threadWindowState.hasGap = false;
        return;
    }
    indicator.querySelector('.message-gap-count').textContent = `${remaining} older/newer messages remain`;
}

function renderGapIndicator(messagesEl) {
    if (!threadWindowState?.hasGap) return;
    const remaining = remainingGapCount(threadWindowState);
    if (remaining <= 0) return;

    const gap = document.createElement('div');
    gap.className = 'message-gap-indicator';
    gap.innerHTML = `
      <div class="message-gap-indicator__line"></div>
      <div class="message-gap-indicator__body">
        <span class="message-gap-count">${remaining} older/newer messages remain</span>
        <button type="button" class="btn btn-secondary btn-sm message-gap-button">Load more history</button>
      </div>
      <div class="message-gap-indicator__line"></div>
    `;
    gap.querySelector('.message-gap-button')?.addEventListener('click', () => {
        loadThreadGapChunk(messagesEl).catch((error) => {
            console.error('Failed to load gap chunk:', error);
        });
    });
    messagesEl.appendChild(gap);
    ensureGapObserver(messagesEl);
    gapObserver.observe(gap);
}

function renderThreadWindow(messagesEl, { scrollToBottom = false } = {}) {
    messagesEl.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const oldest = sortMessagesAscending(threadWindowState?.oldestMessages || []);
    const newest = sortMessagesAscending(threadWindowState?.newestMessages || []);
    const newestIds = new Set(newest.map((msg) => String(msg?.id || '')));

    oldest.forEach((msg) => fragment.appendChild(createMessageBubble(msg)));
    messagesEl.appendChild(fragment);

    const distinctOldestCount = oldest.filter((msg) => !newestIds.has(String(msg?.id || ''))).length;
    threadWindowState.oldestLoadedCount = distinctOldestCount;
    threadWindowState.newestLoadedCount = newest.length;
    threadWindowState.hasGap = remainingGapCount(threadWindowState) > 0;

    renderGapIndicator(messagesEl);

    const newestFragment = document.createDocumentFragment();
    newest.forEach((msg) => {
        const key = String(msg?.id || '');
        if (key && oldest.some((oldMsg) => String(oldMsg?.id || '') === key)) return;
        newestFragment.appendChild(createMessageBubble(msg));
    });
    messagesEl.appendChild(newestFragment);

    if (scrollToBottom) {
        requestAnimationFrame(() => {
            messagesEl.scrollTop = messagesEl.scrollHeight;
        });
    }
}

async function loadThreadGapChunk(messagesEl) {
    if (!threadWindowState?.handle || threadWindowState.loadingGap || !threadWindowState.hasGap) return;
    const remaining = remainingGapCount(threadWindowState);
    if (remaining <= 0) {
        threadWindowState.hasGap = false;
        updateGapIndicator(messagesEl);
        return;
    }

    threadWindowState.loadingGap = true;
    try {
        const gap = messagesEl.querySelector('.message-gap-indicator');
        const gapTopBefore = gap?.getBoundingClientRect().top ?? 0;
        const response = await fetchMessages(
            threadWindowState.handle,
            threadWindowState.oldestLoadedCount,
            Math.min(MESSAGE_LIMIT, remaining),
            false,
            'oldest'
        );
        const chunk = dedupeMessages(sortMessagesAscending(response.messages || []));
        if (!chunk.length) {
            threadWindowState.hasGap = false;
            updateGapIndicator(messagesEl);
            return;
        }

        const existingIds = new Set(dedupeMessages([
            ...(threadWindowState.oldestMessages || []),
            ...(threadWindowState.newestMessages || []),
        ]).map((msg) => String(msg?.id || '')));
        const newChunk = chunk.filter((msg) => !existingIds.has(String(msg?.id || '')));
        threadWindowState.oldestMessages = dedupeMessages([
            ...(threadWindowState.oldestMessages || []),
            ...newChunk,
        ]);
        threadWindowState.oldestLoadedCount += newChunk.length;

        if (newChunk.length) {
            const fragment = document.createDocumentFragment();
            newChunk.forEach((msg) => fragment.appendChild(createMessageBubble(msg)));
            const indicator = messagesEl.querySelector('.message-gap-indicator');
            const previousHeight = messagesEl.scrollHeight;
            indicator?.before(fragment);
            const nextHeight = messagesEl.scrollHeight;
            if (indicator) {
                const gapTopAfter = indicator.getBoundingClientRect().top;
                messagesEl.scrollTop += (nextHeight - previousHeight) + (gapTopAfter - gapTopBefore);
            }
        }

        threadWindowState.hasGap = remainingGapCount(threadWindowState) > 0;
        updateGapIndicator(messagesEl);
    } finally {
        threadWindowState.loadingGap = false;
    }
}

function seedDraft(draftText, force = false) {
    const chatInput = document.getElementById('chat-input');
    if (!chatInput || !draftText) return;
    if (force || !chatInput.value.trim()) {
        chatInput.value = draftText;
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

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
        hint.innerHTML = `<strong>Draft-only:</strong> ${channelLabel(v)} sending is disabled in ${APP_DISPLAY_NAME}. Copy/paste and send manually in the channel app.`;
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
        btn.disabled = sendInFlight;
        return;
    }
    if (v === 'whatsapp') {
        btn.textContent = 'Send WhatsApp';
        btn.disabled = sendInFlight;
        return;
    }
    if (v === 'linkedin') {
        btn.textContent = 'Send LinkedIn';
        btn.disabled = sendInFlight;
        return;
    }
    if (DRAFT_ONLY_CHANNELS.has(v)) {
        btn.textContent = `${channelLabel(v)} Draft`;
        btn.disabled = true;
        return;
    }
    btn.textContent = 'Send iMessage';
    btn.disabled = sendInFlight;
}

function setSendPending(channel, pending) {
    sendInFlight = pending;
    const btn = document.getElementById('btn-send');
    if (!btn) return;
    if (pending) {
        btn.disabled = true;
        btn.textContent = `Sending ${channelLabel(channel)}…`;
        return;
    }
    setSendButtonForChannel(channel);
}

function applyComposerChannel(channel) {
    const v = String(channel || 'imessage').toLowerCase();
    setSelectedChannel(v);
    setSendButtonForChannel(v);
    setChannelPolicyHint(v);
}

function inferDefaultChannelFromMessages(messages) {
    if (Array.isArray(messages) && messages.length > 0) {
        const lastIncoming = messages.find(m => !(m.is_from_me ?? (m.role === 'me')));
        if (lastIncoming?.channel) {
            return (lastIncoming.channel).toString().toLowerCase();
        }
    }

    // Fallback: check window.conversations if we know the current handle
    if (window.currentHandle && window.conversations) {
        const c = window.conversations.find(c => c.handle === window.currentHandle);
        if (c && c.channels) {
            if (c.channels.whatsapp && c.channels.whatsapp.length > 0) return 'whatsapp';
            if (c.channels.email && c.channels.email.length > 0) return 'email';
            if (c.channels.linkedin && c.channels.linkedin.length > 0) return 'linkedin';
        }

        // Base64 regex heuristic (WhatsApp IDs look like CNeag...)
        if (/^[a-zA-Z0-9+/]+={0,2}$/.test(window.currentHandle) && window.currentHandle.length >= 20) {
            return 'whatsapp';
        }
    }

    return null;
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
    const loadToken = ++activeThreadLoadToken;

    try {
        if (!append) {
            if (gapObserver) gapObserver.disconnect();
            threadWindowState = null;
            const cached = readCachedThread(handle);
            if (cached?.messages?.length) {
                threadWindowState = {
                    handle,
                    total: cached.total || cached.messages.length,
                    oldestMessages: cached.oldestMessages || [],
                    newestMessages: cached.newestMessages || cached.messages || [],
                    oldestLoadedCount: (cached.oldestMessages || []).length,
                    newestLoadedCount: (cached.newestMessages || cached.messages || []).length,
                    hasGap: Boolean(cached.hasGap),
                    loadingGap: false,
                };
                renderThreadWindow(messagesEl, { scrollToBottom: true });
            } else if (!messagesEl.children.length) {
                messagesEl.innerHTML = '<div style="padding:40px; text-align:center; color:#888;">Loading messages...</div>';
            }
        }

        if (append && threadWindowState) {
            await loadThreadGapChunk(messagesEl);
            return;
        }

        const newestResponse = await fetchMessages(handle, 0, MESSAGE_LIMIT, false, 'newest');
        if (loadToken !== activeThreadLoadToken || window.currentHandle !== handle) return;
        const total = newestResponse.total || newestResponse.messages.length;
        let oldestResponse = { messages: [], total, hasMore: false };
        if (total > MESSAGE_LIMIT) {
            oldestResponse = await fetchMessages(handle, 0, MESSAGE_LIMIT, false, 'oldest');
            if (loadToken !== activeThreadLoadToken || window.currentHandle !== handle) return;
        }

        const oldestMessages = dedupeMessages(sortMessagesAscending(oldestResponse.messages || []));
        const newestMessages = dedupeMessages(sortMessagesAscending(newestResponse.messages || []));
        threadWindowState = {
            handle,
            total,
            oldestMessages: total > MESSAGE_LIMIT ? oldestMessages : [],
            newestMessages,
            oldestLoadedCount: total > MESSAGE_LIMIT ? oldestMessages.length : 0,
            newestLoadedCount: newestMessages.length,
            hasGap: Math.max(0, total - dedupeMessages([...oldestMessages, ...newestMessages]).length) > 0,
            loadingGap: false,
        };

        renderThreadWindow(messagesEl, { scrollToBottom: true });
        if (!append) {
            writeCachedThread(handle, {
                total,
                oldestMessages: threadWindowState.oldestMessages,
                newestMessages: threadWindowState.newestMessages,
                hasGap: threadWindowState.hasGap,
                messages: newestMessages,
            });
        }

        // Default channel: match the most recent incoming message when possible or context
        if (!append) {
            const inferred = inferDefaultChannelFromMessages(newestMessages);
            if (inferred) {
                window.currentChannel = inferred;
                applyComposerChannel(inferred);
            } else {
                // Global fallback
                window.currentChannel = 'imessage';
                applyComposerChannel('imessage');
            }
        }

    } catch (error) {
        if (loadToken !== activeThreadLoadToken || window.currentHandle !== handle) return;
        console.error('Failed to load messages:', error);
        UI.showToast(error?.message || 'Failed to load messages', 'error');
        if (!messagesEl.children.length) {
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
    if (sendInFlight) return;

    try {
        const channel = getSelectedChannel();
        window.currentChannel = channel;
        applyComposerChannel(channel);

        if (!SEND_CAPABLE_CHANNELS.has(channel)) {
            const copied = await copyToClipboard(text);
            const copyHint = copied ? '\n\nDraft copied to clipboard.' : '';
            alert(`${channelLabel(channel)} is draft-only in ${APP_DISPLAY_NAME}.${copyHint}`);
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
        setSendPending(channel, true);
        const draftContext =
            typeof window.getCurrentDraftContext === 'function'
                ? window.getCurrentDraftContext(currentHandle)
                : null;
        const result = await sendMessage(targetHandle, text, channel, draftContext);
        console.log(`[SendMessage] Result status: ${result?.status}`);

        if (result?.status !== 'ok') {
            UI.showToast(
                `Failed to send via ${channel}: ${result?.error || 'unknown error'}`,
                'error'
            );
            return;
        }

        // Clear input
        chatInput.value = '';
        try {
            window.localStorage?.removeItem(`reply.suggestion.v1.${encodeURIComponent(String(currentHandle || ''))}`);
        } catch {}
        if (typeof window.clearCachedSuggestion === 'function') {
            window.clearCachedSuggestion(currentHandle);
        }
        // Refresh contact list to move current contact to top
        if (typeof window.loadConversations === 'function') {
            await window.loadConversations();
        }
        // Reload the selected contact thread; the server now resolves aliases/verified handles.
        await loadMessages(currentHandle);
        try { chatInput.dispatchEvent(new Event('input', { bubbles: true })); } catch { }

    } catch (error) {
        console.error('Failed to send message:', error);
        const channel = getSelectedChannel();
        const base = error?.message || String(error);
        // Single surface: composer errors use toast only (api layer does not toast for sends).
        if (channel === 'whatsapp') {
            const ok = await copyToClipboard(text);
            const extra = ok ? '\n\nCopied to clipboard as a fallback.' : '';
            UI.showToast(`WhatsApp send failed: ${base}${extra}`, 'error');
            return;
        }
        UI.showToast(base, 'error');
    } finally {
        setSendPending(getSelectedChannel(), false);
    }
}

// Export to window for onclick handlers
window.loadMessages = loadMessages;
window.handleSendMessage = handleSendMessage;
window.seedDraft = seedDraft;
window.setSelectedChannel = (channel) => {
    applyComposerChannel(channel);
};
