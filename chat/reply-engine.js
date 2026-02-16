/**
 * Reply engine — keyword-based suggestions (mirrors ReplyEngine.swift for POC).
 * Used by the localhost chat to generate reply suggestions.
 */

const RULES = {
  hello: "Hi there! How can I help you?",
  hi: "Hello! What's up?",
  "how are you": "I'm doing well, thanks for asking!",
  thanks: "You're welcome!",
  bye: "Goodbye! Have a great day!",
  yes: "Great!",
  no: "Okay, noted.",
  what: "I'm not sure, can you clarify?",
  when: "Let me check the schedule.",
  where: "Location details coming soon.",
};

function generateReply(message) {
  if (!message || typeof message !== "string") {
    return "Thanks for your message. I'll get back to you soon.";
  }
  const lower = message.toLowerCase();
  for (const [key, reply] of Object.entries(RULES)) {
    if (lower.includes(key)) {
      return reply;
    }
  }
  return "Thanks for your message. I'll get back to you soon.";
}

module.exports = { generateReply };
