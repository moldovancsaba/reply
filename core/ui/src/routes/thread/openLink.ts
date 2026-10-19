// Opens a handoff link the way a click would (the caller is inside a click handler, so it counts as a user gesture):
// a temporary anchor, noopener. Web links go to a new tab; sms: and mailto: hand over to the app without leaving the page.
export function openFromGesture(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener noreferrer";
  if (/^https?:/i.test(url)) a.target = "_blank";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
