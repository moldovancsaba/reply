/**
 * {reply} - Dashboard Module
 * Renders system health dashboard with sync status and triage log
 */

import { fetchSystemHealth, fetchTriageLogs, fetchBridgeSummary, fetchOpenClawStatus, triggerSync, buildSecurityHeaders } from './api.js';
import { UI } from './ui.js';

/**
 * OpenClaw `gateway health --json` may expose `channels` as a number, array, or nested object — never interpolate raw objects.
 */
function formatOpenClawChannelsSummary(channels) {
  if (channels == null || channels === '') return 'None';
  if (typeof channels === 'number' && Number.isFinite(channels)) {
    return channels === 0 ? 'None' : `${channels} channel${channels === 1 ? '' : 's'}`;
  }
  if (typeof channels === 'string') return channels;
  if (Array.isArray(channels)) {
    if (channels.length === 0) return 'None';
    const labels = channels.map((c) => {
      if (c == null) return '';
      if (typeof c === 'string') return c;
      return c.channel || c.name || c.id || c.label || '';
    }).filter(Boolean);
    return labels.length ? labels.join(', ') : `${channels.length} channel${channels.length === 1 ? '' : 's'}`;
  }
  if (typeof channels === 'object') {
    const keys = Object.keys(channels);
    if (keys.length === 0) return 'None';
    const parts = [];
    for (const k of keys) {
      const v = channels[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const st = v.state ?? v.status ?? v.linked;
        if (st === true || st === 'ok' || st === 'connected' || st === 'linked') parts.push(k);
        else if (typeof st === 'string' && st) parts.push(`${k}: ${st}`);
        else parts.push(k);
      } else if (v === true) {
        parts.push(k);
      } else if (v != null && v !== '') {
        parts.push(`${k}: ${v}`);
      } else {
        parts.push(k);
      }
    }
    return parts.join(', ') || 'None';
  }
  return 'None';
}

function wireDashboardActions(root) {
  if (!root) return;

  root.querySelectorAll('[data-dashboard-open-settings]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const channel = (btn.getAttribute('data-dashboard-open-settings') || '').trim();
      if (!channel) return;
      if (typeof window.openChannelSettings === 'function') window.openChannelSettings(channel);
    });
  });

  root.querySelectorAll('[data-dashboard-sync]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const source = (btn.getAttribute('data-dashboard-sync') || '').trim();
      if (!source) return;
      handleSync(source, btn);
    });
  });

  root.querySelectorAll('[data-dashboard-service-control]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = (btn.getAttribute('data-dashboard-service-control') || '').trim();
      const action = (btn.getAttribute('data-dashboard-action') || '').trim();
      if (!name || !action) return;
      handleServiceControl(name, action, btn);
    });
  });

  const retryBtn = root.querySelector('[data-dashboard-retry]');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => renderDashboard());
  }
}

/**
 * Renders a health card with consistent styling
 * @param {Object} config - Card configuration
 * @param {string} config.title - Card title
 * @param {number|string} config.value - Main KPI value
 * @param {string} config.statusText - Status text to display
 * @param {string} [config.statusClass] - Optional status class (e.g., 'online' or 'tag-online')
 * @param {Object} [config.meta] - Metadata lines
 * @param {Object} [config.actions] - Action buttons configuration
 * @param {string} [config.icon] - Header icon (emoji or svg path)
 * @returns {string} HTML string for the card
 */
