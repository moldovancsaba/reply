/**
 * {reply} - Dashboard Module
 * Renders system health dashboard with sync status and triage log
 */

import { fetchSystemHealth, fetchTriageLogs, fetchBridgeSummary, triggerSync, buildSecurityHeaders } from './api.js';

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

  const retryBtn = root.querySelector('[data-dashboard-retry]');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => renderDashboard());
  }
}

/**
 * Render the dashboard with system health cards
 * Shows system status, sync status for each source, and recent triage log
 */
export async function renderDashboard() {
  const dashboard = document.getElementById('dashboard');
  if (!dashboard) return;

  // Show loading state
  dashboard.innerHTML = '<div style="padding:40px; text-align:center; color:#666;">Loading dashboard...</div>';

  try {
    // Fetch dashboard data
    const [health, logs, bridgeData] = await Promise.all([
      fetchSystemHealth(),
      fetchTriageLogs(10),
      fetchBridgeSummary(300)
    ]);

    // Calculate uptime
    const uptimeHrs = (health.uptime / 3600).toFixed(1);

    // Get sync data for each source
    const imessageSync = health.channels?.imessage || {};
    const whatsappSync = health.channels?.whatsapp || {};
    const notesSync = health.channels?.notes || {};
    const mailSync = health.channels?.mail || {};
    const bridgeSummary = bridgeData?.summary || {};
    const bridgeCounts = bridgeSummary?.counts || {};
    const bridgeIngested = Number(bridgeCounts?.ingested) || 0;
    const bridgeDuplicates = Number(bridgeCounts?.duplicate) || 0;
    const bridgeErrors = Number(bridgeCounts?.error) || 0;
    const bridgeLast = bridgeSummary?.lastEventAt || null;
    const bridgeRollout = bridgeSummary?.rollout || {};
    const modeOf = (channel) => bridgeRollout?.[channel] || 'draft_only';

    // Format last sync times
    const formatLastSync = (timestamp) => {
      if (!timestamp) return 'Never';
      const date = new Date(timestamp);
      return date.toLocaleString();
    };

    // Render dashboard HTML
    dashboard.innerHTML = `
      <div class="health-card">
        <h4>System Status</h4>
        <div class="health-value">Online</div>
        <div class="health-status-tag tag-online">● Server Running</div>
        <div style="font-size:0.8rem; color:#888; margin-top:0.5rem;">Uptime: ${uptimeHrs} hours</div>
      </div>

      <div class="health-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h4>iMessage Sync</h4>
          <div style="display:flex; gap:6px; align-items:center;">
            <button type="button" class="btn-icon" data-dashboard-open-settings="imessage" title="Configure iMessage">
              ⚙️
            </button>
            <button type="button" class="btn-icon" data-dashboard-sync="imessage" title="Sync iMessage">
              <img src="/public/imessage.svg" alt="iMessage" class="platform-icon platform-icon--sm">
            </button>
          </div>
        </div>
        <div class="health-value">${imessageSync.processed || 0}</div>
        <div class="health-status-tag">● Messages Scanned</div>
        <div style="font-size:0.8rem; color:#888; margin-top:0.5rem;">
          Last Sync: ${formatLastSync(imessageSync.lastSync)}
        </div>
      </div>

      <div class="health-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h4>WhatsApp Sync</h4>
          <div style="display:flex; gap:6px; align-items:center;">
            <button type="button" class="btn-icon" data-dashboard-open-settings="whatsapp" title="Configure WhatsApp">
              ⚙️
            </button>
            <button type="button" class="btn-icon" data-dashboard-sync="whatsapp" title="Sync WhatsApp">
              <img src="/public/whatsapp.svg" alt="WhatsApp" class="platform-icon platform-icon--sm">
            </button>
          </div>
        </div>
        <div class="health-value">${whatsappSync.processed || 0}</div>
        <div class="health-status-tag">● Messages Scanned</div>
        <div style="font-size:0.8rem; color:#888; margin-top:0.5rem;">
          Last Sync: ${formatLastSync(whatsappSync.lastSync)}
        </div>
      </div>

      <div class="health-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h4>Notes Sync</h4>
          <div style="display:flex; gap:6px; align-items:center;">
            <button type="button" class="btn-icon" data-dashboard-open-settings="notes" title="Configure Notes">
              ⚙️
            </button>
            <button type="button" class="btn-icon" data-dashboard-sync="notes" title="Sync Notes">
              📝
            </button>
          </div>
        </div>
        <div class="health-value">${notesSync.processed || 0}</div>
        <div class="health-status-tag">● Notes Scanned</div>
        <div style="font-size:0.8rem; color:#888; margin-top:0.5rem;">
          Last Sync: ${formatLastSync(notesSync.lastSync)}
        </div>
      </div>

      <div class="health-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h4>LinkedIn</h4>
          <div style="display:flex; gap:6px; align-items:center;">
            <button type="button" class="btn-icon" data-dashboard-copy-script="linkedin" title="Copy Inbound Script to Clipboard">
              📋
            </button>
            <button type="button" class="btn-icon" data-dashboard-open-settings="linkedin" title="Configure LinkedIn">
              ⚙️
            </button>
            <div title="Inbound via Bridge / Outbound via Desktop Automation" style="cursor:help;">
               <img src="/public/linkedin.svg" alt="LinkedIn" class="platform-icon platform-icon--sm" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzAwNzdiNSI+PHBhdGggZD0iTTE5IDNoLTZhMiAyIDAgMCAwLTIgMnYxNGgyVjVoNnYxNGgyVjVhMiAyIDAgMCAwLTItMnpmLTkgMTJ2Mmgydi0yaC0yem0tNS0yYTItMiAwIDAgMC0yIDJ2MTRoMlY1aC0yem0yIDZ2Mmgydi0yaC0yeiIvPjwvc3ZnPg=='">
            </div>
          </div>
        </div>
        <div class="health-value">${(bridgeSummary.channels?.linkedin?.ingested || 0)}</div>
        <div class="health-status-tag ${modeOf('linkedin') === 'draft_only' ? 'tag-online' : ''}">
          ${modeOf('linkedin') === 'draft_only' ? '● Messages Scanned' : '● Disabled'}
        </div>
        <div style="font-size:0.8rem; color:#888; margin-top:0.5rem;">
          Source: Chrome Extension
        </div>
        <div style="font-size:0.8rem; color:#888; margin-top:0.5rem; display:flex; gap:10px; align-items:center;">
            <span style="flex:1;">Last Sync: ${formatLastSync(bridgeSummary.channels?.linkedin?.lastAt)}</span>
            <button type="button" onclick="document.getElementById('linkedin-import-input').click()" style="padding:2px 8px; font-size:0.75rem; cursor:pointer;" title="Import messages.csv or Connections.csv from Data Archive">
                📥 Import Archive
            </button>
            <input type="file" id="linkedin-import-input" style="display:none;" accept=".csv" onchange="handleLinkedInImport(this)">
        </div>
      </div>

      <div class="health-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h4>Email Sync</h4>
          <div style="display:flex; gap:6px; align-items:center;">
            <button type="button" class="btn-icon" data-dashboard-open-settings="email" title="Configure Email">
              ⚙️
            </button>
            <button type="button" class="btn-icon" data-dashboard-sync="mail" title="Sync Email (Apple Mail or IMAP)">
              <img src="/public/mail.svg" alt="Email" class="platform-icon platform-icon--sm">
            </button>
          </div>
        </div>
        <div class="health-value">${mailSync.processed || 0}</div>
        <div class="health-status-tag">● Emails Scanned</div>
        <div style="font-size:0.8rem; color:#888; margin-top:0.5rem;">
          ${mailSync.connected && mailSync.account ? `Connected as: ${mailSync.account}` : 'Not connected'}
        </div>
        <div style="font-size:0.8rem; color:#888; margin-top:0.5rem;">
          Last Sync: ${formatLastSync(mailSync.lastSync)}
        </div>
      </div>

      <div class="health-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h4>Channel Bridge</h4>
          <button type="button" class="btn-icon" data-dashboard-open-settings="bridge" title="Configure Bridge rollout">
            ⚙️
          </button>
        </div>
        <div style="display:flex; gap:12px; align-items:flex-end;">
          <div>
            <div class="health-value">${bridgeIngested}</div>
            <div class="health-status-tag">● Ingested (recent)</div>
          </div>
          <div style="font-size:0.85rem; color:#999;">
            <div>Duplicates: ${bridgeDuplicates}</div>
            <div>Errors: ${bridgeErrors}</div>
          </div>
        </div>
        <div style="font-size:0.8rem; color:#888; margin-top:0.5rem;">
          Telegram: ${modeOf('telegram')} | Discord: ${modeOf('discord')}<br>
          Signal: ${modeOf('signal')} | Viber: ${modeOf('viber')}<br>
          LinkedIn: ${modeOf('linkedin')}
        </div>
        <div style="font-size:0.8rem; color:#888; margin-top:0.5rem;">
          Last event: ${formatLastSync(bridgeLast)}
        </div>
      </div>

      <div class="health-card" style="grid-column: 1 / -1;">
        <h4>Recent Triage Log</h4>
        <div id="dashboard-triage-log" class="triage-log">
          <!-- Triage entries will be injected safely via JS -->
        </div>
      </div>
    `;
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
    return;
  }

  // Safe injection of triage logs
  const triageContainer = dashboard.querySelector('#dashboard-triage-log');
  if (triageContainer) {
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
        contact.textContent = log.contact || 'N/A';
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
}

/**
 * Handle sync button click
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

    if (button) button.textContent = '✅';
    setTimeout(() => {
      renderDashboard(); // Refresh dashboard
    }, 1000);
  } catch (error) {
    console.error(`Sync failed for ${source}:`, error);
    alert(`Sync failed: ${error.message}`);
    if (button) {
      button.disabled = false;
      button.innerHTML = originalHtml;
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

  if (!confirm(`Import ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)?\nThis will ingest all messages into the history.`)) {
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
    alert(`Import Complete!\n\nProcessed: ${result.count}\nErrors: ${result.errors}`);
    renderDashboard();
  } catch (error) {
    console.error('Import failed:', error);
    alert(`Import failed: ${error.message}`);
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
