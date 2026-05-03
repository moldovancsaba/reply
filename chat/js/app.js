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
} from './contacts.js?v=2.6.0';
import { handleSendMessage } from './messages.js?v=2.6.0';
import { getSettings, buildSecurityHeaders, reportDraftReplacement, reportTrinityOutcome } from './api.js?v=2.6.0';
import './dashboard.js?v=2.6.0';
import './kyc.js?v=2.6.0';
import { applyReplyUiSettings } from './settings.js?v=2.6.0';
import { applyIconFallback, setMaterialIcon } from './icon-fallback.js?v=2.6.0';
import { UI } from './ui.js?v=2.6.0';
import { maybeShowOnboarding } from './onboarding.js?v=2.6.0';

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
  if (String(window.currentHandle || '') === String(handle || '')) {
    renderSuggestionCandidates(null);
    setSuggestionExplanation('');
    refreshSuggestButtonState();
  }
}

window.openChannelSettings = function openChannelSettings(channel) {
  const key = String(channel || '').trim().toLowerCase();
  const tab = SETTINGS_TAB_BY_CHANNEL[key] || 'general';
  window.location.href = `settings.html#${encodeURIComponent(tab)}`;
};
window.clearCachedSuggestion = clearCachedSuggestion;
window.getCurrentDraftContext = currentDraftContext;

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

