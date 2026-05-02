const SVG_NS = 'http://www.w3.org/2000/svg';
const SPRITE_HREF = '/public/icons/material-sprite.svg';

const ICON_ALIASES = new Map([
  ['check_circle', 'check-circle'],
  ['star_border', 'star-border'],
  ['auto_awesome', 'auto-awesome'],
  ['lightbulb', 'lightbulb'],
  ['left_panel_open', 'panel-left-open'],
  ['left_panel_close', 'panel-left-close'],
  ['right_panel_open', 'panel-right-open'],
  ['right_panel_close', 'panel-right-close'],
  ['dashboard', 'dashboard'],
  ['settings', 'settings'],
  ['contrast', 'contrast'],
  ['school', 'school'],
  ['person', 'person'],
  ['mic', 'mic'],
  ['radio_button_checked', 'radio-button-checked'],
  ['collapse_content', 'collapse-content'],
  ['analytics', 'analytics'],
  ['merge', 'merge'],
  ['more_horiz', 'more-horiz'],
  ['save', 'save'],
  ['archive', 'archive'],
  ['delete', 'delete'],
  ['block', 'block'],
  ['inventory', 'inventory'],
  ['error', 'error'],
  ['warning', 'warning'],
  ['info', 'info'],
  ['close', 'close'],
  ['attachment', 'attachment'],
  ['star', 'star'],
  ['refresh', 'refresh'],
  ['arrow_back', 'arrow-back'],
]);

function normalizeIconName(raw) {
  const candidate = String(raw || '').trim();
  if (!candidate) return '';
  const alias = ICON_ALIASES.get(candidate);
  if (alias) return alias;
  return candidate.replace(/_/g, '-').toLowerCase();
}

function createSvgIcon(iconName) {
  const normalized = normalizeIconName(iconName);
  if (!normalized) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('reply-inline-icon');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `${SPRITE_HREF}#${normalized}`);
  use.setAttribute('href', `${SPRITE_HREF}#${normalized}`);
  svg.appendChild(use);
  return svg;
}

function shouldDecorateNode(node) {
  return node instanceof HTMLElement;
}

function resolveTargetNodes(root) {
  const seen = new Set();
  const nodes = [];
  const maybePush = (node) => {
    if (!shouldDecorateNode(node) || seen.has(node)) return;
    seen.add(node);
    nodes.push(node);
  };

  maybePush(root);
  if (root && typeof root.querySelectorAll === 'function') {
    root.querySelectorAll('.material-symbols-outlined, .reply-shell-icon, [data-icon]').forEach(maybePush);
  }
  return nodes;
}

function mountIcon(node, iconName) {
  const normalized = normalizeIconName(iconName);
  if (!normalized || !(node instanceof HTMLElement)) return false;
  const svg = createSvgIcon(normalized);
  if (!svg) return false;

  const label = node.dataset.iconLabel || '';
  node.textContent = '';
  node.appendChild(svg);
  node.dataset.iconName = normalized;
  if (label) node.setAttribute('aria-label', label);
  return true;
}

export function setMaterialIcon(node, iconName, options = {}) {
  if (!(node instanceof HTMLElement)) return false;
  if (options.label != null) {
    node.dataset.iconLabel = String(options.label);
  }
  if (options.tooltip != null) {
    node.dataset.tooltip = String(options.tooltip);
  }
  node.dataset.icon = normalizeIconName(iconName);
  return mountIcon(node, iconName);
}

export function applyIconFallback(root = document) {
  resolveTargetNodes(root).forEach((node) => {
    const iconName = node.dataset.icon || node.dataset.iconName || node.textContent;
    mountIcon(node, iconName);
  });
}

export { createSvgIcon };
