import { useState } from "react";
import { Anchor } from "@sovereignsquad/gds";

// First tab stop on every page: jumps over the navigation to the content. Invisible until it has focus.
// The hiding technique (a 1-pixel clipped box) is the standard accessible one, not a design value.
const hidden = { position: "absolute", width: 1, height: 1, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;
const shown = {
  position: "fixed", top: 0, left: 0, zIndex: 1000, padding: "var(--gds-space-sm, 0.5rem)",
  background: "var(--gds-bg-card)", color: "var(--gds-text-primary)", border: "var(--gds-border-card)",
} as const;

export function SkipLink({ target = "main-content", label = "Skip to content" }: { target?: string; label?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <Anchor href={`#${target}`} style={focused ? shown : hidden} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onClick={(e) => { e.preventDefault(); document.getElementById(target)?.focus(); }}>
      {label}
    </Anchor>
  );
}
