/**
 * Reply Hub - Dashboard Module
 * Renders system health dashboard with sync status and triage log
 */

import { fetchSystemHealth, fetchTriageLogs, triggerSync } from './api.js';

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
        const [health, logs] = await Promise.all([
            fetchSystemHealth(),
            fetchTriageLogs(10)
        ]);

        // Calculate uptime
        const uptimeHrs = (health.uptime / 3600).toFixed(1);

        // Get sync data for each source
        const imessageSync = health.channels?.imessage || {};
        const whatsappSync = health.channels?.whatsapp || {};
        const notesSync = health.channels?.notes || {};

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
          <button class="btn-icon" onclick="window.handleSync('imessage')" title="Sync iMessage">
            💬
          </button>
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
          <button class="btn-icon" onclick="window.handleSync('whatsapp')" title="Sync WhatsApp">
            📱
          </button>
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
          <button class="btn-icon" onclick="window.handleSync('notes')" title="Sync Notes">
            📝
          </button>
        </div>
        <div class="health-value">${notesSync.processed || 0}</div>
        <div class="health-status-tag">● Notes Scanned</div>
        <div style="font-size:0.8rem; color:#888; margin-top:0.5rem;">
          Last Sync: ${formatLastSync(notesSync.lastSync)}
        </div>
      </div>

      <div class="health-card" style="grid-column: 1 / -1;">
        <h4>Recent Triage Log</h4>
        <div class="triage-log">
          ${logs.length > 0 ? logs.map(log => `
            <div class="triage-entry">
              <span class="triage-time">${new Date(log.timestamp).toLocaleTimeString()}</span>
              <span class="triage-action">${log.action}</span>
              <span class="triage-contact">${log.contact || 'N/A'}</span>
            </div>
          `).join('') : '<div style="color:#888; padding:1rem;">No recent activity</div>'}
        </div>
      </div>
    `;
    } catch (error) {
        console.error('Failed to render dashboard:', error);
        dashboard.innerHTML = `
      <div style="padding:40px; text-align:center; color:#d32f2f;">
        <h3>Failed to load dashboard</h3>
        <p>${error.message}</p>
        <button onclick="window.renderDashboard()" style="margin-top:1rem; padding:0.5rem 1rem; cursor:pointer;">
          Retry
        </button>
      </div>
    `;
    }
}

/**
 * Handle sync button click
 * @param {string} source - Source to sync ('imessage', 'whatsapp', 'notes')
 */
export async function handleSync(source) {
    try {
        const button = event.target;
        button.disabled = true;
        button.textContent = '⏳';

        await triggerSync(source);

        button.textContent = '✅';
        setTimeout(() => {
            renderDashboard(); // Refresh dashboard
        }, 1000);
    } catch (error) {
        console.error(`Sync failed for ${source}:`, error);
        alert(`Sync failed: ${error.message}`);
        event.target.disabled = false;
    }
}

// Export to window for onclick handlers
window.renderDashboard = renderDashboard;
window.handleSync = handleSync;
