import { buildSecurityHeaders } from './api.js';

function setDisplay(id, value) {
    const el = document.getElementById(id);
    if (el) el.style.display = value;
}

export function openTrainingPage() {
    setDisplay('dashboard', 'none');
    setDisplay('messages', 'none');
    setDisplay('settings-page', 'none');
    setDisplay('training-page', 'flex');
    const chatHeader = document.querySelector('.chat-header');
    const inputArea = document.querySelector('.input-area');
    if (chatHeader) chatHeader.style.display = 'none';
    if (inputArea) inputArea.style.display = 'none';

    loadTrainingData();
}

export function closeTrainingPage() {
    setDisplay('training-page', 'none');
    const header = document.querySelector('.chat-header');
    const inputArea = document.querySelector('.input-area');
    if (header) header.style.display = 'flex';
    if (inputArea) inputArea.style.display = 'flex';
    if (window.currentHandle) {
        setDisplay('messages', 'flex');
    } else {
        setDisplay('dashboard', 'grid');
    }
}

async function loadTrainingData() {
    const container = document.getElementById('training-list-container');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center; padding: 20px;">Loading examples...</div>';
    try {
        const res = await fetch('/api/training/annotations', {
            headers: buildSecurityHeaders({ includeJsonContentType: false }),
        });
        const raw = await res.text();
        let data = {};
        if (raw) {
            try {
                data = JSON.parse(raw);
            } catch {
                throw new Error(raw.slice(0, 120) || `HTTP ${res.status}`);
            }
        }
        if (!res.ok) {
            const msg = [data.error, data.message].map((v) => String(v || '').trim()).filter(Boolean).join(' ');
            throw new Error(msg || `HTTP ${res.status}`);
        }
        renderTrainingData(data.annotations || [], data.pending || []);
    } catch (e) {
        container.innerHTML = `<div style="color:var(--danger); text-align:center; padding: 20px;">Error loading data: ${escapeHtml(e.message)}</div>`;
    }
}

function renderTrainingData(annotations, pending) {
    const container = document.getElementById('training-list-container');
    if (!container) return;
    container.innerHTML = '';

    // Render Pending
    if (pending.length > 0) {
        const pSection = document.createElement('div');
        pSection.innerHTML = `<h3 class="training-section-header">Pending Suggestions to Review</h3>`;
        container.appendChild(pSection);

        pending.forEach(item => {
            const div = document.createElement('div');
            div.className = 'training-item';
            const safeText = escapeHtml(item.text);
            div.innerHTML = `
                <div class="training-meta">Generated: ${item.date}</div>
                <div class="edit-area mb-sm">
                    <textarea class="training-textarea">${safeText}</textarea>
                </div>
                <div class="flex gap-md items-center">
                    <button class="btn btn-primary btn-sm accept-btn">Accept (Save as Golden)</button>
                    <button class="btn btn-secondary btn-sm decline-btn btn-danger-outline">Decline (Discard)</button>
                    <span class="text-sm text-secondary">(Edit text before accepting to Refine it)</span>
                </div>
            `;
            const textarea = div.querySelector('textarea');
            div.querySelector('.accept-btn').onclick = () => acceptSuggestion(item.id, textarea.value);
            div.querySelector('.decline-btn').onclick = () => deleteAnnotation(item.id);
            container.appendChild(div);
        });
    }

    // Render Goldens
    const gSection = document.createElement('div');
    gSection.innerHTML = `<h3 class="training-section-header">Active Golden Examples (${annotations.length})</h3>`;
    container.appendChild(gSection);

    if (annotations.length === 0 && pending.length === 0) {
        gSection.innerHTML += '<div style="padding: 20px; text-align:center; color: var(--text-secondary);">No examples found. Star a message in the chat or use the suggest feature!</div>';
        return;
    }

    annotations.forEach(item => {
        const div = document.createElement('div');
        div.className = 'training-item';
        div.innerHTML = `
            <div class="training-meta">${item.date} • ${item.source || 'manual'}</div>
            <div class="training-content">${escapeHtml(item.text)}</div>
            <button class="btn btn-secondary btn-sm remove-btn">Remove Golden Status</button>
        `;
        div.querySelector('.remove-btn').onclick = () => updateAnnotation(item.id, false);
        container.appendChild(div);
    });
}

function escapeHtml(unsafe) {
    return (unsafe || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function acceptSuggestion(id, newText) {
    try {
        // If they edited it, we actually need to update Native lanceDB text. 
        // We will just create a new record and delete the old one to avoid heavy schema updates.
        await fetch('/api/training/annotations', {
            method: 'DELETE',
            headers: buildSecurityHeaders(),
            body: JSON.stringify({ id })
        });

        // Push the refined text as a brand new synthetic golden
        await fetch('/api/messages/annotate', {
            method: 'POST',
            headers: buildSecurityHeaders(),
            body: JSON.stringify({ id: `urn:reply:synthetic:${Date.now()}`, text: `[Refined] Me: ${newText}`, is_annotated: true })
        });

        loadTrainingData();
    } catch (e) {
        alert('Failed to accept: ' + e.message);
    }
}

async function updateAnnotation(id, isAnnotated) {
    try {
        await fetch('/api/messages/annotate', {
            method: 'POST',
            headers: buildSecurityHeaders(),
            body: JSON.stringify({ id, is_annotated: isAnnotated })
        });
        loadTrainingData();
    } catch (e) {
        alert('Failed to update: ' + e.message);
    }
}

async function deleteAnnotation(id) {
    try {
        await fetch('/api/training/annotations', {
            method: 'DELETE',
            headers: buildSecurityHeaders(),
            body: JSON.stringify({ id })
        });
        loadTrainingData();
    } catch (e) {
        alert('Failed to delete: ' + e.message);
    }
}
