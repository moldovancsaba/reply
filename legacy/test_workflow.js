const { getPendingSuggestions, getGoldenExamples } = require("./chat/vector-store.js");
(async () => {
  try {
    const pendings = await getPendingSuggestions(10);
    const goldens = await getGoldenExamples(10);
    console.log("Pendings:", pendings.length);
    console.log("Goldens:", goldens.length);
  } catch (e) {
    console.error(e);
  }
})();
