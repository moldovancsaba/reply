import type { ReactNode } from "react";
import { GdsDialog, GdsInline, GdsStack, SemanticButton } from "@sovereignsquad/gds";

// GDS ConfirmDialog renders an unnamed close button (axe: button-name, critical) and cannot relabel its confirm button,
// so this is the governed GdsDialog with the same two-button layout. Replace with ConfirmDialog when GDS fixes it.
export function ConfirmPanel({ id, opened, title, confirmLabel, loading, onConfirm, onClose, children }: {
  id: string; opened: boolean; title: string; confirmLabel: string; loading: boolean; onConfirm: () => void; onClose: () => void; children: ReactNode;
}) {
  return (
    <GdsDialog id={id} opened={opened} onClose={onClose} title={title} centered closeButtonProps={{ "aria-label": "Close" }}>
      <GdsStack gap="lg">
        {children}
        <GdsInline justify="end" gap="sm">
          <SemanticButton action="cancel" variant="default" disabled={loading} onClick={onClose} />
          <SemanticButton action="confirm" label={confirmLabel} loading={loading} disabled={loading} onClick={onConfirm} />
        </GdsInline>
      </GdsStack>
    </GdsDialog>
  );
}
