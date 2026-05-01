const ICON_MAP = {
  left_panel_close: "◨",
  left_panel_open: "◧",
  right_panel_open: "▣",
  flip_camera_android: "◫",
  settings: "⚙",
  model_training: "🧠",
  tune: "☷",
  mail: "✉",
  chat_bubble: "💬",
  cyclone: "↻",
  monitor_heart: "◉",
  lock: "🔒",
  auto_awesome: "✨",
  palette: "🎨",
  alternate_email: "✉",
  dns: "☰",
  stacked_email: "✉",
  bridge: "⟷",
  speed: "⏱",
  healing: "🩺",
  restart_alt: "↻",
  smart_toy: "🤖",
  verified_user: "🛡",
  vpn_key: "🔑",
  check_circle: "✓",
  error: "⚠",
  warning: "⚠",
  close: "✕",
  info: "i",
  attachment: "📎",
  star: "★",
  star_border: "☆",
};

export function applyIconFallback(root = document) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll(".material-symbols-outlined").forEach((node) => {
    const key = String(node.dataset.iconName || node.textContent || "").trim();
    const fallback = ICON_MAP[key];
    if (!fallback) return;
    node.dataset.iconName = key;
    node.textContent = fallback;
    node.classList.add("reply-local-icon");
    if (!node.getAttribute("aria-hidden")) node.setAttribute("aria-hidden", "true");
  });
}

