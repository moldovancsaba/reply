import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";

// How a message actually leaves this Mac: AppleScript drives the apps you already use (Messages, Mail, WhatsApp
// Desktop). The recipient and the text are passed to the script as arguments (`on run argv`), never spliced into its
// source, so nothing in a message can change what the script does.
const SCRIPTS = {
    imessage: [
        "on run argv",
        "set theHandle to item 1 of argv",
        "set theText to item 2 of argv",
        "tell application \"Messages\"",
        "try",
        "set theService to 1st service whose service type = iMessage",
        "send theText to buddy theHandle of theService",
        "on error",
        "set theService to 1st service whose service type = SMS",
        "send theText to buddy theHandle of theService",
        "end try",
        "end tell",
        "end run",
    ],
    email: [
        "on run argv",
        "set theAddress to item 1 of argv",
        "set theSubject to item 2 of argv",
        "set theText to item 3 of argv",
        "tell application \"Mail\"",
        "set theMessage to make new outgoing message with properties {subject:theSubject, content:theText, visible:false}",
        "tell theMessage to make new to recipient at end of to recipients with properties {address:theAddress}",
        "send theMessage",
        "end tell",
        "end run",
    ],
    // WhatsApp Desktop has no sending interface: open the chat with the text typed in, wait until the app is in front,
    // then press Return. That needs Accessibility permission, and is the least reliable of the three.
    whatsapp: [
        "on run argv",
        "set theUrl to item 1 of argv",
        "open location theUrl",
        "tell application \"System Events\"",
        "set ready to false",
        "repeat 20 times",
        "delay 0.5",
        "if exists process \"WhatsApp\" then",
        "if frontmost of process \"WhatsApp\" then",
        "set ready to true",
        "exit repeat",
        "end if",
        "end if",
        "end repeat",
        "if not ready then error \"WhatsApp did not come to the front\" number 9001",
        "delay 1",
        "if not (frontmost of process \"WhatsApp\") then error \"WhatsApp lost the focus\" number 9002",
        "keystroke return",
        "end tell",
        "end run",
    ],
};

export const scriptArgs = {
    imessage: ({ handle, text }) => [handle, text],
    email: ({ handle, subject, text }) => [handle, subject ?? "", text],
    whatsapp: ({ handle, text }) => [`whatsapp://send?phone=${handle.replace(/\D/g, "")}&text=${encodeURIComponent(text)}`],
};

export class SendError extends Error {
    constructor(code, message, { recovery, unknownOutcome = false } = {}) {
        super(message);
        this.code = code;
        this.recovery = recovery;
        this.unknownOutcome = unknownOutcome;
    }
}

const SETTINGS = (pane) => `x-apple.systempreferences:com.apple.preference.security?${pane}`;

// osascript's stderr -> a plain error code with what to do next.
export function classify(stderr, channel, timedOut = false) {
    const text = String(stderr ?? "");
    const app = { imessage: "Messages", email: "Mail", whatsapp: "WhatsApp" }[channel];
    if (timedOut) return new SendError("send_timeout", `${app} did not answer in time. The message may have been sent: check the conversation before sending again.`, { unknownOutcome: true });
    if (/-1743|not authori[sz]ed to send apple events/i.test(text)) {
        return new SendError("automation_denied", `{reply} is not allowed to control ${app}.`, { recovery: [
            { order: 1, text: "Open System Settings > Privacy & Security > Automation.", deepLink: SETTINGS("Privacy_Automation") },
            { order: 2, text: `Switch on ${app} under {reply}. If {reply} is not listed, use "Allow {reply} to send" in the app first.` },
        ] });
    }
    if (/-1719|not allowed to send keystrokes|assistive access|-25211|1002/i.test(text)) {
        return new SendError("accessibility_denied", "{reply} is not allowed to press keys in WhatsApp, which sending through WhatsApp needs.", { recovery: [
            { order: 1, text: "Open System Settings > Privacy & Security > Accessibility.", deepLink: SETTINGS("Privacy_Accessibility") },
            { order: 2, text: "Switch on {reply}, then try again." },
        ] });
    }
    if (/9002|lost the focus/i.test(text)) return new SendError("whatsapp_not_ready", "WhatsApp lost the focus before the message was sent. Nothing was sent. Leave WhatsApp in front and try again.");
    if (/9001|did not come to the front/i.test(text)) return new SendError("whatsapp_not_ready", "WhatsApp did not open the chat in time. Nothing was sent. Open WhatsApp, then try again.");
    if (/-1728|can.t get buddy|can.t get service|-1719/i.test(text)) return new SendError("recipient_not_found", `${app} could not find this recipient. Nothing was sent.`);
    if (/-600|isn.t running/i.test(text)) return new SendError("app_not_running", `${app} is not running and could not be opened. Nothing was sent.`);
    return new SendError("send_failed", `${app} refused the message. Nothing was sent.`);
}

export function createAppleScriptDrivers({ run = defaultRun } = {}) {
    const make = (channel) => async (msg) => {
        const r = await run(SCRIPTS[channel], scriptArgs[channel](msg));
        if (r.error) throw classify(r.stderr, channel, r.timedOut);
    };
    return { imessage: make("imessage"), email: make("email"), whatsapp: make("whatsapp") };
}

export function defaultRun(lines, args, timeoutMs = 45_000) {
    return new Promise((resolve) => {
        execFile("/usr/bin/osascript", [...lines.flatMap((l) => ["-e", l]), ...args], { timeout: timeoutMs, killSignal: "SIGKILL" }, (error, _out, stderr) => {
            resolve({ error, stderr, timedOut: Boolean(error?.killed) });
        });
    });
}

// Test-only: records what would have been sent in <home>/sent-fake.jsonl and succeeds. Selected with REPLY_CORE_SEND_DRIVER=fake.
export function createFakeDrivers(home) {
    const make = (channel) => async (msg) => { appendFileSync(path.join(home, "sent-fake.jsonl"), `${JSON.stringify({ channel, handle: msg.handle, subject: msg.subject, text: msg.text })}\n`); };
    return { imessage: make("imessage"), email: make("email"), whatsapp: make("whatsapp") };
}

export { SCRIPTS };
