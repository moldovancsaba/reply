/**
 * Reply Hub - Contacts Module
 * Manages contact list loading, display, and pagination
 */

import { fetchConversations } from './api.js';

// State
let contactOffset = 0;
let hasMoreContacts = true;
const CONTACT_LIMIT = 20;
export let conversations = []; // Global cache for contacts

/**
 * Load conversations/contacts with pagination
 * @param {boolean} append - Whether to append to existing list or replace
 */
export async function loadConversations(append = false) {
    const contactListEl = document.getElementById('contact-list');
    if (!contactListEl) return;

    try {
        // Show loading state
        if (!append) {
            contactListEl.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">Loading contacts...</div>';
        }

        // Fetch contacts from server
        const data = await fetchConversations(contactOffset, CONTACT_LIMIT);

        // Update state
        hasMoreContacts = data.hasMore;

        if (append) {
            conversations = [...conversations, ...data.contacts];
        } else {
            conversations = data.contacts;
            contactListEl.innerHTML = '';
        }

        // Render contacts
        data.contacts.forEach(contact => {
            const item = document.createElement('div');
            item.className = 'sidebar-item';
            item.dataset.handle = contact.handle;

            // Status indicator (only if not 'open' which is default)
            const statusDot = document.createElement('div');
            statusDot.className = 'status-dot';
            if (contact.status && contact.status !== 'open') {
                statusDot.classList.add(contact.status);
            } else {
                statusDot.style.display = 'none'; // Clean look for normal contacts
            }

            // Contact info
            const info = document.createElement('div');
            info.className = 'contact-info';

            const topRow = document.createElement('div');
            topRow.style.display = 'flex';
            topRow.style.justifyContent = 'space-between';
            topRow.style.alignItems = 'baseline';

            const name = document.createElement('div');
            name.className = 'contact-name';
            name.textContent = contact.name || contact.handle;

            // Optional: Time would go here if available
            // const time = document.createElement('div');
            // time.className = 'contact-time'; 

            topRow.appendChild(name);
            info.appendChild(topRow);

            const preview = document.createElement('div');
            preview.className = 'contact-preview';
            // Only show preview if it exists and isn't the default placeholder
            if (contact.lastMessage && contact.lastMessage !== 'Click to see history') {
                preview.textContent = contact.lastMessage;
            } else {
                preview.textContent = 'No recent messages';
            }

            info.appendChild(preview);

            // Message count badge - Only show if > 0
            const count = parseInt(contact.count || '0');
            if (count > 0) {
                const badge = document.createElement('div');
                badge.className = 'message-badge';
                badge.textContent = count > 99 ? '99+' : count;
                item.appendChild(badge);
            }

            item.appendChild(statusDot);
            item.appendChild(info);
            // Badge appends last to float right

            // Click handler
            item.onclick = () => window.selectContact(contact.handle);

            contactListEl.appendChild(item);
        });

        // Add "Load More" button if there are more contacts
        if (hasMoreContacts) {
            const btn = document.createElement('button');
            btn.id = 'load-more-contacts';
            btn.className = 'load-more-btn';
            btn.textContent = 'Load More Contacts...';
            btn.onclick = (e) => {
                e.stopPropagation();
                contactOffset += CONTACT_LIMIT;
                loadConversations(true);
            };
            contactListEl.appendChild(btn);
        }

    } catch (error) {
        console.error('Failed to load conversations:', error);
        contactListEl.innerHTML = `
      <div style="padding:20px; text-align:center; color:#d32f2f;">
        <p>Failed to load contacts</p>
        <button onclick="window.loadConversations()" style="margin-top:1rem; padding:0.5rem 1rem; cursor:pointer;">
          Retry
        </button>
      </div>
    `;
    }
}

/**
 * Select a contact to view their chat or show dashboard if null
 * @param {string|null} handle - Contact handle or null for dashboard
 */
export async function selectContact(handle) {
    const messagesEl = document.getElementById('messages');
    const dashboardEl = document.getElementById('dashboard');
    const activeNameEl = document.getElementById('active-contact-name-chat');
    const inputArea = document.querySelector('.input-area');

    // Update active state in sidebar
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.handle === handle) {
            item.classList.add('active');
        }
    });

    if (handle === null) {
        // Show dashboard
        activeNameEl.textContent = 'Reply Hub Dashboard';
        dashboardEl.style.display = 'grid';
        messagesEl.style.display = 'none';
        inputArea.style.display = 'none';
        document.getElementById('status-select').style.display = 'none';
        document.getElementById('btn-suggest').style.display = 'none';
        document.getElementById('kyc-empty-state').style.display = 'block';
        document.getElementById('kyc-content-editor').style.display = 'none';

        // Render dashboard
        await window.renderDashboard();
        return;
    }

    // Show chat view
    window.currentHandle = handle;
    dashboardEl.style.display = 'none';
    messagesEl.style.display = 'flex';
    inputArea.style.display = 'flex';
    document.getElementById('status-select').style.display = 'inline-block';
    document.getElementById('btn-suggest').style.display = 'inline-block';

    // Find contact info
    const contact = conversations.find(c => c.handle === handle);
    if (contact) {
        activeNameEl.textContent = contact.name || contact.handle;
        document.getElementById('active-contact-name').textContent = contact.name || contact.handle;
    }

    // Load messages
    await window.loadMessages(handle);

    // Load KYC
    await window.loadKYCData(handle);
}

// Export to window for onclick handlers
window.loadConversations = loadConversations;
window.selectContact = selectContact;
