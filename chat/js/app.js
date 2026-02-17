/**
 * Reply Hub - Main Application Entry Point
 * Initializes the application and sets up event listeners
 * 
 * @author Reply Hub Team
 * @version 2.0.0
 */

import { loadConversations, selectContact } from './contacts.js';
import { handleSendMessage } from './messages.js';
import { renderDashboard } from './dashboard.js';
import { saveKYCData } from './kyc.js';

// Global state
window.currentHandle = null;
window.conversations = [];

/**
 * Initialize the application
 * Sets up event listeners and loads initial data
 */
async function init() {
    console.log('🚀 Reply Hub initializing...');

    // Set up event listeners
    setupEventListeners();

    // Load contacts first
    await loadConversations();

    // Show dashboard by default (THIS IS THE KEY FIX!)
    await selectContact(null);

    console.log('✅ Reply Hub ready!');
}

/**
 * Set up all event listeners
 */
function setupEventListeners() {
    // Send message button
    const btnSend = document.getElementById('btn-send');
    if (btnSend) {
        btnSend.onclick = handleSendMessage;
    }

    // Chat input - send on Enter
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
            }
        });
    }

    // Save KYC button
    const btnSaveKYC = document.getElementById('btn-save-kyc');
    if (btnSaveKYC) {
        btnSaveKYC.onclick = saveKYCData;
    }

    // Search contacts
    const searchInput = document.getElementById('search-contacts');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const items = document.querySelectorAll('.sidebar-item');

            items.forEach(item => {
                const name = item.querySelector('.contact-name')?.textContent.toLowerCase() || '';
                const handle = item.dataset.handle?.toLowerCase() || '';

                if (name.includes(query) || handle.includes(query)) {
                    item.style.display = 'flex';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }

    // Status select
    const statusSelect = document.getElementById('status-select');
    if (statusSelect) {
        statusSelect.addEventListener('change', async (e) => {
            const status = e.target.value;
            const handle = window.currentHandle;

            if (!handle) return;

            try {
                const res = await fetch('/api/status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ handle, status })
                });

                if (res.ok) {
                    console.log(`Status updated to ${status} for ${handle}`);

                    // Update sidebar item
                    const item = document.querySelector(`[data-handle="${handle}"]`);
                    if (item) {
                        const dot = item.querySelector('.status-dot');
                        if (dot) {
                            dot.className = 'status-dot ' + status;
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to update status:', error);
            }
        });
    }

    // Suggest button
    const btnSuggest = document.getElementById('btn-suggest');
    if (btnSuggest) {
        btnSuggest.onclick = async () => {
            const handle = window.currentHandle;
            if (!handle) return;

            try {
                btnSuggest.disabled = true;
                btnSuggest.textContent = '⏳ Generating...';

                const res = await fetch('/api/suggest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ handle })
                });

                const data = await res.json();

                if (data.suggestion) {
                    document.getElementById('chat-input').value = data.suggestion;
                }

                btnSuggest.disabled = false;
                btnSuggest.textContent = '💡 Suggest';
            } catch (error) {
                console.error('Failed to get suggestion:', error);
                btnSuggest.disabled = false;
                btnSuggest.textContent = '💡 Suggest';
            }
        };
    }

    // Refine button on dashboard
    const btnRefine = document.querySelector('[onclick*="refine"]');
    if (btnRefine) {
        btnRefine.onclick = () => {
            alert('Refine feature coming soon!');
        };
    }
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Export for debugging
window.init = init;
