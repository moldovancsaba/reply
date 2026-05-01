/**
 * {reply} - Main Application Entry Point
 * Initializes the application and sets up event listeners
 */

import {
  loadConversations,
  selectContact,
  setConversationsQuery,
  setConversationsSort,
  applyConversationSortOnly,
  normalizeConversationSort,
  isValidConversationSortMode,
  CONVERSATION_SORT_STORAGE_KEY,
} from './contacts.js';
import { handleSendMessage } from './messages.js';
import { getSettings, buildSecurityHeaders, reportDraftReplacement } from './api.js';
import './dashboard.js?v=2.2';
import './kyc.js?v=2.1';
import { applyReplyUiSettings } from './settings.js?v=2.5';
import { applyIconFallback } from './icon-fallback.js';
import { UI } from './ui.js';
import { maybeShowOnboarding } from './onboarding.js?v=2.1';

// Global state
window.currentHandle = null;
window.conversations = [];
const SUGGESTION_CACHE_VERSION = 'v1';
const suggestionJobs = new Map();
const composerDraftCache = new Map();
const autoAppliedSuggestionDrafts = new Map();
let activeContactDraftPollInFlight = false;
const ACTIVE_CONTACT_DRAFT_POLL_MS = 12000;

// Speech recognition state
let speechRecognizer = null;
let speechIsRecording = false;
let speechBaseText = '';
let speechFinalText = '';
const LAYOUT_SIDEBAR_COLLAPSED_KEY = 'reply.layout.sidebarCollapsed';
const LAYOUT_PROFILE_COLLAPSED_KEY = 'reply.layout.profileCollapsed';
const SETTINGS_TAB_BY_CHANNEL = {
  openclaw: 'ai-status',
  ollama: 'ai-status',
  worker: 'worker',
  imessage: 'messaging',
  whatsapp: 'messaging',
  linkedin: 'messaging',
  'linkedin-posts': 'messaging',
  notes: 'messaging',
  contacts: 'messaging',
  kyc: 'worker',
  mail: 'email',
  email: 'email',
};

function suggestionStorageKey(handle) {
  return `reply.suggestion.${SUGGESTION_CACHE_VERSION}.${encodeURIComponent(String(handle || ''))}`;
}

