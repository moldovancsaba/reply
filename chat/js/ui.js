/**
 * {reply} - Global UI Utilities
 * Standardized feedback for async operations and errors.
 */

import { applyIconFallback, setMaterialIcon } from './icon-fallback.js';

export const UI = {
    _recentToastKeys: new Map(),
    _themeMediaQuery: null,
    _themeListener: null,
    _tooltipTimer: null,
    _tooltipNode: null,
    _tooltipTarget: null,
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
    },

    getThemePreference: () => {
        try {
            return window.localStorage?.getItem('reply.theme') || 'auto';
        } catch {
            return 'auto';
        }
    },

    effectiveTheme: (preference) => {
        if (preference === 'day' || preference === 'night') return preference;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
    },

    applyThemePreference: (preference = UI.getThemePreference()) => {
        const next = UI.effectiveTheme(preference);
        document.documentElement.dataset.theme = next;
        document.documentElement.style.colorScheme = next === 'night' ? 'dark' : 'light';
        return next;
    },

    updateThemeButtonState: () => {
        const preference = UI.getThemePreference();
        const title = preference === 'auto' ? 'Theme: Auto' : preference === 'day' ? 'Theme: Light' : 'Theme: Dark';
        ['btn-theme', 'btn-theme-settings', 'btn-hidden-theme'].forEach((id) => {
            const node = document.getElementById(id);
            if (!node) return;
            const iconHost = node.querySelector('.reply-shell-icon') || node;
            setMaterialIcon(iconHost, 'contrast', { label: title, tooltip: title });
            node.setAttribute('aria-label', title);
            node.dataset.tooltip = title;
        });
    },

    cycleTheme: () => {
        const current = UI.getThemePreference();
        const next = current === 'auto' ? 'day' : current === 'day' ? 'night' : 'auto';
        try {
            window.localStorage?.setItem('reply.theme', next);
        } catch {
            /* ignore */
        }
        UI.applyThemePreference(next);
        UI.updateThemeButtonState();
    },

    initThemeControls: () => {
        if (UI._themeMediaQuery == null) {
            UI._themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        }
        if (UI._themeListener == null) {
            UI._themeListener = () => {
                if (UI.getThemePreference() === 'auto') {
                    UI.applyThemePreference('auto');
                    UI.updateThemeButtonState();
                }
            };
            UI._themeMediaQuery.addEventListener('change', UI._themeListener);
        }

        UI.applyThemePreference();
        UI.updateThemeButtonState();
        UI.initTooltips();

        ['btn-theme', 'btn-theme-settings', 'btn-hidden-theme'].forEach((id) => {
            const node = document.getElementById(id);
            if (!node || node.dataset.themeBound === '1') return;
            node.dataset.themeBound = '1';
            node.addEventListener('click', UI.cycleTheme);
        });
    },

    initTooltips: () => {
        if (document.body?.dataset.replyTooltipsBound === '1') return;
        if (!document.body) return;
        document.body.dataset.replyTooltipsBound = '1';

        document.addEventListener('pointerover', (event) => {
            const target = event.target instanceof Element ? event.target.closest('[data-tooltip]') : null;
            if (!target) return;
            UI.scheduleTooltip(target);
        });

        document.addEventListener('pointerout', (event) => {
            const target = event.target instanceof Element ? event.target.closest('[data-tooltip]') : null;
            const related = event.relatedTarget instanceof Element ? event.relatedTarget.closest('[data-tooltip]') : null;
            if (target && related === target) return;
            if (target) UI.hideTooltip(target);
        });

        document.addEventListener('focusin', (event) => {
            const target = event.target instanceof Element ? event.target.closest('[data-tooltip]') : null;
            if (target) UI.scheduleTooltip(target);
        });

        document.addEventListener('focusout', () => UI.hideTooltip());
        document.addEventListener('pointerdown', () => UI.hideTooltip());
        document.addEventListener('keydown', () => UI.hideTooltip());
        window.addEventListener('scroll', () => UI.hideTooltip(), true);
        window.addEventListener('resize', () => UI.hideTooltip());
    },

    scheduleTooltip: (target) => {
        UI.hideTooltip();
        const content = String(target?.getAttribute('data-tooltip') || '').trim();
        if (!target || !content) return;
        UI._tooltipTarget = target;
        UI._tooltipTimer = window.setTimeout(() => {
            if (UI._tooltipTarget !== target) return;
            UI.showTooltip(target, content);
        }, 1000);
    },

    showTooltip: (target, content) => {
        if (!target || !content) return;
        let tooltip = UI._tooltipNode;
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'reply-tooltip';
            tooltip.setAttribute('role', 'tooltip');
            document.body.appendChild(tooltip);
            UI._tooltipNode = tooltip;
        }
        tooltip.textContent = content;
        tooltip.classList.add('is-visible');
        const rect = target.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const top = Math.max(12, rect.bottom + 12);
        const centeredLeft = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
        const left = Math.min(window.innerWidth - tooltipRect.width - 12, Math.max(12, centeredLeft));
        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
    },

    hideTooltip: (target = null) => {
        if (target && UI._tooltipTarget && target !== UI._tooltipTarget) return;
        if (UI._tooltipTimer) {
            window.clearTimeout(UI._tooltipTimer);
            UI._tooltipTimer = null;
        }
        UI._tooltipTarget = null;
        if (UI._tooltipNode) {
            UI._tooltipNode.classList.remove('is-visible');
        }
    },
};

// Make accessible on window for non-module scripts
window.ReplyUI = UI;
