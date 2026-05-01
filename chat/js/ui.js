/**
 * {reply} - Global UI Utilities
 * Standardized feedback for async operations and errors.
 */

import { applyIconFallback } from './icon-fallback.js';

export const UI = {
    _recentToastKeys: new Map(),
    /**
     * Show the global loading spinner
     */
    showLoading: () => {
        const spinner = document.getElementById('global-spinner');
        if (spinner) {
            spinner.classList.add('active');
        }
    },

    /**
     * Hide the global loading spinner
     */
    hideLoading: () => {
        const spinner = document.getElementById('global-spinner');
        if (spinner) {
            spinner.classList.remove('active');
        }
    },

    /**
     * Show a toast notification
     * @param {string} message - The message to display
     * @param {'success'|'error'|'warning'} type - The type of toast
     * @param {number} duration - Auto-dismiss duration in ms (default 4000)
     */
    showToast: (message, type = 'success', duration = 4000) => {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const normalized = String(message || '').trim().replace(/\s+/g, ' ');
        const key = `${type}:${normalized}`;
        const now = Date.now();
        const last = UI._recentToastKeys.get(key) || 0;
        if (now - last < 3500) return;
        UI._recentToastKeys.set(key, now);

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        // Icon mapping
        const icons = {
            success: 'check_circle',
            error: 'error',
            warning: 'warning'
        };

        toast.innerHTML = `
      <span class="material-symbols-outlined toast-icon">${icons[type] || 'info'}</span>
      <div class="toast-message"></div>
      <span class="material-symbols-outlined toast-close">close</span>
    `;
        const msgEl = toast.querySelector('.toast-message');
        if (msgEl) msgEl.textContent = message;
        applyIconFallback(toast);

        // Click to dismiss
        const dismiss = () => {
            toast.style.animation = 'toast-out 0.3s ease-in forwards';
            setTimeout(() => toast.remove(), 300);
        };

        const closeBtn = toast.querySelector('.toast-close');
        if (closeBtn) {
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                dismiss();
            };
        }
        toast.onclick = dismiss;

        container.appendChild(toast);

        if (type === 'error') {
            const activeErrors = Array.from(container.querySelectorAll('.toast-error'));
            if (activeErrors.length > 3) {
                activeErrors.slice(0, activeErrors.length - 3).forEach((node) => node.remove());
            }
        }

        // Auto-dismiss for non-error toasts
        if (type !== 'error' && duration > 0) {
            setTimeout(dismiss, duration);
        }
    }
};

// Make accessible on window for non-module scripts
window.ReplyUI = UI;
