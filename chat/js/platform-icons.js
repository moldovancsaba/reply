const PLATFORM_ICONS = {
  youtube: '/public/youtube.svg',
  linkedin: '/public/linkedin.svg',
  whatsapp: '/public/whatsapp.svg',
  imessage: '/public/imessage.svg',
  telegram: '/public/telegram.svg',
  discord: '/public/discord.svg',
  signal: '/public/signal.svg',
  snapchat: '/public/snapchat.svg',
  viber: '/public/viber.svg',
  messenger: '/public/messenger.svg',
  facebook: '/public/facebook.svg',
  mail: '/public/mail.svg',
  map: '/public/map.svg',
  text: '/public/text.svg',
  mobile: '/public/mobile.svg',
  landline: '/public/landline.svg',
  url: '/public/url.svg',
  context: '/public/context.svg',
};

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"'`]+)\b/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const MENTION_RE = /@[a-zA-Z0-9._-]{2,}/g;

function normalizeUrlLike(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^www\./i.test(v)) return `https://${v}`;
  return v;
}

function hostFromValue(value) {
  const candidate = normalizeUrlLike(value);
  if (!/^https?:\/\//i.test(candidate)) return '';
  try {
    return new URL(candidate).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

export function isLikelyPhone(value) {
  const digits = digitsOnly(value);
  return digits.length >= 7;
}

function platformFromHost(host) {
  if (!host) return '';
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'youtube';
  if (host.endsWith('linkedin.com') || host === 'lnkd.in') return 'linkedin';
  if (host === 'wa.me' || host.endsWith('whatsapp.com') || host.endsWith('s.whatsapp.net')) return 'whatsapp';
  if (host === 't.me' || host.endsWith('telegram.me') || host.endsWith('telegram.org')) return 'telegram';
  if (host.endsWith('discord.com') || host.endsWith('discord.gg')) return 'discord';
  if (host.endsWith('signal.me') || host.endsWith('signal.group')) return 'signal';
  if (host.endsWith('snapchat.com')) return 'snapchat';
  if (host.endsWith('viber.com')) return 'viber';
  if (host === 'm.me' || host.endsWith('messenger.com')) return 'messenger';
  if (host.endsWith('facebook.com') || host.endsWith('fb.com')) return 'facebook';
  if (host.endsWith('google.com') || host.endsWith('openstreetmap.org') || host.endsWith('maps.apple.com')) return 'map';
  return 'url';
}

function platformFromChannelHint(channelHint) {
  const raw = String(channelHint || '').toLowerCase();
  if (!raw) return '';
  if (raw.includes('youtube')) return 'youtube';
  if (raw.includes('linkedin')) return 'linkedin';
  if (raw.includes('whatsapp')) return 'whatsapp';
  if (raw.includes('telegram')) return 'telegram';
  if (raw.includes('discord')) return 'discord';
  if (raw.includes('signal')) return 'signal';
  if (raw.includes('snapchat')) return 'snapchat';
  if (raw.includes('viber')) return 'viber';
  if (raw.includes('messenger')) return 'messenger';
  if (raw.includes('facebook')) return 'facebook';
  if (raw.includes('map') || raw.includes('address')) return 'map';
  if (raw.includes('imessage')) return 'imessage';
  if (raw.includes('mail') || raw.includes('email') || raw.includes('gmail') || raw.includes('imap')) return 'mail';
  if (raw.includes('sms') || raw.includes('text')) return 'text';
  if (raw.includes('phone') || raw.includes('mobile')) return 'mobile';
  if (raw.includes('landline')) return 'landline';
  if (raw.includes('link') || raw.includes('url')) return 'url';
  return '';
}

function inferMentionPlatform(text, channelHint = '') {
  const hinted = platformFromChannelHint(channelHint);
  if (hinted) return hinted;

  const raw = String(text || '').toLowerCase();
  if (!raw) return '';
  if (raw.includes('linkedin')) return 'linkedin';
  if (raw.includes('telegram')) return 'telegram';
  if (raw.includes('discord')) return 'discord';
  if (raw.includes('snapchat')) return 'snapchat';
  if (raw.includes('messenger')) return 'messenger';
  if (raw.includes('facebook')) return 'facebook';
  if (raw.includes('youtube')) return 'youtube';
  return '';
}

function hrefForMention(mentionToken, platform) {
  const handle = String(mentionToken || '').replace(/^@+/, '').trim();
  if (!handle) return '';
  if (platform === 'telegram') return `https://t.me/${handle}`;
  if (platform === 'linkedin') return `https://www.linkedin.com/in/${handle}`;
  if (platform === 'snapchat') return `https://www.snapchat.com/add/${handle}`;
  if (platform === 'messenger') return `https://m.me/${handle}`;
  if (platform === 'facebook') return `https://www.facebook.com/${handle}`;
  if (platform === 'youtube') return `https://www.youtube.com/@${handle}`;
  return '';
}

function normalizeHref(value, platform) {
  const v = String(value || '').trim();
  if (!v) return '';

  if (/^(https?:|mailto:|tel:|sms:|imessage:)/i.test(v)) return v;
  if (/^www\./i.test(v)) return `https://${v}`;
  if (EMAIL_RE.test(v)) return `mailto:${v}`;

  if (platform === 'whatsapp' && isLikelyPhone(v)) {
    return `https://wa.me/${digitsOnly(v)}`;
  }

  if (platform === 'telegram' && /^@[a-z0-9_]{3,}$/i.test(v)) {
    return `https://t.me/${v.slice(1)}`;
  }

  if (platform === 'imessage' && (isLikelyPhone(v) || EMAIL_RE.test(v))) {
    return `imessage://${encodeURIComponent(v)}`;
  }

  if (platform === 'text' && isLikelyPhone(v)) {
    return `sms:${digitsOnly(v)}`;
  }

  if ((platform === 'mobile' || platform === 'landline') && isLikelyPhone(v)) {
    return `tel:${v}`;
  }

  if (/^https?:\/\//i.test(v)) return v;
  return '';
}

export function resolvePlatformTarget(value, options = {}) {
  const raw = String(value || '').trim();
  const channelHint = options.channelHint || '';
  const platformHint = platformFromChannelHint(channelHint);

  if (!raw) {
    return {
      platform: platformHint || 'context',
      icon: PLATFORM_ICONS[platformHint] || PLATFORM_ICONS.context,
      href: '',
    };
  }

  const lower = raw.toLowerCase();
  const host = hostFromValue(raw);
  let platform = platformFromHost(host);

  if (!host) {
    if (/^imessage:/i.test(raw)) platform = 'imessage';
    else if (/^(mailto:)/i.test(raw) || EMAIL_RE.test(raw)) platform = 'mail';
    else if (/^sms:/i.test(raw)) platform = 'text';
    else if (lower.includes('@lid') || lower.includes('@s.whatsapp.net')) platform = 'whatsapp';
    else if (isLikelyPhone(raw)) platform = 'mobile';
    else platform = platformHint || 'context';
  }

  if (!platform || platform === 'url') {
    if (platformHint) platform = platformHint;
  }

  const href = normalizeHref(raw, platform);
  return {
    platform: platform || 'context',
    icon: PLATFORM_ICONS[platform || 'context'] || PLATFORM_ICONS.context,
    href,
  };
}

export function createPlatformIcon(platform, alt = '') {
  const img = document.createElement('img');
  const key = PLATFORM_ICONS[platform] ? platform : 'context';
  img.className = 'platform-icon';
  img.src = PLATFORM_ICONS[key];
  img.alt = alt || key;
  img.loading = 'lazy';
  img.decoding = 'async';
  return img;
}

export function createPlatformValueNode(value, options = {}) {
  const raw = String(value || '').trim();
  const {
    channelHint = '',
    showText = true,
    showIcon = true,
    showFallbackIcon = true,
    className = '',
  } = options;
  const target = resolvePlatformTarget(raw, { channelHint });

  const hasLink = !!target.href;
  const node = document.createElement(hasLink ? 'a' : 'span');
  node.className = `platform-value ${className}`.trim();
  if (hasLink) {
    node.href = target.href;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
  }

  const shouldShowIcon = showIcon && (showFallbackIcon || target.platform !== 'context');
  if (shouldShowIcon) {
    const icon = createPlatformIcon(target.platform, target.platform);
    icon.classList.add('platform-icon--sm');
    node.appendChild(icon);
  }

  if (showText) {
    const label = document.createElement('span');
    label.textContent = raw;
    node.appendChild(label);
  }

  if (!showText && !shouldShowIcon) {
    node.textContent = raw;
  }

  return node;
}

export function appendLinkedText(container, text, options = {}) {
  const raw = String(text || '');
  if (!raw) return;

  const channelHint = options.channelHint || '';
  const tokens = [];

  for (const match of raw.matchAll(URL_RE)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    tokens.push({ type: 'url', start: index, end: index + match[0].length, value: match[0] });
  }

  MENTION_RE.lastIndex = 0;
  for (const match of raw.matchAll(MENTION_RE)) {
    const token = match[0];
    const start = match.index ?? -1;
    if (start < 0) continue;
    const end = start + token.length;
    const prev = start > 0 ? raw[start - 1] : '';
    if (/[A-Za-z0-9._%+-]/.test(prev)) continue; // likely email/user part
    if (tokens.some((t) => start < t.end && end > t.start)) continue; // overlap with URL
    tokens.push({ type: 'mention', start, end, value: token });
  }

  tokens.sort((a, b) => a.start - b.start);
  if (tokens.length === 0) {
    container.textContent = raw;
    return;
  }

  let cursor = 0;
  for (const token of tokens) {
    if (token.start > cursor) {
      container.appendChild(document.createTextNode(raw.slice(cursor, token.start)));
    }

    if (token.type === 'url') {
      const node = createPlatformValueNode(token.value, {
        channelHint,
        showText: true,
        showIcon: true,
        showFallbackIcon: false,
        className: 'platform-link inline-platform-link',
      });
      if (node.tagName.toLowerCase() !== 'a') {
        node.classList.remove('platform-link');
        node.classList.remove('inline-platform-link');
      }
      container.appendChild(node);
      cursor = token.end;
      continue;
    }

    const contextWindow = raw.slice(Math.max(0, token.start - 32), Math.min(raw.length, token.end + 32));
    const mentionPlatform = inferMentionPlatform(contextWindow, channelHint);
    const mentionHref = hrefForMention(token.value, mentionPlatform);
    if (mentionHref) {
      const node = document.createElement('a');
      node.className = 'platform-value platform-link inline-platform-link';
      node.href = mentionHref;
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
      const icon = createPlatformIcon(mentionPlatform, mentionPlatform);
      icon.classList.add('platform-icon--sm');
      node.appendChild(icon);
      const label = document.createElement('span');
      label.textContent = token.value;
      node.appendChild(label);
      container.appendChild(node);
    } else {
      container.appendChild(document.createTextNode(token.value));
    }
    cursor = token.end;
  }

  if (cursor < raw.length) {
    container.appendChild(document.createTextNode(raw.slice(cursor)));
  }
}
