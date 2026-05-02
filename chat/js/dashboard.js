/**
 * {reply} - Dashboard Module
 * Renders system health dashboard with sync status and triage log
 */

import { fetchSystemHealth, fetchTriageLogs, fetchTriageQueue, fetchBridgeSummary, fetchOpenClawStatus, triggerSync, buildSecurityHeaders } from './api.js';
import { applyIconFallback } from './icon-fallback.js';
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

function metricValue(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function materialIcon(name, extraClass = '') {
  const className = ['material-symbols-outlined', extraClass].filter(Boolean).join(' ');
  return `<span class="${className}" data-icon="${escapeDashboardAttr(name)}" aria-hidden="true"></span>`;
}

function renderDashboardIcon({ iconName = '', iconAsset = '', title = '' } = {}) {
  if (iconAsset) {
    return `<img src="${escapeDashboardAttr(iconAsset)}" alt="${escapeDashboardAttr(title)}" class="platform-icon platform-icon--sm">`;
  }
  if (iconName) {
    return materialIcon(iconName, 'health-card-icon');
  }
  return '';
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

  root.querySelectorAll('[data-preflight-refresh]').forEach((btn) => {
    btn.addEventListener('click', () => {
      refreshAlertsPanel();
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
 * @param {string} [config.iconName] - Local material icon name
 * @param {string} [config.iconAsset] - Local image asset path
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
    iconName = '',
    iconAsset = ''
  } = config;

  const actionsHtml = actions.length > 0 ? `
    <div class="health-card-actions">
      ${actions.map(action => {
    if (action.type === 'settings') {
      return `<button type="button" class="btn-icon" data-dashboard-open-settings="${escapeDashboardAttr(action.channel)}" title="${escapeDashboardAttr(action.title || 'Configure')}">${materialIcon('settings')}</button>`;
    }
    if (action.type === 'sync') {
      return `<button type="button" class="btn-icon" data-dashboard-sync="${escapeDashboardAttr(action.channel)}" title="${escapeDashboardAttr(action.title || 'Sync')}">
            ${action.icon ? `<img src="${escapeDashboardAttr(action.icon)}" alt="${escapeDashboardText(action.channel)}" class="platform-icon platform-icon--sm">` : materialIcon(action.materialIcon || 'refresh')}
          </button>`;
    }
    if (action.type === 'service') {
      return `<button type="button" class="btn-icon" data-dashboard-service-control="${escapeDashboardAttr(action.name)}" data-dashboard-action="${escapeDashboardAttr(action.action)}" title="${escapeDashboardAttr(action.title || 'Control')}">
            ${materialIcon(action.materialIcon || 'refresh')}
          </button>`;
    }
    return '';
  }).join('')}
    </div>
  ` : '';

  const metaHtml = meta.map(m => {
    const overflowClass = m.overflow ? 'health-card-meta-overflow' : '';
    const wrapClass = m.wrap ? 'health-card-meta-wrap' : '';
    const metaTitle = m.title ? escapeDashboardAttr(m.title) : '';
    const body = m.html ? m.text : escapeDashboardText(m.text);
    return `<div class="health-card-meta ${overflowClass} ${wrapClass}" ${metaTitle ? `title="${metaTitle}"` : ''}>${body}</div>`;
  }).join('');

  const safeTitle = escapeDashboardText(title);
  const iconHtml = renderDashboardIcon({ iconName, iconAsset, title: safeTitle });

  return `
    <div class="health-card">
      <div class="health-card-header">
        <h4>${iconHtml}<span>${safeTitle}</span></h4>
        ${actionsHtml}
      </div>
      <div class="health-value">${escapeDashboardText(value)}</div>
      <div class="health-status-tag ${statusClass}">${escapeDashboardText(statusText)}</div>
      ${metaHtml}
    </div>
  `;
}

/**
 * Renders the System Alerts panel.
 * Only shown when health.repair array is non-empty.
 */
function escapeDashboardText(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeDashboardAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function summarizeChannelState(channel, options = {}) {
  const state = String(channel?.state || channel?.status || 'idle').toLowerCase();
  const hasRecentSuccess = Boolean(channel?.lastSuccessfulSync || channel?.lastSync);
  const sourceReadable = options.sourceReadable === true;
  const ingestedTotal = Number(channel?.ingestedTotal ?? channel?.processed) || 0;
  const canTrustHealthyMirror = sourceReadable && hasRecentSuccess && ingestedTotal >= 0;
  if ((state === 'error' || state === 'repair_required') && canTrustHealthyMirror) {
    return {
      value: ingestedTotal,
      statusText: '● Synced',
      statusClass: 'tag-online'
    };
  }
  if (state === 'error' || state === 'repair_required') {
    return {
      value: 'Blocked',
      statusText: '● Sync blocked',
      statusClass: 'tag-offline'
    };
  }
  if (state === 'running') {
    return {
      value: `${Math.max(0, Math.min(100, Number(channel?.progress) || 0))}%`,
      statusText: '● Sync running',
      statusClass: 'tag-warning'
    };
  }
  return {
    value: Number(channel?.ingestedTotal ?? channel?.processed) || 0,
    statusText: '● Synced',
    statusClass: 'tag-online'
  };
}

/**
 * Foundation / preflight matrix (hub contract + path probes).
 * @param {object|null} preflight - health.preflight from /api/system-health
 * @param {object} [health] - optional parent health for apiContract line
 */
function renderPreflightPanel(preflight, health) {
  if (!preflight || !Array.isArray(preflight.checks)) return '';

  const overall = preflight.overall || 'ready';
  const tagClass =
    overall === 'blocked' ? 'tag-offline' : overall === 'degraded' ? 'tag-warning' : 'tag-online';
  const runShort = preflight.runId ? String(preflight.runId).slice(0, 8) : '?';
  const ac = health?.apiContract;
  const contractLine = ac
    ? ` · contract hub ${escapeDashboardText(String(ac.hub))} / schema ${escapeDashboardText(String(ac.preflightSchema ?? ''))}`
    : '';
  const blockedCount = preflight.checks.filter((c) => c.status === 'blocked').length;
  const degradedCount = preflight.checks.filter((c) => c.status === 'degraded').length;
  const okCount = preflight.checks.filter((c) => c.status === 'ok').length;
  const issues = preflight.checks
    .filter((c) => c.status === 'blocked' || c.status === 'degraded')
    .slice(0, 3);
  const issueSummary = issues.length
    ? `<div class="preflight-problems">${issues
      .map((c) => {
        const issueClass = c.status === 'blocked' ? 'preflight-problem preflight-problem--blocked' : 'preflight-problem preflight-problem--degraded';
        return `<div class="${issueClass}">
          <strong>${escapeDashboardText(c.title)}</strong>
          <span>${escapeDashboardText(c.detail)}</span>
        </div>`;
      })
      .join('')}</div>`
    : `<div class="preflight-problems preflight-problems--ok">
        <div class="preflight-problem preflight-problem--ok">
          <strong>Foundation ready</strong>
          <span>All core runtime, data, channel, and AI checks are passing.</span>
        </div>
      </div>`;

  const rows = preflight.checks
    .map((c) => {
      const rowClass =
        c.status === 'blocked'
          ? 'preflight-row preflight-row--blocked'
          : c.status === 'degraded'
            ? 'preflight-row preflight-row--degraded'
            : 'preflight-row preflight-row--ok';
      const hint = c.hint
        ? `<span class="preflight-hint" title="${escapeDashboardAttr(c.hint)}">ⓘ</span>`
        : '';
      return `<div class="${rowClass}">
        <span class="preflight-cell preflight-cell--id">${escapeDashboardText(c.id)}</span>
        <span class="preflight-cell preflight-cell--title">${escapeDashboardText(c.title)}</span>
        <span class="preflight-cell preflight-cell--detail">${escapeDashboardText(c.detail)}</span>
        <span class="preflight-cell preflight-cell--status">${escapeDashboardText(c.status)}</span>
        ${hint}
      </div>`;
    })
    .join('');

  return `
    <div class="health-card health-card--span-full preflight-panel">
      <div class="health-card-header">
        <h4>${materialIcon('deployed_code', 'health-card-icon')}<span>Foundation (preflight)</span></h4>
        <div class="health-status-tag ${tagClass}">${escapeDashboardText(overall)}</div>
      </div>
      <div class="preflight-summary" aria-label="Preflight summary">
        <span class="preflight-summary-pill preflight-summary-pill--ok">${escapeDashboardText(String(okCount))} ok</span>
        <span class="preflight-summary-pill ${blockedCount ? 'preflight-summary-pill--blocked' : 'preflight-summary-pill--muted'}">${escapeDashboardText(String(blockedCount))} blocked</span>
        <span class="preflight-summary-pill ${degradedCount ? 'preflight-summary-pill--degraded' : 'preflight-summary-pill--muted'}">${escapeDashboardText(String(degradedCount))} degraded</span>
        <span class="preflight-summary-text">${escapeDashboardText(String(preflight.checks.length))} checks total</span>
      </div>
      <div class="preflight-meta">Run <code>${escapeDashboardText(runShort)}</code>… · preflight v${escapeDashboardText(String(preflight.schemaVersion ?? '?'))}${contractLine}</div>
      ${issueSummary}
      <div class="preflight-actions">
        <button type="button" class="btn btn-sm btn-secondary" data-preflight-refresh title="Re-fetch health">${materialIcon('refresh')} Refresh checks</button>
        <a class="btn btn-sm btn-secondary" href="settings.html#ai-status" title="Ollama and OpenClaw gateway">${materialIcon('settings')} AI &amp; gateways</a>
      </div>
      <div class="preflight-table">${rows}</div>
    </div>`;
}

function renderAlertsPanel(repairs) {
  if (!Array.isArray(repairs) || repairs.length === 0) return '';

  const SERVICE_ICONS = { worker: 'settings', openclaw: 'warning', ollama: 'auto-awesome' };
  const SEVERITY_CLASSES = { critical: 'alert-critical', warning: 'alert-warning' };

  const items = repairs.map(alert => {
    const icon = SERVICE_ICONS[alert.service] || 'warning';
    const severityClass = SEVERITY_CLASSES[alert.severity] || 'alert-warning';

    // All services (including ollama) get a direct launch button
    const startLabel = { ollama: 'Start Ollama', worker: 'Restart Worker', openclaw: 'Start OpenClaw' };
    const actionBtn = `<button type="button" class="btn btn-sm btn-repair" data-dashboard-service-control="${alert.service}" data-dashboard-action="${alert.service === 'ollama' ? 'start' : 'restart'}" title="${startLabel[alert.service] || 'Restart'}">${materialIcon('refresh')} ${startLabel[alert.service] || 'Try Again'}</button>`;

    const logBtn = alert.logPath
      ? `<button type="button" class="btn btn-sm btn-muted" onclick="navigator.clipboard&&navigator.clipboard.writeText('tail -f ${alert.logPath}')" title="Copy log command">${materialIcon('inventory')} Copy Log Cmd</button>`
      : '';

    const attemptsText = alert.attempts > 0 ? ` (auto-restarted ${alert.attempts}× already)` : '';

    return `
      <div class="system-alert ${severityClass}">
        <div class="system-alert-header">
          <span class="system-alert-icon">${materialIcon(icon)}</span>
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
        ${materialIcon('warning')}
        <strong>System Alerts — ${repairs.length} issue${repairs.length > 1 ? 's' : ''} detected</strong>
        <span class="system-alerts-note">Auto-repair has been attempted where possible.</span>
      </div>
      ${items}
    </div>`;
}

export async function renderDashboard() {
  const dashboard = document.getElementById('dashboard');
  if (!dashboard) return;

  const hadContent = dashboard.children.length > 0;
  if (!hadContent) {
    dashboard.innerHTML = '<div style="padding:40px; text-align:center; color:#666;">Loading dashboard...</div>';
  }
  dashboard.setAttribute('aria-busy', 'true');

  try {
    // Fetch dashboard data safely
    const [health, logs, triageQueue, bridgeData, openClawStatus] = await Promise.all([
      fetchSystemHealth().catch(e => ({ stats: {}, uptime: 0, channels: {} })),
      fetchTriageLogs(10).catch(e => []),
      fetchTriageQueue(12).catch(() => []),
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

    const imessageSourceCheck = Array.isArray(health.preflight?.checks)
      ? health.preflight.checks.find((c) => c.id === 'imessage_source')
      : null;
    const imessageSummary = summarizeChannelState(imessageSync, {
      sourceReadable: imessageSourceCheck?.status === 'ok'
    });

    // Format OpenClaw status
    const openClawOnline = String(openClawStatus.status || '').toLowerCase() === 'online';
    const shortError = openClawStatus.error || 'OpenClaw health check failed';
    const openClawStatusText = openClawOnline ? '● Gateway Running' : `● ${shortError}`;
    const openClawStatusClass = openClawOnline ? 'tag-online' : 'tag-offline';
    const fallbackOpenClawChannels = openClawOnline ? ['whatsapp'] : [];
    const openClawHeartbeat = openClawStatus.heartbeat || whatsappSync.lastAttemptedSync || whatsappSync.lastSuccessfulSync || whatsappSync.lastSync || null;

    const openClawMeta = [
      {
        wrap: true,
        text: `Linked: ${formatOpenClawChannelsSummary(openClawStatus.channels || fallbackOpenClawChannels)}`
      },
      { wrap: true, text: `Heartbeat: ${formatLastSync(openClawHeartbeat)}` }
    ];
    const openClawActions = [
      { type: 'settings', channel: 'whatsapp', title: 'OpenClaw Settings' }
    ];
    if (!openClawOnline) {
      openClawActions.push({ type: 'service', name: 'openclaw', action: 'start', materialIcon: 'radio-button-checked', title: 'Start OpenClaw Gateway' });
    } else {
      openClawActions.push({ type: 'service', name: 'openclaw', action: 'restart', materialIcon: 'refresh', title: 'Restart OpenClaw Gateway' });
    }

    // Render dashboard HTML
    dashboard.innerHTML = `
      <div class="dashboard-section-stack">
        ${renderAlertsPanel(health.repair || [])}
        ${renderPreflightPanel(health.preflight || null, health)}
      </div>

      <div class="dashboard-grid">
      ${renderHealthCard({
      title: 'OpenClaw Health',
      iconName: 'warning',
      value: openClawOnline ? (openClawStatus.version || 'Connected') : 'Offline',
      statusText: openClawStatusText,
      statusClass: openClawStatusClass,
      meta: openClawMeta,
      actions: openClawActions
    })
      }

       ${renderHealthCard({
        title: 'System Status',
        iconName: 'desktop_windows',
        value: 'Online',
        statusText: '● Server Running',
        statusClass: 'tag-online',
        meta: [
          {
            html: true,
            text: `<span>Uptime: ${uptimeHrs}h</span>&nbsp;&nbsp;<span>Contacts: ${health.stats?.total || 0}</span>`
          }
        ]
      })
      }

      ${(() => {
        const worker = health.services?.worker || { status: 'offline' };
        const workerUptime = worker.uptime ? (worker.uptime / 3600).toFixed(1) + 'h' : '0h';

        const workerActions = [];
        if (worker.status === 'online') {
          workerActions.push({ type: 'service', name: 'worker', action: 'restart', materialIcon: 'refresh', title: 'Restart Worker' });
        } else {
          workerActions.push({ type: 'service', name: 'worker', action: 'start', materialIcon: 'radio-button-checked', title: 'Start Worker' });
        }

        const startedLabel = worker.startedAt ? formatLastSync(worker.startedAt) : '—';
        return renderHealthCard({
          title: 'Background Worker',
          iconName: 'sync',
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
        iconAsset: '/public/imessage.svg',
        value: imessageSummary.value,
        statusText: imessageSummary.statusText,
        statusClass: imessageSummary.statusClass,
        meta: [
          { text: `History: ${Number(imessageSync.ingestedTotal ?? imessageSync.processed) || 0} messages` },
          { text: `Last success: ${formatLastSync(imessageSync.lastSuccessfulSync || imessageSync.lastSync)}` },
          { wrap: true, title: imessageSync.message || '', text: imessageSync.message || `Last attempt: ${formatLastSync(imessageSync.lastAttemptedSync)}` }
        ],
        actions: [
          { type: 'settings', channel: 'imessage', title: 'Configure iMessage' },
          { type: 'sync', channel: 'imessage', icon: '/public/imessage.svg', title: 'Sync iMessage' }
        ]
      })
      }
      
      ${renderHealthCard({
        title: 'WhatsApp Sync',
        iconAsset: '/public/whatsapp.svg',
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
        iconAsset: '/public/linkedin.svg',
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
        iconAsset: '/public/mail.svg',
        value: metricValue(mailSync.total, mailSync.processed, mailSync.ingestedTotal),
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
        iconAsset: '/public/linkedin.svg',
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
        iconName: 'description',
        value: metricValue(notesSync.total, notesSync.ingestedTotal, notesSync.processed, notesSync.updated),
        statusText: '● Notes Scanned',
        meta: [{ text: `Sync: ${formatLastSync(notesSync.lastSync)}` }],
        actions: [
          { type: 'settings', channel: 'notes', title: 'Configure Notes' },
          { type: 'sync', channel: 'notes', materialIcon: 'attachment', title: 'Sync Notes' }
        ]
      })
      }
      
      ${renderHealthCard({
        title: 'Contacts Sync',
        iconName: 'contacts',
        value: health.stats?.total || 0,
        statusText: '● Shared Storage',
        meta: [
          { text: `LI: ${health.stats?.byChannel?.linkedin || 0} | WA: ${health.stats?.byChannel?.whatsapp || 0} | AP: ${health.stats?.byChannel?.apple_contacts || 0}` },
          { text: `Sync: ${formatLastSync(contactSync.lastSync)}` }
        ],
        actions: [
          { type: 'sync', channel: 'contacts', materialIcon: 'person', title: 'Sync Contacts from Apple Contacts' }
        ]
      })
      }
      
      ${renderHealthCard({
        title: 'Contact Intelligence',
        iconName: 'neurology',
        value: kycSync.index != null ? kycSync.index + 1 : 0,
        statusText: kycSync.state === 'running' ? '● Analyzing Contacts...' : '● Idle',
        statusClass: kycSync.state === 'running' ? 'tag-online' : '',
        meta: [
          { text: `Progress: ${kycSync.index != null && kycSync.total ? Math.round((kycSync.index / kycSync.total) * 100) : 0}% (${kycSync.index != null ? kycSync.index + 1 : 0}/${kycSync.total || 0})` },
          { overflow: true, title: kycSync.message || '', text: kycSync.message || 'Waiting...' },
          { text: `Pulse: ${formatLastSync(kycSync.timestamp)}` }
        ],
        actions: [
          { type: 'sync', channel: 'kyc', materialIcon: 'school', title: 'Run Intelligence Sweep' }
        ]
      })
      }
      </div>

      <div class="dashboard-section-stack">
        <div class="health-card health-card--span-full dashboard-triage-card">
          <div class="health-card-header">
            <h4>${materialIcon('inventory', 'health-card-icon')}<span>Triage queue (priority)</span></h4>
          </div>
          <div class="triage-log-header triage-log-header--4" aria-hidden="true">
            <span>Priority</span><span>Actions</span><span>Rule</span><span>Contact</span>
          </div>
          <div id="dashboard-triage-queue" class="triage-log triage-log--4">
          </div>
        </div>

        <div class="health-card health-card--span-full dashboard-triage-card">
          <div class="health-card-header">
            <h4>${materialIcon('inventory', 'health-card-icon')}<span>Recent Triage Log</span></h4>
          </div>
          <div class="triage-log-header triage-log-header--4" aria-hidden="true">
            <span>Time</span><span>Action</span><span>Suggested</span><span>Contact</span>
          </div>
          <div id="dashboard-triage-log" class="triage-log triage-log--4">
            <!-- Triage entries will be injected safely via JS -->
          </div>
        </div>
      </div>
    `;
    const queueContainer = dashboard.querySelector('#dashboard-triage-queue');
    if (queueContainer) {
      queueContainer.innerHTML = '';
      const q = Array.isArray(triageQueue) ? triageQueue : [];
      if (q.length > 0) {
        q.forEach((row) => {
          const entry = document.createElement('div');
          entry.className = 'triage-entry';

          const pri = document.createElement('span');
          pri.className = 'triage-time';
          pri.textContent = row.priority != null ? String(row.priority) : '—';
          entry.appendChild(pri);

          const chips = document.createElement('span');
          chips.className = 'triage-action';
          chips.textContent = (Array.isArray(row.suggestedActions) && row.suggestedActions.length)
            ? row.suggestedActions.join(', ')
            : '—';
          entry.appendChild(chips);

          const rule = document.createElement('span');
          rule.className = 'triage-action';
          rule.textContent = row.ruleId || row.tag || '—';
          entry.appendChild(rule);

          const contact = document.createElement('span');
          contact.className = 'triage-contact';
          const who = (row.contact || row.sender || '').trim();
          contact.textContent = who || '—';
          contact.title = who || '';
          entry.appendChild(contact);

          queueContainer.appendChild(entry);
        });
      } else {
        const empty = document.createElement('div');
        empty.style.color = '#888';
        empty.style.padding = '1rem';
        empty.textContent = 'No triage matches yet — rules live in chat/triage-rules.json';
        queueContainer.appendChild(empty);
      }
    }

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

          const suggested = document.createElement('span');
          suggested.className = 'triage-action';
          suggested.textContent = (Array.isArray(log.suggestedActions) && log.suggestedActions.length)
            ? log.suggestedActions.join(', ')
            : '—';
          entry.appendChild(suggested);

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
    applyIconFallback(dashboard);
  } catch (error) {
    console.error('Failed to render dashboard:', error);
    if (!hadContent) {
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
    }
  } finally {
    dashboard.removeAttribute('aria-busy');
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

    const preflightRoot = dashboard.querySelector('.preflight-panel');
    const preflightHtml = renderPreflightPanel(health.preflight || null, health);
    if (preflightHtml) {
      if (preflightRoot) preflightRoot.outerHTML = preflightHtml;
      else {
        const firstCard = dashboard.querySelector('.health-card');
        if (firstCard) firstCard.insertAdjacentHTML('beforebegin', preflightHtml);
        else dashboard.insertAdjacentHTML('afterbegin', preflightHtml);
      }
    } else if (preflightRoot) {
      preflightRoot.remove();
    }

    // Re-wire buttons after DOM update (alerts + preflight refresh)
    const newPanel = dashboard.querySelector('.system-alerts-panel');
    if (newPanel) wireDashboardActions(newPanel);
    const prefPanel = dashboard.querySelector('.preflight-panel');
    if (prefPanel) wireDashboardActions(prefPanel);
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
