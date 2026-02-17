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

    // Suggest button - Guaranteed Output
    const btnSuggest = document.getElementById('btn-suggest');
    const chatInput = document.getElementById('chat-input'); // Ensure ref

    if (btnSuggest) {
        btnSuggest.onclick = async () => {
            const handle = window.currentHandle;
            // Provide suggestion even without handle for demo

            try {
                btnSuggest.disabled = true;
                const originalText = btnSuggest.textContent;
                btnSuggest.textContent = '⏳ ...';

                // Try API first
                let suggestion = "";
                if (handle) {
                    try {
                        const res = await fetch('/api/suggest', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ handle })
                        });
                        const data = await res.json();
                        suggestion = data.suggestion;
                    } catch (e) {
                        console.warn('API suggest failed, using fallback');
                    }
                }

                // Fallback / Default Content if API returns nothing or fails
                if (!suggestion) {
                    const greetings = ["Hi there, just checking in!", "Hello! How can I help?", "Hey, do you have a minute?", "Just saw your message, thanks!"];
                    suggestion = greetings[Math.floor(Math.random() * greetings.length)];
                }

                chatInput.value = suggestion;

                btnSuggest.disabled = false;
                btnSuggest.textContent = originalText;
            } catch (error) {
                console.error('Failed to get suggestion:', error);
                chatInput.value = "Error generating draft, but here is a placeholder.";
                btnSuggest.disabled = false;
                btnSuggest.textContent = '💡 Suggest';
            }
        };
    }

    // Mic Button - Simulation
    const btnMic = document.getElementById('btn-mic');
    if (btnMic) {
        btnMic.onclick = () => {
            if (btnMic.classList.contains('recording')) {
                btnMic.classList.remove('recording');
                btnMic.textContent = '🎤 Mic';
                btnMic.style.color = '';
                btnMic.style.background = '';
                chatInput.value += " [Voice Transcription Completed]";
            } else {
                btnMic.classList.add('recording');
                btnMic.textContent = '🔴 Rec';
                btnMic.style.color = 'white';
                btnMic.style.background = 'var(--danger)';
                // Simulate listening
                setTimeout(() => {
                    if (btnMic.classList.contains('recording')) {
                        btnMic.click(); // Stop recording automatically for demo
                    }
                }, 3000);
            }
        };
    }

    // Magic Button - Instant Polish
    const btnMagic = document.getElementById('btn-magic');
    if (btnMagic) {
        btnMagic.onclick = () => {
            const val = chatInput.value;
            if (!val) {
                alert("Please type something to polish first!");
                return;
            }

            // Simple deterministic "polish" for demo (Capitalize and add period)
            // In future this would call AI
            let polished = val.trim();
            polished = polished.charAt(0).toUpperCase() + polished.slice(1);
            if (!polished.endsWith('.') && !polished.endsWith('!') && !polished.endsWith('?')) {
                polished += '.';
            }

            // Add professional padding if short
            if (polished.length < 10 && !polished.includes("Thanks")) {
                polished = "Hi, " + polished + " Thanks.";
            }

            chatInput.value = polished;

            // Visual feedback
            const originalText = btnMagic.textContent;
            btnMagic.textContent = '✨ Done';
            setTimeout(() => btnMagic.textContent = originalText, 1000);
        };
    }

    // Start the application when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Export for debugging
    window.init = init;
