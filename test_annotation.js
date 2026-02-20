const { addDocuments, annotateDocument, getGoldenExamples } = require("./chat/vector-store.js");
(async () => {
    try {
        console.log("Seeding mock document...");
        await addDocuments([{
            id: "urn:li:message:test1",
            text: "This is a test message to be annotated",
            source: "linkedin",
            path: "linkedin://handle"
        }]);

        console.log("Annotating mock document...");
        await annotateDocument("urn:li:message:test1", true);

        console.log("Retrieving goldens...");
        const goldens = await getGoldenExamples(5);
        console.log("Golden Examples:", goldens);

    } catch (e) {
        console.error(e);
    }
})();