function readCachedSuggestion(handle) {
  try {
    if (!handle || !window.localStorage) return null;
    const raw = window.localStorage.getItem(suggestionStorageKey(handle));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.suggestion) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedSuggestion(handle, payload) {
  try {
    if (!handle || !window.localStorage) return;
    window.localStorage.setItem(
      suggestionStorageKey(handle),
      JSON.stringify({
        ...payload,
        cachedAt: new Date().toISOString(),
      })
    );
  } catch {
    // Non-blocking cache only.
  }
}

function clearCachedSuggestion(handle) {
  try {
    if (!handle || !window.localStorage) return;
    window.localStorage.removeItem(suggestionStorageKey(handle));
  } catch {
    // ignore
  }
}

window.openChannelSettings = function openChannelSettings(channel) {
  const key = String(channel || '').trim().toLowerCase();
  const tab = SETTINGS_TAB_BY_CHANNEL[key] || 'general';
  window.location.href = `settings.html#${encodeURIComponent(tab)}`;
};

applyIconFallback(document);

function cacheComposerDraft(handle, text) {
  if (!handle) return;
  const value = String(text || '');
  if (!value.trim()) {
    composerDraftCache.delete(handle);
    return;
  }
  composerDraftCache.set(handle, value);
}

function getCachedComposerDraft(handle) {
  if (!handle) return '';
  return composerDraftCache.get(handle) || '';
}

function setSuggestionExplanation(text = '') {
  const explanationEl = document.getElementById('suggestion-explanation');
  if (!explanationEl) return;
  if (text) {
    explanationEl.textContent = text;
    explanationEl.style.display = 'block';
  } else {
    explanationEl.textContent = '';
    explanationEl.style.display = 'none';
  }
}

function normalizeDraftText(raw) {
  return String(raw || '').trim();
}

function getActiveComposerText() {
  const chatInput = document.getElementById('chat-input');
  return normalizeDraftText(chatInput?.value || '');
}

function canAutoApplySuggestionDraft(handle, nextDraft, options = {}) {
  if (options.force === true) return true;
  const currentText = getActiveComposerText();
  if (!currentText) return true;
  const previousAutoDraft = normalizeDraftText(autoAppliedSuggestionDrafts.get(handle) || '');
  return previousAutoDraft && currentText === previousAutoDraft && currentText !== normalizeDraftText(nextDraft);
}

function reconcileContactDraft(handle, draftText, options = {}) {
  const normalizedHandle = String(handle || '').trim();
  const normalizedDraft = normalizeDraftText(draftText);
  if (!normalizedHandle || !normalizedDraft) {
    if (String(window.currentHandle || '') === normalizedHandle) {
      refreshSuggestButtonState();
    }
    return false;
  }

  const cached = readCachedSuggestion(normalizedHandle);
  if (normalizeDraftText(cached?.suggestion || '') !== normalizedDraft) {
    writeCachedSuggestion(normalizedHandle, {
      suggestion: normalizedDraft,
      explanation: options.explanation || 'Suggestion ready for this conversation.'
    });
  }

  let applied = false;
  if (String(window.currentHandle || '') === normalizedHandle && canAutoApplySuggestionDraft(normalizedHandle, normalizedDraft, options)) {
    if (typeof window.seedDraft === 'function') {
      window.seedDraft(normalizedDraft, true);
      autoAppliedSuggestionDrafts.set(normalizedHandle, normalizedDraft);
      applied = true;
    }
  }

  if (String(window.currentHandle || '') === normalizedHandle) {
    const explanation = options.explanation
      || (applied
        ? 'Suggestion ready for this conversation.'
        : 'Suggestion ready for this conversation. Clear the composer or press Suggest again to replace the current draft.');
    setSuggestionExplanation(explanation);
  }

  refreshSuggestButtonState();
  return applied;
}

function applyLayoutChromeState() {
  const body = document.body;
  if (!body) return;
  const sidebarCollapsed = body.classList.contains('sidebar-collapsed');
  const profileCollapsed = body.classList.contains('profile-collapsed');
  document.getElementById('btn-show-sidebar')?.classList.toggle('u-display-none', !sidebarCollapsed);
  document.getElementById('btn-show-profile')?.classList.toggle('u-display-none', !profileCollapsed);
  const sidebarToggle = document.getElementById('btn-toggle-sidebar');
  if (sidebarToggle) sidebarToggle.textContent = sidebarCollapsed ? 'left_panel_open' : 'left_panel_close';
  const profileToggle = document.getElementById('btn-toggle-profile');
  if (profileToggle) profileToggle.textContent = profileCollapsed ? 'right_panel_open' : 'Collapse';
  const profileToggleEmpty = document.getElementById('btn-toggle-profile-empty');
  if (profileToggleEmpty) profileToggleEmpty.textContent = profileCollapsed ? 'Expand' : 'Collapse';
}

function setSidebarCollapsed(collapsed) {
  const body = document.body;
  if (!body) return;
  body.classList.toggle('sidebar-collapsed', !!collapsed);
  try {
    window.localStorage?.setItem(LAYOUT_SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {}
  applyLayoutChromeState();
}

function setProfileCollapsed(collapsed) {
  const body = document.body;
  if (!body) return;
  body.classList.toggle('profile-collapsed', !!collapsed);
  try {
    window.localStorage?.setItem(LAYOUT_PROFILE_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {}
  applyLayoutChromeState();
}

function restoreLayoutChromeState() {
  try {
    setSidebarCollapsed(window.localStorage?.getItem(LAYOUT_SIDEBAR_COLLAPSED_KEY) === '1');
    setProfileCollapsed(window.localStorage?.getItem(LAYOUT_PROFILE_COLLAPSED_KEY) === '1');
  } catch {
    applyLayoutChromeState();
  }
}

function refreshSuggestButtonState() {
  const btnSuggest = document.getElementById('btn-suggest');
  if (!btnSuggest) return;
  const handle = window.currentHandle;
  if (!handle) {
    btnSuggest.disabled = true;
    btnSuggest.textContent = '💡 Suggest';
    return;
  }

  const job = suggestionJobs.get(handle);
  const cached = readCachedSuggestion(handle);
  if (job?.status === 'pending') {
    btnSuggest.disabled = true;
    btnSuggest.textContent = '⏳ Suggesting…';
    return;
  }

  btnSuggest.disabled = false;
  btnSuggest.textContent = cached?.suggestion ? '💡 Suggest Ready' : '💡 Suggest';
}

function applyCachedSuggestionForHandle(handle, options = {}) {
  const payload = readCachedSuggestion(handle);
  if (!payload || !payload.suggestion) {
    setSuggestionExplanation('');
    refreshSuggestButtonState();
    return false;
  }

  if (String(window.currentHandle || '') !== String(handle || '')) {
    refreshSuggestButtonState();
    return false;
  }

  const chatInput = document.getElementById('chat-input');
  const existingDraft = String(chatInput?.value || '').trim();
  const shouldForce = options.force === true;
  const canSeed = shouldForce || !existingDraft;

  if (canSeed && typeof window.seedDraft === 'function') {
    window.seedDraft(payload.suggestion, true);
    autoAppliedSuggestionDrafts.set(String(handle || ''), normalizeDraftText(payload.suggestion));
  }

  const explanation = payload.explanation
    || (!canSeed ? 'Background suggestion ready for this conversation. Clear the composer or press Suggest again to replace the current draft.' : '');
  setSuggestionExplanation(explanation);
  refreshSuggestButtonState();
  return canSeed;
}

async function requestBackgroundSuggestion(handle, existingDraft = '') {
  if (!handle) return;
  if (suggestionJobs.get(handle)?.status === 'pending') return;

  suggestionJobs.set(handle, { status: 'pending', startedAt: Date.now() });
  refreshSuggestButtonState();
  if (String(window.currentHandle || '') === String(handle)) {
    setSuggestionExplanation('Generating a suggestion in the background. You can switch conversations and come back later.');
  }

  try {
    if (existingDraft) {
      await reportDraftReplacement({
        handle,
        original_text: existingDraft,
        reason: 'suggest_replace'
      });
    }

    const res = await fetch('/api/suggest', {
      method: 'POST',
      headers: buildSecurityHeaders(),
      body: JSON.stringify({ handle }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data && (data.error || data.message)) || `Suggest failed (${res.status})`);
    }

    const suggestion = data?.suggestion || '';
    const explanation = data?.explanation || '';
    if (!suggestion) throw new Error('No suggestion text returned');

    writeCachedSuggestion(handle, { suggestion, explanation });
    suggestionJobs.delete(handle);

    const applied = applyCachedSuggestionForHandle(handle, {
      force: String(window.currentHandle || '') === String(handle)
    });
    UI.showToast(
      String(window.currentHandle || '') === String(handle)
        ? (applied ? 'Suggestion ready' : 'Suggestion ready in background for this conversation')
        : `Suggestion ready for ${handle}`,
      'success',
      2400
    );
  } catch (e) {
    suggestionJobs.set(handle, {
      status: 'error',
      finishedAt: Date.now(),
      message: e?.message || 'Suggest request failed'
    });
    if (String(window.currentHandle || '') === String(handle)) {
      setSuggestionExplanation('');
    }
    UI.showToast(e?.message || 'Suggest request failed', 'error');
  } finally {
    refreshSuggestButtonState();
  }
}

async function pollActiveConversationDraft() {
  const handle = String(window.currentHandle || '').trim();
  if (!handle || activeContactDraftPollInFlight) return;

  activeContactDraftPollInFlight = true;
  try {
    const res = await fetch(`/api/kyc?handle=${encodeURIComponent(handle)}`, {
      headers: buildSecurityHeaders({ includeJsonContentType: false }),
    });
    if (!res.ok) {
      throw new Error(`Active contact poll failed (${res.status})`);
    }
    const data = await res.json().catch(() => ({}));
    if (data && typeof data.draft === 'string' && data.draft.trim()) {
      reconcileContactDraft(handle, data.draft, {
        explanation: 'Suggestion ready for this conversation.'
      });
    }
  } catch (e) {
    console.warn('[{reply}] Active contact draft poll failed:', e?.message || e);
  } finally {
    activeContactDraftPollInFlight = false;
  }
}

async function init() {
  console.log('🚀 Reply initializing...');

  setupEventListeners();

  try {
    const settings = await getSettings();
    applyReplyUiSettings(settings);
  } catch (e) {
    console.warn('Settings not loaded:', e?.message || e);
  }

  await loadConversations();

  let pendingHandle = null;
  try {
    pendingHandle = sessionStorage.getItem('reply_open_handle');
    if (pendingHandle) sessionStorage.removeItem('reply_open_handle');
  } catch {
    pendingHandle = null;
  }

  if (pendingHandle) {
    await selectContact(pendingHandle);
  } else {
    await selectContact(null);
  }

  maybeShowOnboarding();
  refreshSuggestButtonState();
  restoreLayoutChromeState();

  console.log('✅ Reply ready!');
}

function setupEventListeners() {
  UI.initThemeControls();

  const btnDash = document.getElementById('btn-dash');
  if (btnDash) btnDash.onclick = () => { if (typeof window.selectContact === 'function') window.selectContact(null); };

  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) btnSettings.onclick = () => { window.location.href = 'settings.html'; };

  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  if (btnToggleSidebar) btnToggleSidebar.onclick = () => setSidebarCollapsed(true);

  const btnShowSidebar = document.getElementById('btn-show-sidebar');
  if (btnShowSidebar) btnShowSidebar.onclick = () => setSidebarCollapsed(false);

  const btnToggleProfile = document.getElementById('btn-toggle-profile');
  if (btnToggleProfile) btnToggleProfile.onclick = () => setProfileCollapsed(true);

  const btnToggleProfileEmpty = document.getElementById('btn-toggle-profile-empty');
  if (btnToggleProfileEmpty) btnToggleProfileEmpty.onclick = () => setProfileCollapsed(true);

  const btnShowProfile = document.getElementById('btn-show-profile');
  if (btnShowProfile) btnShowProfile.onclick = () => setProfileCollapsed(false);

  document.querySelectorAll('.sidebar-nav-btn[data-nav-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = (btn.getAttribute('data-nav-action') || '').trim();
      if (action === 'dashboard') {
        if (typeof window.selectContact === 'function') window.selectContact(null);
        return;
      }
      if (action === 'settings') {
        window.location.href = 'settings.html';
      }
    });
  });

  const btnSend = document.getElementById('btn-send');
  if (btnSend) btnSend.onclick = handleSendMessage;

  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    const autoResize = () => {
      chatInput.style.height = 'auto';
      const next = Math.min(chatInput.scrollHeight, 150);
      chatInput.style.height = `${next}px`;
      chatInput.style.overflowY = chatInput.scrollHeight > 150 ? 'auto' : 'hidden';
    };

    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });

    chatInput.addEventListener('input', () => {
      autoResize();
      cacheComposerDraft(window.currentHandle, chatInput.value);
    });
    // Initial sizing
    autoResize();
  }

  async function updateStatus(handle, status) {
    if (!handle || !status) return;
    try {
      await fetch('/api/update-status', {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify({ handle, status }),
      });
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  }

  const statusSelect = document.getElementById('status-select');
  if (statusSelect) {
    statusSelect.addEventListener('change', (e) => updateStatus(window.currentHandle, e.target.value));
  }

  // Inline handler used in chat/index.html
  window.updateManualStatus = () => {
    const sel = document.getElementById('status-select');
    if (!sel) return;
    return updateStatus(window.currentHandle, sel.value);
  };

  const btnSuggest = document.getElementById('btn-suggest');
  if (btnSuggest) {
    btnSuggest.onclick = async () => {
      if (!chatInput) return;
      const handle = window.currentHandle;
      if (!handle) return;

      const existingDraft = (chatInput.value || '').trim();
      clearCachedSuggestion(handle);
      await requestBackgroundSuggestion(handle, existingDraft);
    };
  }

  const channelSelect = document.getElementById('channel-select');
  if (channelSelect) {
    channelSelect.addEventListener('change', (e) => {
      const v = e.target?.value;
      window.currentChannel = v;
      if (typeof window.setSelectedChannel === 'function') window.setSelectedChannel(v);
    });
    // Initialize button label
    if (typeof window.setSelectedChannel === 'function') window.setSelectedChannel(channelSelect.value);
  }

  const contactSearch = document.getElementById('contact-search');
  if (contactSearch) {
    let timer = null;
    const run = () => setConversationsQuery(contactSearch.value);

    contactSearch.addEventListener('input', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 180);
    });

    contactSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        contactSearch.value = '';
        run();
        contactSearch.blur();
      }
    });
  }

  const conversationSort = document.getElementById('conversation-sort');
  if (conversationSort) {
    try {
      const saved = window.localStorage && window.localStorage.getItem(CONVERSATION_SORT_STORAGE_KEY);
      if (saved && isValidConversationSortMode(saved)) {
        const v = normalizeConversationSort(saved);
        if ([...conversationSort.options].some((o) => o.value === v)) {
          conversationSort.value = v;
        }
      }
    } catch {
      /* ignore */
    }
    applyConversationSortOnly(conversationSort.value);
    conversationSort.addEventListener('change', () => {
      try {
        if (window.localStorage) {
          window.localStorage.setItem(CONVERSATION_SORT_STORAGE_KEY, conversationSort.value);
        }
      } catch {
        /* ignore */
      }
      setConversationsSort(conversationSort.value).catch((e) =>
        console.error('Sort reload failed:', e)
      );
    });
  }

  document.addEventListener('keydown', (e) => {
    const isMacShortcut = e.metaKey && !e.ctrlKey && !e.altKey;
    if (isMacShortcut && e.key === ',') {
      e.preventDefault();
      window.location.href = 'settings.html';
      return;
    }
    if (e.metaKey && e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));
      return;
    }
    if (e.metaKey && e.altKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      setProfileCollapsed(!document.body.classList.contains('profile-collapsed'));
      return;
    }
    if (isMacShortcut && e.key === '1') {
      e.preventDefault();
      if (typeof window.selectContact === 'function') window.selectContact(null);
    }
  });

  function setMicUiRecording(btn, recording) {
    if (!btn) return;
    if (recording) {
      btn.classList.add('recording');
      btn.textContent = '🔴 Rec';
      btn.style.color = 'white';
      btn.style.background = 'var(--danger)';
    } else {
      btn.classList.remove('recording');
      btn.textContent = '🎤 Mic';
      btn.style.color = '';
      btn.style.background = '';
    }
  }

  function ensureSpeechRecognizer() {
    if (speechRecognizer) return speechRecognizer;
    const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
    if (!SpeechRecognition) return null;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (event) => {
      if (!chatInput) return;

      let interimText = '';
      let newFinalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) newFinalText += transcript;
        else interimText += transcript;
      }

      if (newFinalText) speechFinalText = `${speechFinalText} ${newFinalText}`.trim();

      chatInput.value = [speechBaseText, speechFinalText, interimText]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trimStart();
      try { chatInput.dispatchEvent(new Event('input', { bubbles: true })); } catch { }
    };

    recognition.onerror = (event) => {
      console.warn('Speech recognition error:', event?.error || event);
      speechIsRecording = false;
      const btnMic = document.getElementById('btn-mic');
      setMicUiRecording(btnMic, false);
    };

    recognition.onend = () => {
      speechIsRecording = false;
      const btnMic = document.getElementById('btn-mic');
      setMicUiRecording(btnMic, false);
    };

    speechRecognizer = recognition;
    return recognition;
  }

  const btnMic = document.getElementById('btn-mic');
  if (btnMic) {
    btnMic.onclick = () => {
      if (!chatInput) return;

      const recognition = ensureSpeechRecognizer();
      if (!recognition) {
        const val = chatInput.value.trim();
        chatInput.value = val ? `${val} (voice input not supported in this browser)` : '(voice input not supported in this browser)';
        try { chatInput.dispatchEvent(new Event('input', { bubbles: true })); } catch { }
        return;
      }

      if (speechIsRecording) {
        try {
          recognition.stop();
        } catch { }
        speechIsRecording = false;
        setMicUiRecording(btnMic, false);
        return;
      }

      speechBaseText = chatInput.value.trim();
      speechFinalText = '';
      speechIsRecording = true;
      setMicUiRecording(btnMic, true);

      try {
        recognition.start();
      } catch (e) {
        console.warn('Speech recognition start failed:', e);
        speechIsRecording = false;
        setMicUiRecording(btnMic, false);
      }
    };
  }

  const btnMagic = document.getElementById('btn-magic');
  if (btnMagic) {
    btnMagic.onclick = async () => {
      if (!chatInput) return;
      const val = chatInput.value;
      if (!val) {
        alert('Please type something to polish first!');
        return;
      }

      const originalText = btnMagic.textContent;
      try {
        btnMagic.disabled = true;
        btnMagic.textContent = '⏳ ...';

        const res = await fetch('/api/refine-reply', {
          method: 'POST',
          headers: buildSecurityHeaders(),
          body: JSON.stringify({ draft: val, context: "" })
        });
        const data = await res.json();

        if (data.refined) {
          chatInput.value = data.refined;
          try { chatInput.dispatchEvent(new Event('input', { bubbles: true })); } catch { }
          btnMagic.textContent = '✨ Refined';
        } else {
          let polished = val.trim();
          polished = polished.charAt(0).toUpperCase() + polished.slice(1);
          if (!polished.endsWith('.') && !polished.endsWith('!') && !polished.endsWith('?')) polished += '.';
          chatInput.value = polished;
          btnMagic.textContent = '✨ Refined';
        }
      } catch (e) {
        console.warn('Refinement failed:', e);
        let polished = val.trim();
        polished = polished.charAt(0).toUpperCase() + polished.slice(1);
        if (!polished.endsWith('.') && !polished.endsWith('!') && !polished.endsWith('?')) polished += '.';
        chatInput.value = polished;
        btnMagic.textContent = '✨ Refined';
      } finally {
        btnMagic.disabled = false;
        setTimeout(() => (btnMagic.textContent = originalText), 1500);
      }
    };
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/**
 * Poll service health and update sidebar indicator
 */
async function pollServiceHealth() {
  const dot = document.getElementById('services-health-dot');
  const container = document.getElementById('services-health-status');
  if (!dot) return;

  try {
    const { fetchSystemHealth, fetchOpenClawStatus } = await import('./api.js');
    const [health, openClaw] = await Promise.all([
      fetchSystemHealth().catch(() => ({ status: 'offline' })),
      fetchOpenClawStatus().catch(() => ({ status: 'offline' }))
    ]);

    const worker = health.services?.worker || { status: 'offline' };
    const isOpenClawOffline = openClaw.status !== 'online';
    const isWorkerOffline = worker.status !== 'online';

    if (isOpenClawOffline || isWorkerOffline) {
      dot.className = 'status-dot offline';
      container.title = `Services Offline: ${isWorkerOffline ? 'Worker ' : ''}${isOpenClawOffline ? 'OpenClaw' : ''}. Click to Fix.`;
    } else {
      dot.className = 'status-dot online';
      container.title = 'All services online.';
    }
  } catch (e) {
    dot.className = 'status-dot warning';
    container.title = 'Health check failed. Click to retry.';
  }
}

async function handleOneClickFix() {
  const dot = document.getElementById('services-health-dot');
  if (!dot) return;

  const originalClass = dot.className;
  dot.className = 'status-dot active'; // Pulse blue

  try {
    const { controlService } = await import('./api.js');

    // Attempt to start worker and openclaw if they are likely down
    // We don't need to check exactly here, controlService start is idempotent if already running
    await Promise.allSettled([
      controlService('worker', 'start'),
      controlService('openclaw', 'start')
    ]);

    // Give it a moment then poll again
    setTimeout(pollServiceHealth, 2000);
  } catch (e) {
    console.error('One-click fix failed:', e);
    dot.className = originalClass;
  }
}

// Start polling
setInterval(pollServiceHealth, 15000);
pollServiceHealth();
setInterval(() => {
  void pollActiveConversationDraft();
}, ACTIVE_CONTACT_DRAFT_POLL_MS);

// Wire one-click fix
const healthContainer = document.getElementById('services-health-status');
if (healthContainer) {
  healthContainer.onclick = (e) => {
    e.stopPropagation();
    handleOneClickFix();
  };
}

window.init = init;
window.refreshSuggestButtonState = refreshSuggestButtonState;
window.applyCachedSuggestionForHandle = applyCachedSuggestionForHandle;
window.cacheComposerDraft = cacheComposerDraft;
window.getCachedComposerDraft = getCachedComposerDraft;
window.reconcileContactDraft = reconcileContactDraft;
window.pollActiveConversationDraft = pollActiveConversationDraft;
