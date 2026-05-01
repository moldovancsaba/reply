const { pipeline } = require("@xenova/transformers");

async function run() {
    console.log("Loading pipeline...");
    const pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

    const text1 = "dog";
    const text2 = "The dog barks loudly at the mailman.";
    const text3 = "The cat meows softly on the sofa.";

    console.log(`Generating embedding for '${text1}'...`);
    const out1 = await pipe(text1, { pooling: "mean", normalize: true });

    console.log(`Generating embedding for '${text2}'...`);
    const out2 = await pipe(text2, { pooling: "mean", normalize: true });

    console.log(`Generating embedding for '${text3}'...`);
    const out3 = await pipe(text3, { pooling: "mean", normalize: true });

    const vec1 = Array.from(out1.data);
    const vec2 = Array.from(out2.data);
    const vec3 = Array.from(out3.data);

    function dot(a, b) {
        return a.reduce((sum, val, i) => sum + val * b[i], 0);
    }

    const sim12 = dot(vec1, vec2); // puppy vs dog
    const sim13 = dot(vec1, vec3); // puppy vs cat

    console.log(`Similarity '${text1}' vs '${text2}':`, sim12);
    console.log(`Similarity '${text1}' vs '${text3}':`, sim13);

    if (sim12 > sim13) {
        console.log("SUCCESS: Dog > Cat");
    } else {
        console.log("FAILURE: Cat > Dog (Model issue?)");
    }
}

run().catch(console.error);
