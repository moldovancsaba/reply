/**
 * Reply Hub - KYC Module
 * Manages contact profile (Know Your Customer) data
 */

import { loadKYC, saveKYC } from './api.js';

/**
 * Load KYC profile data for a contact
 * @param {string} handle - Contact handle
 */
export async function loadKYCData(handle) {
    const kycNameInput = document.getElementById('kyc-name-input');
    const kycRoleInput = document.getElementById('kyc-role-input');
    const kycRelInput = document.getElementById('kyc-rel-input');
    const kycHandleInput = document.getElementById('kyc-handle-input');
    const kycNotesInput = document.getElementById('kyc-notes-input');
    const kycEmptyState = document.getElementById('kyc-empty-state');
    const kycEditor = document.getElementById('kyc-content-editor');

    if (!handle) {
        kycEmptyState.style.display = 'block';
        kycEditor.style.display = 'none';
        return;
    }

    try {
        const data = await loadKYC(handle);

        // Always show editor if a handle is selected, allowing user to create new profile
        kycEmptyState.style.display = 'none';
        kycEditor.style.display = 'block';

        if (data) {
            kycNameInput.value = data.name || '';
            kycRoleInput.value = data.role || '';
            kycRelInput.value = data.relationship || '';
            kycHandleInput.value = handle;
            kycNotesInput.value = data.notes || '';
        } else {
            // New profile for this handle
            kycNameInput.value = '';
            kycRoleInput.value = '';
            kycRelInput.value = '';
            kycHandleInput.value = handle;
            kycNotesInput.value = '';
        }
    } catch (error) {
        console.error('Failed to load KYC (likely new profile):', error);
        // Even on error (e.g. 404), show the editor so user can create the profile
        kycEmptyState.style.display = 'none';
        kycEditor.style.display = 'block';

        // Reset fields for new profile
        kycNameInput.value = '';
        kycRoleInput.value = '';
        kycRelInput.value = '';
        kycHandleInput.value = handle;
        kycNotesInput.value = '';
    }
}

/**
 * Save KYC profile data for current contact
 */
export async function saveKYCData() {
    const kycNameInput = document.getElementById('kyc-name-input');
    const kycRoleInput = document.getElementById('kyc-role-input');
    const kycRelInput = document.getElementById('kyc-rel-input');
    const kycHandleInput = document.getElementById('kyc-handle-input');
    const kycNotesInput = document.getElementById('kyc-notes-input');

    const handle = kycHandleInput.value;
    if (!handle) return;

    const data = {
        name: kycNameInput.value.trim(),
        role: kycRoleInput.value.trim(),
        relationship: kycRelInput.value.trim(),
        notes: kycNotesInput.value.trim()
    };

    try {
        const result = await saveKYC(handle, data);

        if (result.status === 'ok') {
            alert('Profile saved successfully!');

            // Update contact name in sidebar
            const contact = window.conversations?.find(c => c.handle === handle);
            if (contact) {
                contact.name = data.name;
            }

            // Update active contact name
            document.getElementById('active-contact-name').textContent = data.name || handle;
            document.getElementById('active-contact-name-chat').textContent = data.name || handle;

            // Refresh contact list to show updated name
            await window.loadConversations();
        } else {
            alert('Save failed: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Failed to save KYC:', error);
        alert('Error: ' + error.message);
    }
}

/**
 * Show profile modal for editing
 */
export function showProfileModal() {
    const modal = document.getElementById('profile-modal');
    const profName = document.getElementById('prof-name');
    const profRole = document.getElementById('prof-role');
    const profRel = document.getElementById('prof-rel');
    const profNotes = document.getElementById('prof-notes');
    const profHandle = document.getElementById('prof-handle');

    const currentHandle = window.currentHandle;
    if (!currentHandle) return;

    // Load current KYC data
    const kycNameInput = document.getElementById('kyc-name-input');
    const kycRoleInput = document.getElementById('kyc-role-input');
    const kycRelInput = document.getElementById('kyc-rel-input');
    const kycNotesInput = document.getElementById('kyc-notes-input');

    profName.value = kycNameInput.value;
    profRole.value = kycRoleInput.value;
    profRel.value = kycRelInput.value;
    profNotes.value = kycNotesInput.value;
    profHandle.value = currentHandle;

    modal.style.display = 'flex';
}

/**
 * Close profile modal
 */
export function closeProfileModal() {
    const modal = document.getElementById('profile-modal');
    modal.style.display = 'none';
}

/**
 * Save profile from modal
 */
export async function saveProfile() {
    const profName = document.getElementById('prof-name');
    const profRole = document.getElementById('prof-role');
    const profRel = document.getElementById('prof-rel');
    const profNotes = document.getElementById('prof-notes');
    const profHandle = document.getElementById('prof-handle');

    const handle = profHandle.value;
    if (!handle) return;

    const data = {
        name: profName.value.trim(),
        role: profRole.value.trim(),
        relationship: profRel.value.trim(),
        notes: profNotes.value.trim()
    };

    try {
        const result = await saveKYC(handle, data);

        if (result.status === 'ok') {
            // Update inline editor
            document.getElementById('kyc-name-input').value = data.name;
            document.getElementById('kyc-role-input').value = data.role;
            document.getElementById('kyc-rel-input').value = data.relationship;
            document.getElementById('kyc-notes-input').value = data.notes;

            // Update contact name
            const contact = window.conversations?.find(c => c.handle === handle);
            if (contact) {
                contact.name = data.name;
            }

            document.getElementById('active-contact-name').textContent = data.name || handle;
            document.getElementById('active-contact-name-chat').textContent = data.name || handle;

            closeProfileModal();
            alert('Profile saved successfully!');

            // Refresh contact list
            await window.loadConversations();
        } else {
            alert('Save failed: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Failed to save profile:', error);
        alert('Error: ' + error.message);
    }
}

// Export to window for onclick handlers
window.loadKYCData = loadKYCData;
window.saveKYCData = saveKYCData;
window.showProfileModal = showProfileModal;
window.closeProfileModal = closeProfileModal;
window.saveProfile = saveProfile;
