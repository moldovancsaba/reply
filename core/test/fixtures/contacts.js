import { writeFileSync } from "node:fs";
import { makePeople } from "./people.js";

// NDJSON in the shape the native helper's `contacts` command emits (Native helper issue, section 9).
export function buildContacts(rng, n, outPath) {
    const people = makePeople(rng, Math.max(n, 5));
    const rec = (contactId, displayName, phones, emails) => ({ type: "contact", schemaVersion: 1, contactId, displayName, phones, emails });
    const out = people.slice(0, n).map((p, i) => rec(`CNID-${String(i).padStart(4, "0")}`, p.name, [p.phone], i % 3 === 0 ? [p.email] : []));
    // edge cases (always present, appended after the regular people)
    out.push(rec("CNID-EDGE-MULTI", "Multi Handle", ["+12125559001", "+12125559002", "+12125559003"], ["multi1@example.com", "multi2@example.org"]));
    out.push(rec("CNID-EDGE-DUP-A", "Same Name", ["+12125559011"], []));
    out.push(rec("CNID-EDGE-DUP-B", "Same Name", ["+12125559012"], []));
    out.push(rec("CNID-EDGE-NOHANDLE", "No Handles", [], []));
    out.push(rec("CNID-EDGE-NONLATIN", "山田 太郎", ["+12125559021"], ["taro@example.net"]));
    out.push(rec("CNID-EDGE-ORG", "Example Org Ltd", ["+12125559031"], []));
    out.push(rec("CNID-EDGE-SHARED-A", "Landline Anna", ["+12125559041"], []));
    out.push(rec("CNID-EDGE-SHARED-B", "Landline Bela", ["+12125559041"], []));
    writeFileSync(outPath, out.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