function renderHealthCard(config) {
  const {
    title,
    value,
    statusText,
    statusClass = '',
    meta = [],
    actions = [],
    icon = ''
  } = config;

  const actionsHtml = actions.length > 0 ? `
    <div class="health-card-actions">
      ${actions.map(action => {
    if (action.type === 'settings') {
      return `<button type="button" class="btn-icon" data-dashboard-open-settings="${action.channel}" title="${action.title || 'Configure'}">⚙️</button>`;
    }
    if (action.type === 'sync') {
      return `<button type="button" class="btn-icon" data-dashboard-sync="${action.channel}" title="${action.title || 'Sync'}">
            ${action.icon ? `<img src="${action.icon}" alt="${action.channel}" class="platform-icon platform-icon--sm">` : action.emoji || '🔄'}
          </button>`;
    }
    if (action.type === 'service') {
      return `<button type="button" class="btn-icon" data-dashboard-service-control="${action.name}" data-dashboard-action="${action.action}" title="${action.title || 'Control'}">
            ${action.emoji || '🔄'}
          </button>`;
    }
    return '';
  }).join('')}
    </div>
  ` : '';

  const metaHtml = meta.map(m => {
    const overflowClass = m.overflow ? 'health-card-meta-overflow' : '';
    const wrapClass = m.wrap ? 'health-card-meta-wrap' : '';
    const safeTitle = m.title ? String(m.title).replace(/"/g, '&quot;') : '';
    return `<div class="health-card-meta ${overflowClass} ${wrapClass}" ${safeTitle ? `title="${safeTitle}"` : ''}>${m.text}</div>`;
  }).join('');

  const iconHtml = icon ? (icon.includes('.svg') || icon.includes('.png') || icon.includes('/')
    ? `<img src="${icon}" alt="${title}" class="platform-icon platform-icon--sm">`
    : `<span class="health-card-icon">${icon}</span>`) : '';

  return `
    <div class="health-card">
      <div class="health-card-header">
        <h4>${iconHtml}<span>${title}</span></h4>
        ${actionsHtml}
      </div>
      <div class="health-value">${value}</div>
      <div class="health-status-tag ${statusClass}">${statusText}</div>
      ${metaHtml}
    </div>
  `;
}

/**
 * Renders the System Alerts panel.
 * Only shown when health.repair array is non-empty.
 */
function renderAlertsPanel(repairs) {
  if (!Array.isArray(repairs) || repairs.length === 0) return '';

  const SERVICE_ICONS = { worker: '⚙️', openclaw: '🛡️', hatori: '🤖', ollama: '🦙' };
  const SEVERITY_CLASSES = { critical: 'alert-critical', warning: 'alert-warning' };

  const items = repairs.map(alert => {
    const icon = SERVICE_ICONS[alert.service] || '⚠️';
    const severityClass = SEVERITY_CLASSES[alert.severity] || 'alert-warning';

    // All services (including ollama) get a direct launch button
    const startLabel = { ollama: '🦙 Start Ollama', worker: '🔄 Restart Worker', openclaw: '🔄 Start OpenClaw', hatori: '🔄 Start Hatori' };
    const actionBtn = `<button type="button" class="btn btn-sm btn-repair" data-dashboard-service-control="${alert.service}" data-dashboard-action="${alert.service === 'ollama' ? 'start' : 'restart'}" title="${startLabel[alert.service] || 'Restart'}">${startLabel[alert.service] || '🔄 Try Again'}</button>`;

    const logBtn = alert.logPath
      ? `<button type="button" class="btn btn-sm btn-muted" onclick="navigator.clipboard&&navigator.clipboard.writeText('tail -f ${alert.logPath}')" title="Copy log command">📋 Copy Log Cmd</button>`
      : '';

    const attemptsText = alert.attempts > 0 ? ` (auto-restarted ${alert.attempts}× already)` : '';

    return `
      <div class="system-alert ${severityClass}">
        <div class="system-alert-header">
          <span class="system-alert-icon">${icon}</span>
          <strong class="system-alert-name">${alert.service}</strong>
          <span class="system-alert-severity">${alert.severity.toUpperCase()}${attemptsText}</span>
        </div>
        <p class="system-alert-message">${alert.message}</p>
        <div class="system-alert-actions">${actionBtn}${logBtn}</div>
      </div>`;
  }).join('');

  return `
    <div class="system-alerts-panel">
      <div class="system-alerts-header">
        <span>⚠️</span>
        <strong>System Alerts — ${repairs.length} issue${repairs.length > 1 ? 's' : ''} detected</strong>
        <span class="system-alerts-note">Auto-repair has been attempted where possible.</span>
      </div>
      ${items}
    </div>`;
}

export async function renderDashboard() {
  const dashboard = document.getElementById('dashboard');
  if (!dashboard) return;

  // Show loading state
  dashboard.innerHTML = '<div style="padding:40px; text-align:center; color:#666;">Loading dashboard...</div>';
  UI.showLoading();

  try {
    // Fetch dashboard data safely
    const [health, logs, bridgeData, openClawStatus] = await Promise.all([
      fetchSystemHealth().catch(e => ({ stats: {}, uptime: 0, channels: {} })),
      fetchTriageLogs(10).catch(e => []),
      fetchBridgeSummary(5000).catch(e => ({ summary: {} })),
      fetchOpenClawStatus().catch(e => ({ status: 'offline', error: 'Failed to fetch status' }))
    ]);

    // Calculate uptime
    const uptimeHrs = (health.uptime / 3600).toFixed(1);

    // Get sync data for each source
    const imessageSync = health.channels?.imessage || {};
    const whatsappSync = health.channels?.whatsapp || {};
    const notesSync = health.channels?.notes || {};
    const mailSync = health.channels?.mail || {};
    const kycSync = health.channels?.kyc || {};
    const contactSync = health.channels?.contacts || {};
    const bridgeSummary = bridgeData?.summary || {};
    const bridgeCounts = bridgeSummary?.counts || {};
    const bridgeIngested = Number(bridgeCounts?.ingested) || 0;
    const bridgeDuplicates = Number(bridgeCounts?.duplicate) || 0;
    const bridgeErrors = Number(bridgeCounts?.error) || 0;
    const bridgeLast = bridgeSummary?.lastEventAt || null;
    const bridgeRollout = bridgeSummary?.rollout || {};
    const modeOf = (channel) => bridgeRollout?.[channel] || 'draft_only';

    const linkedinMessagesSync = health.channels?.linkedin_messages || {};
    const linkedinPostsSync = health.channels?.linkedin_posts || {};

    // Format last sync times
    const formatLastSync = (timestamp) => {
      if (!timestamp) return 'Never';
      const date = new Date(timestamp);
      return date.toLocaleString();
    };

    // Format OpenClaw status
    const shortError = openClawStatus.error || 'OpenClaw health check failed';
    const openClawStatusText = openClawStatus.status === 'online' ? '● Gateway Running' : `● ${shortError}`;
    const openClawStatusClass = openClawStatus.status === 'online' ? 'tag-online' : 'tag-offline';

    const openClawMeta = [
      { text: `Linked: ${formatOpenClawChannelsSummary(openClawStatus.channels)}` },
      { text: `Heartbeat: ${formatLastSync(openClawStatus.heartbeat)}` }
    ];
    const openClawActions = [
      { type: 'settings', channel: 'whatsapp', title: 'OpenClaw Settings' }
    ];
    if (openClawStatus.status !== 'online') {
      openClawActions.push({ type: 'service', name: 'openclaw', action: 'start', emoji: '🟢', title: 'Start OpenClaw Gateway' });
    } else {
      openClawActions.push({ type: 'service', name: 'openclaw', action: 'restart', emoji: '🔄', title: 'Restart OpenClaw Gateway' });
    }

    // Render dashboard HTML
    dashboard.innerHTML = `
      ${renderAlertsPanel(health.repair || [])}

      ${renderHealthCard({
      title: 'OpenClaw Health',
      icon: '🛡️',
      value: openClawStatus.status === 'online' ? (openClawStatus.version || 'Connected') : 'Offline',
      statusText: openClawStatusText,
      statusClass: openClawStatusClass,
      meta: openClawMeta,
      actions: openClawActions
    })
      }

       ${renderHealthCard({
        title: 'System Status',
        icon: '🖥️',
        value: 'Online',
        statusText: '● Server Running',
        statusClass: 'tag-online',
        meta: [
          { text: `<span>Uptime: ${uptimeHrs}h</span>&nbsp;&nbsp;<span>Contacts: ${health.stats?.total || 0}</span>` }
        ]
      })
      }

      ${(() => {
        const worker = health.services?.worker || { status: 'offline' };
        const workerUptime = worker.uptime ? (worker.uptime / 3600).toFixed(1) + 'h' : '0h';

        const workerActions = [];
        if (worker.status === 'online') {
          workerActions.push({ type: 'service', name: 'worker', action: 'restart', emoji: '🔄', title: 'Restart Worker' });
        } else {
          workerActions.push({ type: 'service', name: 'worker', action: 'start', emoji: '🟢', title: 'Start Worker' });
        }

        const startedLabel = worker.startedAt ? formatLastSync(worker.startedAt) : '—';
        return renderHealthCard({
          title: 'Background Worker',
          icon: '⚙️',
          value: worker.status === 'online' ? 'Running' : 'Offline',
          statusText: `● Process ${worker.status}`,
          statusClass: worker.status === 'online' ? 'tag-online' : 'tag-offline',
          meta: [
            { text: `PID: ${worker.pid ?? '—'} | Uptime: ${workerUptime}` },
            {
              text: `Started: ${startedLabel}`,
              wrap: true,
              title: worker.startedAt || ''
            }
          ],
          actions: workerActions
        });
      })()}
      
      ${renderHealthCard({
        title: 'iMessage Sync',
        icon: '/public/imessage.svg',
        value: imessageSync.processed || 0,
        statusText: '● Messages Scanned',
        meta: [{ text: `Sync: ${formatLastSync(imessageSync.lastSync)}` }],
        actions: [
          { type: 'settings', channel: 'imessage', title: 'Configure iMessage' },
          { type: 'sync', channel: 'imessage', icon: '/public/imessage.svg', title: 'Sync iMessage' }
        ]
      })
      }
      
      ${renderHealthCard({
        title: 'WhatsApp Sync',
        icon: '/public/whatsapp.svg',
        value: whatsappSync.processed || 0,
        statusText: '● Messages Scanned',
        meta: [{ text: `Sync: ${formatLastSync(whatsappSync.lastSync)}` }],
        actions: [
          { type: 'settings', channel: 'whatsapp', title: 'Configure WhatsApp' },
          { type: 'sync', channel: 'whatsapp', icon: '/public/whatsapp.svg', title: 'Sync WhatsApp' }
        ]
      })
      }
      
      ${renderHealthCard({
        title: 'LinkedIn Messages',
        icon: '/public/linkedin.svg',
        value: linkedinMessagesSync.processed || 0,
        statusText: '● Messages Scanned',
        meta: [{ text: `Sync: ${formatLastSync(linkedinMessagesSync.lastAt)}` }],
        actions: [
          { type: 'settings', channel: 'linkedin', title: 'Configure LinkedIn Messages' },
          { type: 'sync', channel: 'linkedin', icon: '/public/linkedin.svg', title: 'Sync LinkedIn Messages (via Sidecar)' }
        ]
      })
      }
      
      ${renderHealthCard({
        title: 'Email Sync',
        icon: '/public/mail.svg',
        value: mailSync.processed || 0,
        statusText: mailSync.connected ? `● ${mailSync.provider === 'gmail' ? 'Gmail' : 'IMAP'} Connected` : '● Disconnected',
        statusClass: mailSync.connected ? 'tag-online' : 'tag-offline',
        meta: [
          { overflow: true, title: mailSync.account || '', text: mailSync.account || 'No account' },
          { text: `Sync: ${formatLastSync(mailSync.lastAt)}` }
        ],
        actions: [
          { type: 'settings', channel: 'mail', title: 'Configure Email' },
          { type: 'sync', channel: 'mail', icon: '/public/mail.svg', title: 'Sync Email' }
        ]
      })
      }
      
      ${renderHealthCard({
        title: 'LinkedIn Posts',
        icon: '/public/linkedin.svg',
        value: linkedinPostsSync.processed || 0,
        statusText: '● Posts Scanned',
        meta: [{ text: `Sync: ${formatLastSync(linkedinPostsSync.lastAt)}` }],
        actions: [
          { type: 'settings', channel: 'linkedin-posts', title: 'Configure LinkedIn Posts' },
          { type: 'sync', channel: 'linkedin-posts', icon: '/public/linkedin.svg', title: 'Sync LinkedIn Posts (Import Archive)' }
        ]
      })
      }
      
      ${renderHealthCard({
        title: 'Notes Sync',
        icon: '📝',
        value: notesSync.processed || 0,
        statusText: '● Notes Scanned',
        meta: [{ text: `Sync: ${formatLastSync(notesSync.lastSync)}` }],
        actions: [
          { type: 'settings', channel: 'notes', title: 'Configure Notes' },
          { type: 'sync', channel: 'notes', emoji: '📝', title: 'Sync Notes' }
        ]
      })
      }
      
      ${renderHealthCard({
        title: 'Contacts Sync',
        icon: '👤',
        value: health.stats?.total || 0,
        statusText: '● Shared Storage',
        meta: [
          { text: `LI: ${health.stats?.byChannel?.linkedin || 0} | WA: ${health.stats?.byChannel?.whatsapp || 0} | AP: ${health.stats?.byChannel?.apple_contacts || 0}` },
          { text: `Sync: ${formatLastSync(contactSync.lastSync)}` }
        ],
        actions: [
          { type: 'sync', channel: 'contacts', emoji: '👤', title: 'Sync Contacts from Apple Contacts' }
        ]
      })
      }
      
      ${renderHealthCard({
        title: 'Contact Intelligence',
        icon: '🧠',
        value: kycSync.index != null ? kycSync.index + 1 : 0,
        statusText: kycSync.state === 'running' ? '● Analyzing Contacts...' : '● Idle',
        statusClass: kycSync.state === 'running' ? 'tag-online' : '',
        meta: [
          { text: `Progress: ${kycSync.index != null && kycSync.total ? Math.round((kycSync.index / kycSync.total) * 100) : 0}% (${kycSync.index != null ? kycSync.index + 1 : 0}/${kycSync.total || 0})` },
          { overflow: true, title: kycSync.message || '', text: kycSync.message || 'Waiting...' },
          { text: `Pulse: ${formatLastSync(kycSync.timestamp)}` }
        ],
        actions: [
          { type: 'sync', channel: 'kyc', emoji: '🧠', title: 'Run Intelligence Sweep' }
        ]
      })
      }

  <div class="health-card health-card--span-full dashboard-triage-card">
    <div class="health-card-header">
      <h4><span class="health-card-icon">📋</span><span>Recent Triage Log</span></h4>
    </div>
    <div class="triage-log-header" aria-hidden="true">
      <span>Time</span><span>Action</span><span>Contact / sender</span>
    </div>
    <div id="dashboard-triage-log" class="triage-log">
      <!-- Triage entries will be injected safely via JS -->
    </div>
  </div>
  `;
    // Safe injection of triage logs
    const triageContainer = dashboard.querySelector('#dashboard-triage-log');
    if (triageContainer) {
      triageContainer.innerHTML = ''; // Clear previous logs
      if (logs.length > 0) {
        logs.forEach(log => {
          const entry = document.createElement('div');
          entry.className = 'triage-entry';

          const time = document.createElement('span');
          time.className = 'triage-time';
          time.textContent = new Date(log.timestamp).toLocaleTimeString();
          entry.appendChild(time);

          const action = document.createElement('span');
          action.className = 'triage-action';
          action.textContent = log.action;
          entry.appendChild(action);

          const contact = document.createElement('span');
          contact.className = 'triage-contact';
          const who = (log.contact || log.sender || '').trim();
          contact.textContent = who || '—';
          contact.title = who || '';
          entry.appendChild(contact);

          triageContainer.appendChild(entry);
        });
      } else {
        const empty = document.createElement('div');
        empty.style.color = '#888';
        empty.style.padding = '1rem';
        empty.textContent = 'No recent activity';
        triageContainer.appendChild(empty);
      }
    }

    wireDashboardActions(dashboard);
  } catch (error) {
    console.error('Failed to render dashboard:', error);
    dashboard.innerHTML = '';
    const errorContainer = document.createElement('div');
    errorContainer.style.padding = '40px';
    errorContainer.style.textAlign = 'center';
    errorContainer.style.color = '#d32f2f';

    const errorTitle = document.createElement('h3');
    errorTitle.textContent = 'Failed to load dashboard';
    errorContainer.appendChild(errorTitle);

    const errorMsg = document.createElement('p');
    errorMsg.textContent = error.message;
    errorContainer.appendChild(errorMsg);

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn btn-secondary';
    retryBtn.style.marginTop = '1rem';
    retryBtn.textContent = 'Retry';
    retryBtn.onclick = () => renderDashboard();
    errorContainer.appendChild(retryBtn);

    dashboard.appendChild(errorContainer);
    UI.showToast(error.message || 'Failed to load dashboard', 'error');
  } finally {
    UI.hideLoading();
  }
}

/**
 * Refresh only the System Alerts panel in-place without re-rendering the whole dashboard.
 * Polls health once and replaces just the alerts section.
 */
async function refreshAlertsPanel() {
  const dashboard = document.getElementById('dashboard');
  if (!dashboard) return;
  try {
    const [health, openClawStatus] = await Promise.all([
      fetchSystemHealth().catch(() => ({})),
      fetchOpenClawStatus().catch(() => ({ status: 'offline' }))
    ]);
    // Build repair list (same logic as main render)
    const repairs = Array.isArray(health.repair) ? health.repair : [];
    // Find or create the alerts panel root
    const alertsRoot = dashboard.querySelector('.system-alerts-panel');
    const newHtml = renderAlertsPanel(repairs);
    if (newHtml) {
      if (alertsRoot) {
        alertsRoot.outerHTML = newHtml;
      } else {
        // Prepend before the first health-card
        const firstCard = dashboard.querySelector('.health-card');
        if (firstCard) firstCard.insertAdjacentHTML('beforebegin', newHtml);
        else dashboard.insertAdjacentHTML('afterbegin', newHtml);
      }
    } else if (alertsRoot) {
      alertsRoot.remove();
    }
    // Re-wire buttons in the alerts panel after DOM update
    const newPanel = dashboard.querySelector('.system-alerts-panel');
    if (newPanel) wireDashboardActions(newPanel);
  } catch (e) {
    console.warn('[Dashboard] refreshAlertsPanel failed:', e.message);
  }
}

/**
 * Handle sync button click — no full re-render, just button state feedback.
 * @param {string} source - Source to sync ('imessage', 'whatsapp', 'notes')
 * @param {HTMLButtonElement|null} triggerButton - Invoking button for local loading state
 */
export async function handleSync(source, triggerButton = null) {
  const button = triggerButton || null;
  const originalHtml = button ? button.innerHTML : '';
  try {
    if (button) {
      button.disabled = true;
      button.textContent = '⏳';
    }

    await triggerSync(source);

    if (button) {
      button.textContent = '✅';
      // Reset button after 3s — no full re-render
      setTimeout(() => {
        button.disabled = false;
        button.innerHTML = originalHtml;
      }, 3000);
    }
  } catch (error) {
    console.error(`Sync failed for ${source}: `, error);
    UI.showToast(error.message || `Sync failed (${source})`, 'error');
    if (button) {
      button.disabled = false;
      button.innerHTML = originalHtml;
    }
    // Show inline error on button instead of alert()
    if (button) {
      button.textContent = '❌';
      button.title = error.message;
      setTimeout(() => {
        button.disabled = false;
        button.innerHTML = originalHtml;
        button.title = '';
      }, 4000);
    }
  }
}

/**
 * Handle service control action.
 * For managed services: shows spinner → ✅ / ❌ inline.
 * For ollama: shows spinner → polls health → updates alerts panel in-place.
 */
export async function handleServiceControl(name, action, triggerButton = null) {
  const button = triggerButton || null;
  const originalHtml = button ? button.innerHTML : '';

  const isOllama = name === 'ollama';
  const pollDelay = isOllama ? 6000 : 3000; // Ollama needs longer to start

  try {
    if (button) {
      button.disabled = true;
      button.textContent = isOllama ? '⏳ Starting…' : '⏳';
    }

    const { controlService } = await import('./api.js');
    await controlService(name, action);

    if (button) {
      button.textContent = isOllama ? '⏳ Checking…' : '✅';
    }

    // After a delay, refresh only the alerts panel to show updated status
    setTimeout(async () => {
      await refreshAlertsPanel();
      // If button still exists and wasn't replaced by the re-render, restore it
      if (button && button.isConnected && !isOllama) {
        button.disabled = false;
        button.innerHTML = originalHtml;
      }
    }, pollDelay);

  } catch (error) {
    console.error(`Service control failed for ${name} ${action}: `, error);
    if (button) {
      button.textContent = '❌ Failed';
      button.title = error.message;
      setTimeout(() => {
        if (button.isConnected) {
          button.disabled = false;
          button.innerHTML = originalHtml;
          button.title = '';
        }
      }, 4000);
    }
  }
}


/**
 * Handle LinkedIn Archive Import
 * @param {HTMLInputElement} input
 */
export async function handleLinkedInImport(input) {
  const file = input.files[0];
  if (!file) return;

  if (!confirm(`Import ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)?\nThis will ingest the LinkedIn data into your workspace.`)) {
    input.value = '';
    return;
  }

  const btn = input.previousElementSibling;
  const originalText = btn.textContent;
  btn.textContent = '⏳ Uploading...';
  btn.disabled = true;

  try {
    const text = await file.text();
    const res = await fetch('/api/import/linkedin', {
      method: 'POST',
      headers: buildSecurityHeaders(),
      body: text
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }

    const result = await res.json();
    alert(`Import Complete!\n\nProcessed: ${result.count} \nErrors: ${result.errors} `);
    renderDashboard();
  } catch (error) {
    console.error('Import failed:', error);
    alert(`Import failed: ${error.message} `);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
    input.value = '';
  }
}

// Export to window for onclick handlers
window.renderDashboard = renderDashboard;
window.handleSync = handleSync;
window.handleLinkedInImport = handleLinkedInImport;

// End of dashboard.js
