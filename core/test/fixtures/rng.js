// Deterministic PRNG (mulberry32). Fixtures must never read the platform random source or the wall clock.
export function makeRng(seed) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.int = (n) => Math.floor(next() * n);
    next.pick = (arr) => arr[next.int(arr.length)];
    return next;
}
