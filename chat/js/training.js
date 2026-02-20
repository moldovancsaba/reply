import { buildSecurityHeaders } from './api.js';

export function openTrainingPage() {
    document.getElementById('dashboard').style.display = 'none';
    if (document.getElementById('messages')) document.getElementById('messages').style.display = 'none';
    document.getElementById('settings-page').style.display = 'none';
    document.getElementById('training-page').style.display = 'flex';
    document.querySelector('.chat-header').style.display = 'none';
    document.querySelector('.input-area').style.display = 'none';

    loadTrainingData();
}

export function closeTrainingPage() {
    document.getElementById('training-page').style.display = 'none';
    document.querySelector('.chat-header').style.display = 'flex';
    document.querySelector('.input-area').style.display = 'flex';
    if (window.currentHandle) {
        document.getElementById('messages').style.display = 'flex';
    } else {
        document.getElementById('dashboard').style.display = 'flex';
    }
}

async function loadTrainingData() {
    const container = document.getElementById('training-list-container');
    container.innerHTML = '<div style="text-align:center; padding: 20px;">Loading examples...</div>';
    try {
        const res = await fetch('/api/training/annotations', { headers: buildSecurityHeaders() });
        const data = await res.json();
        renderTrainingData(data.annotations || [], data.pending || []);
    } catch (e) {
        container.innerHTML = `<div style="color:red; text-align:center; padding: 20px;">Error loading data: ${e.message}</div>`;
    }
}

function renderTrainingData(annotations, pending) {
    const container = document.getElementById('training-list-container');
    container.innerHTML = '';

    // Render Pending
    if (pending.length > 0) {
        const pSection = document.createElement('div');
        pSection.innerHTML = `<h3 style="padding: 10px 20px; margin: 0; background: var(--bg-hover); border-bottom: 1px solid var(--border);">Pending Suggestions to Review</h3>`;
        container.appendChild(pSection);

        pending.forEach(item => {
            const div = document.createElement('div');
            div.style.cssText = 'padding: 15px 20px; border-bottom: 1px solid var(--border);';
            const safeText = escapeHtml(item.text);
            div.innerHTML = `
                <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 5px;">Generated: ${item.date}</div>
                <div class="edit-area" style="margin-bottom: 10px;">
                    <textarea class="training-textarea" style="width:100%; min-height:80px; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary); font-family:inherit;">${safeText}</textarea>
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <button class="btn btn-primary btn-sm accept-btn">Accept (Save as Golden)</button>
                    <button class="btn btn-secondary btn-sm decline-btn" style="color: #d9534f; border-color: #d9534f;">Decline (Discard)</button>
                    <span style="font-size:0.8rem; color:var(--text-secondary);">(Edit text before accepting to Refine it)</span>
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
    gSection.innerHTML = `<h3 style="padding: 10px 20px; margin: 0; background: var(--bg-hover); border-bottom: 1px solid var(--border);">Active Golden Examples (${annotations.length})</h3>`;
    container.appendChild(gSection);

    if (annotations.length === 0 && pending.length === 0) {
        gSection.innerHTML += '<div style="padding: 20px; text-align:center; color: var(--text-secondary);">No examples found. Star a message in the chat or use the suggest feature!</div>';
        return;
    }

    annotations.forEach(item => {
        const div = document.createElement('div');
        div.style.cssText = 'padding: 15px 20px; border-bottom: 1px solid var(--border);';
        div.innerHTML = `
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 5px;">${item.date} • ${item.source || 'manual'}</div>
            <div style="font-size: 0.95rem; margin-bottom: 10px; white-space: pre-wrap; padding: 10px; background: var(--bg-hover); border-radius: 6px;">${escapeHtml(item.text)}</div>
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
