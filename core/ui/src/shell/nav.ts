export type NavDestination = { path: string; label: string; icon: "Inbox" | "Search" | "Settings"; match: (pathname: string) => boolean };

export const DESTINATIONS: NavDestination[] = [
  { path: "/inbox", label: "Inbox", icon: "Inbox", match: (p) => p === "/inbox" || p.startsWith("/inbox/") },
  { path: "/search", label: "Search", icon: "Search", match: (p) => p === "/search" },
  { path: "/sources", label: "Sources", icon: "Settings", match: (p) => p === "/sources" },
];
