const { execFile } = require("child_process");

function normalizeSendErrorMessage(rawMessage, fallbackMessage) {
  let text = String(rawMessage || "").trim();
  while (/^error:\s*/i.test(text)) {
    text = text.replace(/^error:\s*/i, "").trim();
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text) return text;
  return String(fallbackMessage || "Request failed.");
}

const errText = "WARN Reverse proxy headers are not trusted\ngateway.bind is loopback";
const cleanErrLines = errText.split("\n").filter(line => {
  const l = line.trim().toLowerCase();
  return l && !l.startsWith("warn") && !l.includes("gateway.bind") && !l.includes("trustedproxies");
});
const cleanErrText = cleanErrLines.length > 0 ? cleanErrLines[cleanErrLines.length - 1].trim() : "";

const shortErr = normalizeSendErrorMessage(
  cleanErrText || "Command failed: openclaw",
  "OpenClaw WhatsApp send failed."
);

console.log("Extracted error:", shortErr);
