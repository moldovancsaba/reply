/**
 * {reply} - Main Application Entry Point
 * Initializes the application and sets up event listeners
 */

import { loadConversations, selectContact, setConversationsQuery } from './contacts.js';
import { handleSendMessage } from './messages.js';
import { getSettings, buildSecurityHeaders } from './api.js';
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
  if (btnSettings) btnSettings.onclick = () => { if (typeof window.openSettings === 'function') window.openSettings(); };

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
        if (typeof window.openSettings === 'function') window.openSettings();
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

      try {
        btnSuggest.disabled = true;
        btnSuggest.textContent = '⏳ ...';

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
    btnMagic.onclick = () => {
      if (!chatInput) return;
      const val = chatInput.value;
      if (!val) {
        alert('Please type something to polish first!');
        return;
      }

      let polished = val.trim();
      polished = polished.charAt(0).toUpperCase() + polished.slice(1);
      if (!polished.endsWith('.') && !polished.endsWith('!') && !polished.endsWith('?')) polished += '.';
      if (polished.length < 10 && !polished.includes('Thanks')) polished = `Hi, ${polished} Thanks.`;

      chatInput.value = polished;
      try { chatInput.dispatchEvent(new Event('input', { bubbles: true })); } catch { }

      const originalText = btnMagic.textContent;
      btnMagic.textContent = '✨ Done';
      setTimeout(() => (btnMagic.textContent = originalText), 1000);
    };
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.init = init;
