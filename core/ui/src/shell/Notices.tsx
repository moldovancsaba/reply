import { GdsStack, InlineAlert, SemanticButton, useGdsNotifications } from "@sovereignsquad/gds";

// GDS keeps notifications in a provider but only ships a full "Notifications" panel; the app shows the active ones as
// GDS inline alerts above the page content (success = polite status, error = alert), each with its actions and a Dismiss.
export function Notices() {
  const { notifications, dismissNotification, runAction } = useGdsNotifications();
  const visible = notifications.filter((n) => !n.announcementOnly && n.persistence !== "announcement-only");
  if (visible.length === 0) return null;
  return (
    <GdsStack gap="sm">
      {visible.map((n) => (
        <InlineAlert
          key={n.id}
          severity={n.severity}
          title={n.title}
          message={n.message}
          action={
            <>
              {(n.actions ?? []).map((a) => <SemanticButton key={a.id} action="reset" label={a.label} disabled={a.disabled} onClick={() => runAction(n.id, a.id)} />)}
              <SemanticButton action="close" label="Dismiss" onClick={() => dismissNotification(n.id)} />
            </>
          }
        />
      ))}
    </GdsStack>
  );
}
