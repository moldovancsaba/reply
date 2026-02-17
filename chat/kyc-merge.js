const contactStore = require("./contact-store.js");

async function mergeProfile(profile) {
  if (!profile || !profile.handle) return null;

  // Do not modify displayName/profession/relationship. Only add actionable suggestions.
  const types = ["links", "emails", "phones", "addresses", "hashtags", "notes"];
  for (const type of types) {
    if (profile[type] && Array.isArray(profile[type])) {
      for (const content of profile[type]) {
        if (content && typeof content === "string" && content.length > 2) {
          contactStore.addSuggestion(profile.handle, type, content);
        }
      }
    }
  }

  if (profile.meta && typeof profile.meta === "object") {
    contactStore.updateContact(profile.handle, { kycAnalysis: profile.meta });
  }

  return contactStore.findContact(profile.handle);
}

module.exports = { mergeProfile };

