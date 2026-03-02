/**
 * {reply} - Main Application Entry Point
 * Initializes the application and sets up event listeners
 */

import { loadConversations, selectContact, setConversationsQuery } from './contacts.js';
import { handleSendMessage } from './messages.js';
import { getSettings, buildSecurityHeaders, reportHatoriOutcome, reportDraftReplacement } from './api.js';
import './dashboard.js?v=2.1';
import './kyc.js?v=2.1';
import { applyReplyUiSettings } from './settings.js?v=2.1';
import { openTrainingPage, closeTrainingPage } from './training.js?v=2.1';

// Global state
window.currentHandle = null;
window.conversations = [];

// Speech recognition state
let speechRecognizer = null;
let speechIsRecording = false;
let speechBaseText = '';
let speechFinalText = '';

async function init() {
  console.log('🚀 {reply} initializing...');

  setupEventListeners();

  try {
    const settings = await getSettings();
    applyReplyUiSettings(settings);
  } catch (e) {
    console.warn('Settings not loaded:', e?.message || e);
  }

  await loadConversations();
  await selectContact(null); // dashboard

  console.log('✅ {reply} ready!');
}

function setupEventListeners() {
  const btnDash = document.getElementById('btn-dash');
  if (btnDash) btnDash.onclick = () => { if (typeof window.selectContact === 'function') window.selectContact(null); };

  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) btnSettings.onclick = () => { window.location.href = 'settings.html'; };

  const btnTraining = document.getElementById('btn-training');
  if (btnTraining) btnTraining.onclick = openTrainingPage;

  const btnTrainingClose = document.getElementById('training-close');
  if (btnTrainingClose) btnTrainingClose.onclick = closeTrainingPage;

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

    chatInput.addEventListener('input', autoResize);
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
          const originalText = btnSuggest.textContent;
          const existingDraft = (chatInput.value || '').trim();
          const previousHatoriContext = window.__replyActiveHatoriContext || null;

          try {
            btnSuggest.disabled = true;
            btnSuggest.textContent = '⏳ ...';

            // If the operator asks for a fresh suggestion while there is an existing draft,
            // record it as a replacement signal for ongoing learning.
            if (existingDraft) {
              await reportDraftReplacement({
                handle,
                original_text: existingDraft,
                reason: 'suggest_replace'
              });
              if (previousHatoriContext && previousHatoriContext.hatori_id) {
                await reportHatoriOutcome({
                  hatori_id: previousHatoriContext.hatori_id,
                  original_text: previousHatoriContext.original_draft || '',
                  final_sent_text: '',
                  statusOverride: 'not_sent',
                  platform: (window.currentChannel || 'other'),
                  recipient_id: handle || '',
                  conversation_id: handle ? `reply:${handle}` : '',
                  edit_reason: 'replaced_via_suggest'
                });
              }
            }

        let suggestion = '';
        let explanation = '';
        if (handle) {
          try {
            const res = await fetch('/api/suggest', {
              method: 'POST',
              headers: buildSecurityHeaders(),
              body: JSON.stringify({ handle }),
            });
            const data = await res.json();
            suggestion = data?.suggestion || '';
            explanation = data?.explanation || '';
            const hatori_id = data?.hatori_id || null;
            if (suggestion && typeof window.seedHatoriDraft === 'function') {
              window.seedHatoriDraft(suggestion, hatori_id, true);
              return; // seedHatoriDraft handles the assignment
            }
          } catch (e) {
            console.warn('API suggest failed, using fallback', e);
          }
        }

        if (!suggestion) {
          const greetings = [
            'Hi there, just checking in!',
            'Hello! How can I help?',
            'Hey, do you have a minute?',
            'Just saw your message, thanks!',
          ];
          suggestion = greetings[Math.floor(Math.random() * greetings.length)];
        }

        chatInput.value = suggestion;

        const explanationEl = document.getElementById('suggestion-explanation');
        if (explanationEl) {
          if (explanation) {
            explanationEl.textContent = explanation;
            explanationEl.style.display = 'block';
          } else {
            explanationEl.style.display = 'none';
          }
        }

        try { chatInput.dispatchEvent(new Event('input', { bubbles: true })); } catch { }
      } finally {
        btnSuggest.disabled = false;
        btnSuggest.textContent = originalText;
      }
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
          if (typeof window.seedHatoriDraft === 'function') {
            // We pass null for ID to indicate this is a refinement (or keep existing)
            // But to avoid breaking the annotation loop if it was a Hatori draft,
            // we'll just manully update the value if we want to keep the old ID.
            // Actually, for "Magic", let's just update the input value.
            chatInput.value = data.refined;
            try { chatInput.dispatchEvent(new Event('input', { bubbles: true })); } catch { }
          } else {
            chatInput.value = data.refined;
            try { chatInput.dispatchEvent(new Event('input', { bubbles: true })); } catch { }
          }
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

// Wire one-click fix
const healthContainer = document.getElementById('services-health-status');
if (healthContainer) {
  healthContainer.onclick = (e) => {
    e.stopPropagation();
    handleOneClickFix();
  };
}

window.init = init;
