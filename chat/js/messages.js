/**
 * Reply Hub - Messages Module
 * Handles message thread loading, display, and sending
 */

import { fetchMessages, sendMessage } from './api.js';

// State
let messageOffset = 0;
let hasMoreMessages = true;
const MESSAGE_LIMIT = 30;

/**
 * Load message thread for a contact
 * @param {string} handle - Contact handle
 * @param {boolean} append - Whether to append to existing messages or replace
 */
export async function loadMessages(handle, append = false) {
    const messagesEl = document.getElementById('messages');
    if (!messagesEl) return;

    try {
        // Show loading state
        if (!append) {
            messagesEl.innerHTML = '<div style="padding:40px; text-align:center; color:#888;">Loading messages...</div>';
            messageOffset = 0;
        }

        // Fetch messages
        const messages = await fetchMessages(handle, messageOffset, MESSAGE_LIMIT);

        // Update state
        hasMoreMessages = messages.length === MESSAGE_LIMIT;

        if (!append) {
            messagesEl.innerHTML = '';
        }

        // Remove "Load More" button if it exists
        const loadMoreBtn = messagesEl.querySelector('.load-more-messages');
        if (loadMoreBtn) loadMoreBtn.remove();

        // Render messages (newest first)
        messages.forEach(msg => {
            const bubble = document.createElement('div');
            bubble.className = `message-bubble ${msg.is_from_me ? 'me' : 'them'}`;
            bubble.textContent = msg.text || '';

            // Add timestamp
            const time = document.createElement('div');
            time.className = 'message-time';
            time.textContent = new Date(msg.date).toLocaleString();
            bubble.appendChild(time);

            if (append) {
                messagesEl.appendChild(bubble);
            } else {
                messagesEl.prepend(bubble);
            }
        });

        // Add "Load More" button if there are more messages
        if (hasMoreMessages) {
            const btn = document.createElement('button');
            btn.className = 'load-more-messages';
            btn.textContent = 'Load Older Messages...';
            btn.style.cssText = 'margin:1rem auto; padding:0.5rem 1rem; cursor:pointer; display:block;';
            btn.onclick = () => {
                messageOffset += MESSAGE_LIMIT;
                loadMessages(handle, true);
            };
            messagesEl.appendChild(btn);
        }

        // Scroll to top (newest messages)
        if (!append) {
            messagesEl.scrollTop = 0;
        }

    } catch (error) {
        console.error('Failed to load messages:', error);
        messagesEl.innerHTML = `
      <div style="padding:40px; text-align:center; color:#d32f2f;">
        <p>Failed to load messages</p>
        <button onclick="window.loadMessages('${handle}')" style="margin-top:1rem; padding:0.5rem 1rem; cursor:pointer;">
          Retry
        </button>
      </div>
    `;
    }
}

/**
 * Send a message to the current contact
 */
export async function handleSendMessage() {
    const chatInput = document.getElementById('chat-input');
    const messagesEl = document.getElementById('messages');
    const currentHandle = window.currentHandle;

    if (!chatInput || !currentHandle) return;

    const text = chatInput.value.trim();
    if (!text) return;

    try {
        // Determine if this is an email
        const isEmail = currentHandle.includes('@') && !currentHandle.includes('icloud.com');

        // Send message
        const result = await sendMessage(currentHandle, text, isEmail);

        if (result.status === 'ok') {
            // Clear input
            chatInput.value = '';

            // Optimistically add message to UI
            const bubble = document.createElement('div');
            bubble.className = 'message-bubble me';
            bubble.textContent = text;

            const time = document.createElement('div');
            time.className = 'message-time';
            time.textContent = new Date().toLocaleString();
            bubble.appendChild(time);

            messagesEl.prepend(bubble);
            messagesEl.scrollTop = 0;
        } else {
            alert('Send failed: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Failed to send message:', error);
        alert('Error: ' + error.message);
    }
}

// Export to window for onclick handlers
window.loadMessages = loadMessages;
window.handleSendMessage = handleSendMessage;
