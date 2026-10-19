export type Segment = { text: string; hit: boolean };

const START = "\u0001";
const END = "\u0002";

// The service marks matches with control characters, never HTML. Total: a stray, nested or unterminated mark is plain
// text, and joining the segments always gives back the snippet without its (valid) marks.
export function parseSnippet(s: string): Segment[] {
  const out: Segment[] = [];
  let hit = false;
  let buf = "";
  for (const ch of s) {
    if (ch === START && !hit) {
      if (buf) out.push({ text: buf, hit: false });
      buf = "";
      hit = true;
    } else if (ch === END && hit) {
      if (buf) out.push({ text: buf, hit: true });
      buf = "";
      hit = false;
    } else if (ch === START || ch === END) {
      buf += ""; // a mark that cannot pair up is dropped, it is never shown
    } else buf += ch;
  }
  if (buf) out.push({ text: buf, hit: false }); // an unterminated highlight is plain text
  return out;
}

export const canSearch = (q: string) => q.trim().length >= 2;