function escapeHtml(raw) {
  return String(raw || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolveReplyCompanyIdFallback() {
  const seed = 'reply.local.runtime';
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const chars = (hash >>> 0).toString(16).padStart(8, '0').repeat(4).slice(0, 32).split('');
  chars[12] = '5';
  chars[16] = '8';
  const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function renderSuggestionCandidates(payload) {
  const root = document.getElementById('suggestion-candidates');
  if (!root) return;
  root.innerHTML = '';

  const drafts = Array.isArray(payload?.rankedDraftSet?.drafts) ? payload.rankedDraftSet.drafts : [];
  if (!drafts.length) {
    root.classList.add('u-display-none');
    return;
  }

  root.classList.remove('u-display-none');
  const selectedCandidateId = String(payload?.selectedCandidateId || drafts[0]?.candidate_id || '');

  drafts.forEach((draft) => {
    const card = document.createElement('div');
    card.className = `suggestion-candidate-card${String(draft.candidate_id || '') === selectedCandidateId ? ' is-selected' : ''}`;

    const header = document.createElement('div');
    header.className = 'suggestion-candidate-header';
    header.innerHTML = `<span class="suggestion-rank">#${draft.rank}</span><span class="suggestion-rationale">${escapeHtml(draft.rationale || '')}</span>`;
    card.appendChild(header);

    const text = document.createElement('div');
    text.className = 'suggestion-draft-text';
    text.textContent = draft.draft_text || '';
    card.appendChild(text);

    if (Array.isArray(draft.risk_flags) && draft.risk_flags.length) {
      const flags = document.createElement('div');
      flags.className = 'suggestion-risk-flags';
      flags.textContent = `Flags: ${draft.risk_flags.join(', ')}`;
      card.appendChild(flags);
    }

    const actions = document.createElement('div');
    actions.className = 'suggestion-candidate-actions';

    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.className = 'btn btn-secondary btn-sm';
    useBtn.textContent = 'Use draft';
    useBtn.onclick = () => {
      applySuggestionCandidate(window.currentHandle, draft.candidate_id, { force: true, reportSelection: true });
    };
    actions.appendChild(useBtn);

    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = 'btn btn-secondary btn-sm';
    rejectBtn.textContent = 'Reject';
    rejectBtn.onclick = async () => {
      await reportSuggestionOutcome(window.currentHandle, draft.candidate_id, 'REJECTED', {
        original_draft_text: draft.draft_text || '',
        notes: 'ui_reject_candidate',
      });
      card.classList.add('is-muted');
    };
    actions.appendChild(rejectBtn);

    const reworkBtn = document.createElement('button');
    reworkBtn.type = 'button';
    reworkBtn.className = 'btn btn-secondary btn-sm';
    reworkBtn.textContent = 'Rework';
    reworkBtn.onclick = async () => {
      await reportSuggestionOutcome(window.currentHandle, draft.candidate_id, 'REWORK_REQUESTED', {
        original_draft_text: draft.draft_text || '',
        notes: 'ui_rework_requested',
      });
      setSuggestionExplanation('Rework request recorded. Use another candidate or continue with a manual draft.');
    };
    actions.appendChild(reworkBtn);

    card.appendChild(actions);
    root.appendChild(card);
  });

  const footer = document.createElement('div');
  footer.className = 'suggestion-candidate-footer';
  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'btn btn-secondary btn-sm';
  dismissBtn.textContent = 'Dismiss all';
  dismissBtn.onclick = async () => {
    const cached = readCachedSuggestion(window.currentHandle);
    const visibleDrafts = Array.isArray(cached?.rankedDraftSet?.drafts) ? cached.rankedDraftSet.drafts : [];
    await Promise.all(
      visibleDrafts.map((draft) =>
        reportSuggestionOutcome(window.currentHandle, draft.candidate_id, 'IGNORED', {
          original_draft_text: draft.draft_text || '',
          notes: 'ui_dismiss_all',
        })
      )
    );
    clearCachedSuggestion(window.currentHandle);
  };
  footer.appendChild(dismissBtn);
  root.appendChild(footer);
}

function currentDraftContext(handle) {
  const cached = readCachedSuggestion(handle);
  if (!cached?.rankedDraftSet?.cycle_id) return null;
  const drafts = Array.isArray(cached.rankedDraftSet.drafts) ? cached.rankedDraftSet.drafts : [];
  const selected = drafts.find((draft) => String(draft.candidate_id || '') === String(cached.selectedCandidateId || '')) || drafts[0] || null;
  return {
    companyId: selected?.company_id || resolveReplyCompanyIdFallback(),
    cycleId: cached.rankedDraftSet.cycle_id,
    threadRef: cached.rankedDraftSet.thread_ref,
    channel: cached.rankedDraftSet.channel,
    acceptedArtifactVersion: cached.rankedDraftSet.accepted_artifact_version || null,
    traceRef: cached.rankedDraftSet.trace_ref || null,
    selectedCandidateId: selected?.candidate_id || '',
    selectedDraftText: selected?.draft_text || cached.suggestion || '',
    originalDraftText: selected?.draft_text || cached.suggestion || '',
    generatedAtMs: Number(cached.generatedAtMs || Date.now()),
  };
}

async function reportSuggestionOutcome(handle, candidateId, disposition, extras = {}) {
  const cached = readCachedSuggestion(handle);
  const rankedDraftSet = cached?.rankedDraftSet;
  if (!rankedDraftSet?.cycle_id) return { status: 'skipped' };
  const drafts = Array.isArray(rankedDraftSet.drafts) ? rankedDraftSet.drafts : [];
  const draft = drafts.find((item) => String(item.candidate_id || '') === String(candidateId || '')) || drafts[0] || null;
  return reportTrinityOutcome({
    company_id: draft?.company_id || resolveReplyCompanyIdFallback(),
    cycle_id: rankedDraftSet.cycle_id,
    thread_ref: rankedDraftSet.thread_ref,
    channel: rankedDraftSet.channel,
    candidate_id: draft?.candidate_id || candidateId || null,
    disposition,
    occurred_at: new Date().toISOString(),
    original_draft_text: extras.original_draft_text || draft?.draft_text || cached?.suggestion || '',
    final_text: extras.final_text || null,
    edit_distance: extras.edit_distance ?? null,
    latency_ms: extras.latency_ms ?? Math.max(0, Date.now() - Number(cached?.generatedAtMs || Date.now())),
    send_result: extras.send_result || null,
    notes: extras.notes || null,
    contract_version: rankedDraftSet.contract_version || 'trinity.reply.v1alpha1',
  });
}

function applySuggestionCandidate(handle, candidateId, options = {}) {
  const cached = readCachedSuggestion(handle);
  const drafts = Array.isArray(cached?.rankedDraftSet?.drafts) ? cached.rankedDraftSet.drafts : [];
  const selected = drafts.find((draft) => String(draft.candidate_id || '') === String(candidateId || ''));
  if (!selected) return false;

  writeCachedSuggestion(handle, {
    ...(cached || {}),
    suggestion: selected.draft_text || '',
    explanation: selected.rationale || cached?.explanation || '',
    selectedCandidateId: selected.candidate_id,
  });
  applyCachedSuggestionForHandle(handle, { force: options.force === true });
  renderSuggestionCandidates(readCachedSuggestion(handle));

  if (options.reportSelection) {
    reportSuggestionOutcome(handle, selected.candidate_id, 'SELECTED', {
      original_draft_text: selected.draft_text || '',
      notes: 'ui_select_candidate',
    }).catch((error) => console.warn('[reply] selection report failed:', error?.message || error));
  }
  return true;
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
      ...(cached || {}),
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
    renderSuggestionCandidates(readCachedSuggestion(normalizedHandle));
  }

  refreshSuggestButtonState();
  return applied;
}

function applyLayoutChromeState() {
  const body = document.body;
  if (!body) return;
  const sidebarCollapsed = body.classList.contains('sidebar-collapsed');
  const profileCollapsed = body.classList.contains('profile-collapsed');
  const sidebarToggle = document.querySelector('#btn-toggle-sidebar .reply-shell-icon');
  if (sidebarToggle) {
    setMaterialIcon(sidebarToggle, sidebarCollapsed ? 'panel-left-open' : 'panel-left-close');
    document.getElementById('btn-toggle-sidebar')?.setAttribute('data-tooltip', sidebarCollapsed ? 'Show contacts' : 'Collapse contacts');
    document.getElementById('btn-toggle-sidebar')?.setAttribute('aria-label', sidebarCollapsed ? 'Show contacts' : 'Collapse contacts');
  }
  document.querySelectorAll('#btn-toggle-profile .reply-shell-icon').forEach((node) => {
    setMaterialIcon(node, profileCollapsed ? 'panel-right-open' : 'panel-right-close');
  });
  document.querySelectorAll('#btn-toggle-profile .shell-toolbar-button__label').forEach((node) => {
    node.textContent = profileCollapsed ? 'Expand' : 'Collapse';
  });
  document.querySelectorAll('#btn-toggle-profile').forEach((node) => {
    node.setAttribute('data-tooltip', profileCollapsed ? 'Expand profile' : 'Collapse profile');
    node.setAttribute('aria-label', profileCollapsed ? 'Expand profile' : 'Collapse profile');
  });
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
  const label = btnSuggest.querySelector('.shell-action-button__label');
  const icon = btnSuggest.querySelector('.reply-shell-icon');
  const handle = window.currentHandle;
  if (!handle) {
    btnSuggest.disabled = true;
    if (label) label.textContent = 'Suggest';
    setMaterialIcon(icon, 'lightbulb');
    btnSuggest.setAttribute('aria-label', 'Select a conversation to generate draft suggestions');
    btnSuggest.dataset.tooltip = 'Select a conversation to generate draft suggestions';
    return;
  }

  const job = suggestionJobs.get(handle);
  const cached = readCachedSuggestion(handle);
  if (job?.status === 'pending') {
    btnSuggest.disabled = true;
    if (label) label.textContent = 'Suggesting…';
    setMaterialIcon(icon, 'info');
    btnSuggest.setAttribute('aria-label', 'Generating 3 draft suggestions');
    btnSuggest.dataset.tooltip = 'Generating 3 draft suggestions';
    return;
  }

  btnSuggest.disabled = false;
  if (label) label.textContent = cached?.suggestion ? 'Ready' : 'Suggest';
  setMaterialIcon(icon, cached?.suggestion ? 'check-circle' : 'lightbulb');
  const tooltip = cached?.suggestion ? 'Draft suggestions are ready' : 'Generate 3 draft suggestions';
  btnSuggest.setAttribute('aria-label', tooltip);
  btnSuggest.dataset.tooltip = tooltip;
}

function applyCachedSuggestionForHandle(handle, options = {}) {
  const payload = readCachedSuggestion(handle);
  if (!payload || !payload.suggestion) {
    setSuggestionExplanation('');
    renderSuggestionCandidates(null);
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
  renderSuggestionCandidates(payload);
  refreshSuggestButtonState();
  return canSeed;
}

async function requestBackgroundSuggestion(handle, existingDraft = '') {
  if (!handle) return;
  if (suggestionJobs.get(handle)?.status === 'pending') return;

  const prior = readCachedSuggestion(handle);
  if (prior?.rankedDraftSet?.cycle_id && prior?.selectedCandidateId) {
    const priorDraftText = normalizeDraftText(prior.suggestion || '');
    const normalizedExistingDraft = normalizeDraftText(existingDraft);
    const replacingPriorTrinityDraft =
      normalizedExistingDraft
      && priorDraftText
      && normalizedExistingDraft !== priorDraftText;

    if (replacingPriorTrinityDraft) {
      await reportSuggestionOutcome(handle, prior.selectedCandidateId, 'MANUAL_REPLACEMENT', {
        original_draft_text: priorDraftText,
        final_text: normalizedExistingDraft,
        notes: 'request_new_suggestion_replaced_prior',
      }).catch(() => null);
    } else {
      await reportSuggestionOutcome(handle, prior.selectedCandidateId, 'IGNORED', {
        original_draft_text: priorDraftText || '',
        notes: 'request_new_suggestion',
      }).catch(() => null);
    }
  }

  suggestionJobs.set(handle, { status: 'pending', startedAt: Date.now() });
  refreshSuggestButtonState();
  if (String(window.currentHandle || '') === String(handle)) {
    setSuggestionExplanation('Generating a suggestion in the background. You can switch conversations and come back later.');
  }

  try {
    if (existingDraft && !prior?.rankedDraftSet?.cycle_id) {
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
    const rankedDraftSet = data?.rankedDraftSet || null;
    if (!suggestion) throw new Error('No suggestion text returned');

    writeCachedSuggestion(handle, {
      suggestion,
      explanation,
      runtimeMode: data?.runtimeMode || null,
      rankedDraftSet,
      selectedCandidateId: rankedDraftSet?.drafts?.[0]?.candidate_id || '',
      generatedAtMs: Date.now(),
    });
    suggestionJobs.delete(handle);

    const applied = applyCachedSuggestionForHandle(handle, {
      force: String(window.currentHandle || '') === String(handle)
    });
    if (rankedDraftSet?.drafts?.[0]?.candidate_id) {
      await reportSuggestionOutcome(handle, rankedDraftSet.drafts[0].candidate_id, 'SELECTED', {
        original_draft_text: rankedDraftSet.drafts[0].draft_text || '',
        notes: 'auto_apply_top_candidate',
      }).catch(() => null);
    }
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
      renderSuggestionCandidates(null);
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
    const firstConversationHandle = Array.isArray(window.conversations)
      ? String(window.conversations.find((item) => item?.handle)?.handle || '').trim()
      : '';
    if (firstConversationHandle) {
      await selectContact(firstConversationHandle);
    } else {
      await selectContact(null);
    }
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
  if (btnToggleSidebar) btnToggleSidebar.onclick = () => setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));

  const btnToggleProfile = document.getElementById('btn-toggle-profile');
  if (btnToggleProfile) btnToggleProfile.onclick = () => setProfileCollapsed(!document.body.classList.contains('profile-collapsed'));

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
    const icon = btn.querySelector('.reply-shell-icon');
    const label = btn.querySelector('.shell-action-button__label');
    if (recording) {
      btn.classList.add('recording');
      setMaterialIcon(icon, 'radio-button-checked');
      if (label) label.textContent = 'Recording';
      btn.style.color = 'white';
      btn.style.background = 'var(--danger)';
      btn.setAttribute('aria-label', 'Stop dictation');
      btn.dataset.tooltip = 'Stop dictation';
    } else {
      btn.classList.remove('recording');
      setMaterialIcon(icon, 'mic');
      if (label) label.textContent = 'Mic';
      btn.style.color = '';
      btn.style.background = '';
      btn.setAttribute('aria-label', 'Dictate into the composer');
      btn.dataset.tooltip = 'Dictate into the composer';
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

      const originalLabel = btnMagic.querySelector('.shell-action-button__label')?.textContent || 'Refine';
      const icon = btnMagic.querySelector('.reply-shell-icon');
      try {
        btnMagic.disabled = true;
        const label = btnMagic.querySelector('.shell-action-button__label');
        if (label) label.textContent = 'Refining…';
        setMaterialIcon(icon, 'info');
        btnMagic.setAttribute('aria-label', 'Refining the current draft');
        btnMagic.dataset.tooltip = 'Refining the current draft';

        const res = await fetch('/api/refine-reply', {
          method: 'POST',
          headers: buildSecurityHeaders(),
          body: JSON.stringify({ draft: val, context: "" })
        });
        const data = await res.json();

        if (data.refined) {
          chatInput.value = data.refined;
          try { chatInput.dispatchEvent(new Event('input', { bubbles: true })); } catch { }
          const label = btnMagic.querySelector('.shell-action-button__label');
          if (label) label.textContent = 'Refined';
          setMaterialIcon(icon, 'check-circle');
        } else {
          let polished = val.trim();
          polished = polished.charAt(0).toUpperCase() + polished.slice(1);
          if (!polished.endsWith('.') && !polished.endsWith('!') && !polished.endsWith('?')) polished += '.';
          chatInput.value = polished;
          const label = btnMagic.querySelector('.shell-action-button__label');
          if (label) label.textContent = 'Refined';
          setMaterialIcon(icon, 'check-circle');
        }
      } catch (e) {
        console.warn('Refinement failed:', e);
        let polished = val.trim();
        polished = polished.charAt(0).toUpperCase() + polished.slice(1);
        if (!polished.endsWith('.') && !polished.endsWith('!') && !polished.endsWith('?')) polished += '.';
        chatInput.value = polished;
        const label = btnMagic.querySelector('.shell-action-button__label');
        if (label) label.textContent = 'Refined';
        setMaterialIcon(icon, 'check-circle');
      } finally {
        btnMagic.disabled = false;
        setTimeout(() => {
          const label = btnMagic.querySelector('.shell-action-button__label');
          if (label) label.textContent = originalLabel;
          setMaterialIcon(icon, 'auto-awesome');
          btnMagic.setAttribute('aria-label', 'Refine the current draft');
          btnMagic.dataset.tooltip = 'Refine the current draft';
        }, 1500);
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
