/**
 * First-run onboarding wizard (reply#47).
 * Shown once until dismissed or completed; state in localStorage.
 */

import { fetchSystemHealth, triggerSync } from './api.js';
import { UI } from './ui.js';

const STORAGE_KEY = 'reply_onboarding_v1_done';

function isDone() {
  try {
    return window.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markDone() {
  try {
    window.localStorage?.setItem(STORAGE_KEY, '1');
  } catch {
    /* ignore */
  }
}

let mountEl = null;
let stepIndex = 0;

function destroy() {
  if (mountEl?.parentNode) mountEl.parentNode.removeChild(mountEl);
  mountEl = null;
  document.body.classList.remove('reply-onboarding-open');
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function renderStep(root, { title, body, onEnter }) {
  root.innerHTML = '';
  const h = el('h2', 'onboarding-title', title);
  const b = el('div', 'onboarding-body');
  if (typeof body === 'string') {
    const p = el('p', 'onboarding-lead', body);
    b.appendChild(p);
  } else if (body && body.nodeType === 1) {
    b.appendChild(body);
  }
  root.appendChild(h);
  root.appendChild(b);
  if (typeof onEnter === 'function') {
    Promise.resolve(onEnter(b)).catch((e) => console.warn('[onboarding] step onEnter:', e));
  }
}

async function checkOllamaInto(container) {
  const status = el('div', 'onboarding-status onboarding-status--pending', 'Checking Ollama…');
  container.appendChild(status);
  try {
    const h = await fetchSystemHealth({ silent: true });
    const o = h?.services?.ollama?.status || 'unknown';
    const ok = o === 'online';
    status.className = `onboarding-status onboarding-status--${ok ? 'ok' : 'warn'}`;
    status.textContent = ok
      ? 'Ollama is reachable on this Mac. Suggest and KYC features can use local models.'
      : 'Ollama was not detected (offline). Install from https://ollama.com and run `ollama serve`, then open Settings to pick a model.';
  } catch (e) {
    status.className = 'onboarding-status onboarding-status--warn';
    status.textContent =
      'Could not reach the {reply} hub for a health check. Ensure the app is running, then retry from the dashboard.';
  }
  const btn = el('button', 'btn btn-secondary', 'Run check again');
  btn.type = 'button';
  btn.onclick = () => {
    status.remove();
    btn.remove();
    checkOllamaInto(container);
  };
  container.appendChild(btn);
}

function syncStepBody() {
  const wrap = el('div', 'onboarding-sync-wrap');
  wrap.appendChild(
    el(
      'p',
      'onboarding-lead',
      'Pull recent messages and mail into {reply} so contacts and search work. This can take a minute the first time.'
    )
  );
  const row = el('div', 'onboarding-sync-buttons');
  const mk = (label, source) => {
    const b = el('button', 'btn btn-primary onboarding-sync-btn', label);
    b.type = 'button';
    b.onclick = async () => {
      b.disabled = true;
      const t = b.textContent;
      b.textContent = 'Running…';
      try {
        await triggerSync(source);
      } catch (e) {
        UI.showToast(e?.message || `${label} failed`, 'error');
      } finally {
        b.disabled = false;
        b.textContent = t;
      }
    };
    return b;
  };
  row.appendChild(mk('Sync iMessage', 'imessage'));
  row.appendChild(mk('Sync Mail', 'mail'));
  wrap.appendChild(row);
  wrap.appendChild(
    el(
      'p',
      'onboarding-hint',
      'You can run more syncs anytime from the dashboard or Settings.'
    )
  );
  return wrap;
}

function buildShell() {
  const overlay = el('div', 'onboarding-overlay');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'onboarding-dialog-title');

  const card = el('div', 'onboarding-card');
  const stepRoot = el('div', 'onboarding-step');

  const footer = el('div', 'onboarding-footer');
  const skip = el('button', 'btn btn-ghost onboarding-skip', 'Skip onboarding');
  skip.type = 'button';
  const back = el('button', 'btn btn-secondary', 'Back');
  back.type = 'button';
  const next = el('button', 'btn btn-primary', 'Next');
  next.type = 'button';

  skip.onclick = () => {
    markDone();
    destroy();
  };

  const steps = [
    {
      title: 'Welcome to {reply}',
      body: '{reply} runs locally on your Mac: your messages, contacts, and drafts stay on this machine. This short guide checks Ollama and helps you run a first sync.',
      onEnter: null
    },
    {
      title: 'Local AI (Ollama)',
      body: null,
      onEnter: (container) => checkOllamaInto(container)
    },
    {
      title: 'Bring in your data',
      body: syncStepBody(),
      onEnter: null
    },
    {
      title: 'You are set',
      body: 'Use the sidebar to pick a contact or open the dashboard for sync status. Settings (gear) has mail, IMAP, and appearance.',
      onEnter: null
    }
  ];

  function applyStep() {
    const s = steps[stepIndex];
    renderStep(stepRoot, s);
    back.style.display = stepIndex > 0 ? 'inline-flex' : 'none';
    next.textContent = stepIndex === steps.length - 1 ? 'Get started' : 'Next';
    const titleEl = stepRoot.querySelector('.onboarding-title');
    if (titleEl) titleEl.id = 'onboarding-dialog-title';
  }

  back.onclick = () => {
    if (stepIndex > 0) {
      stepIndex -= 1;
      applyStep();
    }
  };

  next.onclick = () => {
    if (stepIndex < steps.length - 1) {
      stepIndex += 1;
      applyStep();
    } else {
      markDone();
      destroy();
    }
  };

  footer.appendChild(skip);
  footer.appendChild(el('span', 'onboarding-footer-spacer'));
  footer.appendChild(back);
  footer.appendChild(next);

  card.appendChild(stepRoot);
  card.appendChild(footer);
  overlay.appendChild(card);

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      skip.click();
    }
  });

  stepIndex = 0;
  applyStep();

  return overlay;
}

/**
 * Show first-run wizard if not previously completed.
 */
export function maybeShowOnboarding() {
  if (isDone()) return;
  if (mountEl) return;
  mountEl = buildShell();
  document.body.appendChild(mountEl);
  document.body.classList.add('reply-onboarding-open');
  try {
    mountEl.querySelector('.onboarding-footer .btn-primary')?.focus();
  } catch {
    /* ignore */
  }
}

/** For tests or “Help → Setup wizard”. */
export function resetOnboardingForDev() {
  try {
    window.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

window.replyShowOnboarding = () => {
  resetOnboardingForDev();
  maybeShowOnboarding();
};
