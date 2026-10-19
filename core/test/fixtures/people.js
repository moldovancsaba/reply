// Entirely synthetic people. Phones use the fictional 555-01xx range, emails use reserved example domains.
const FIRST = ["Anna", "Bela", "Csilla", "David", "Eszter", "Ferenc", "Gabor", "Hanna", "Istvan", "Julia", "Karoly", "Lilla", "Marta", "Nora", "Oliver", "Petra", "Qadir", "Reka", "Sandor", "Tamas", "Ulla", "Viktor", "Weronika", "Xenia", "Yusuf"];
const LAST = ["Kovacs", "Nagy", "Szabo", "Toth", "Varga", "Kiss", "Molnar", "Nemeth", "Farkas", "Balogh", "Papp", "Takacs", "Juhasz", "Lakatos", "Meszaros"];
const DOMAINS = ["example.com", "example.org", "example.net"];

export function makePeople(rng, n) {
    return Array.from({ length: n }, (_, i) => {
        const first = FIRST[i % FIRST.length];
        const last = rng.pick(LAST);
        const slug = `${first}.${last}${i}`.toLowerCase();
        return {
            id: `p${i}`,
            name: `${first} ${last}`,
            phone: `+1212555${String(100 + i).padStart(4, "0")}`,
            email: `${slug}@${rng.pick(DOMAINS)}`,
        };
    });
}

const WORDS = ["lunch", "tomorrow", "invoice", "meeting", "photos", "weekend", "ticket", "dinner", "report", "birthday", "project", "thanks", "call", "later", "address", "schedule", "flight", "payment", "draft", "update"];
export function sentence(rng, min = 3, max = 12) {
    const n = min + rng.int(max - min + 1);
    const words = Array.from({ length: n }, () => rng.pick(WORDS));
    return words[0][0].toUpperCase() + words[0].slice(1) + " " + words.slice(1).join(" ") + ".";
}

// Fixed reference time so output never depends on the wall clock: 2026-10-01T00:00:00Z
export const BASE_MS = Date.UTC(2026, 9, 1);
export const randomTs = (rng, spanDays = 400) => BASE_MS - Math.floor(rng() * spanDays * 86400000);
