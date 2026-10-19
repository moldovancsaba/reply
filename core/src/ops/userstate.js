// The only data in core.db that cannot be rebuilt from the source apps: the user's manual identity decisions.
// Merges are exported by handle sets (not row ids), because a rebuild creates new contact ids.
export function exportUserState(db, now = Date.now()) {
    const handlesOf = db.prepare("SELECT handle_norm FROM contact_handles WHERE contact_id = ? ORDER BY handle_norm");
    const merges = db.prepare("SELECT * FROM merge_log WHERE action = 'merge' ORDER BY ts_ms ASC, rowid ASC").all().map((l) => {
        const moved = JSON.parse(l.handles_json).map((h) => h.handle_norm);
        // logs written before anchors existed: any handle the target owns now that this merge did not move
        const anchor = l.anchor_handle ?? handlesOf.all(l.to_contact_id).map((h) => h.handle_norm).find((h) => !moved.includes(h)) ?? null;
        const reverted = l.reverted_by ? db.prepare("SELECT ts_ms FROM merge_log WHERE id = ?").get(l.reverted_by)?.ts_ms : null;
        return { id: l.id, ts: new Date(l.ts_ms).toISOString(), keptHandles: anchor ? [anchor] : [], movedHandles: moved, ...(l.reverted_by ? { revertedAt: new Date(reverted ?? l.ts_ms).toISOString() } : {}) };
    });
    const contactNames = db.prepare("SELECT c.display_name n, (SELECT MIN(handle_norm) FROM contact_handles h WHERE h.contact_id = c.id) h FROM contacts c WHERE c.origin = 'manual' AND c.merged_into IS NULL").all()
        .filter((r) => r.h).map((r) => ({ handle_norm: r.h, displayName: r.n, origin: "manual" }));
    // What the user wrote about people: keyed by one of the person's handles (ids change on a rebuild, handles do not).
    const anchorOf = db.prepare("SELECT MIN(handle_norm) h FROM contact_handles WHERE contact_id = ?");
    const profiles = db.prepare("SELECT * FROM contact_profile").all().map((p) => ({ p, h: anchorOf.get(p.contact_id)?.h })).filter((x) => x.h)
        .map(({ p, h }) => ({ handle_norm: h, profession: p.profession, company: p.company, relationship: p.relationship, linkedinUrl: p.linkedin_url, intro: p.intro }));
    const notes = db.prepare("SELECT * FROM contact_notes ORDER BY created_ms ASC, rowid ASC").all().map((n) => ({ n, h: anchorOf.get(n.contact_id)?.h })).filter((x) => x.h)
        .map(({ n, h }) => ({ handle_norm: h, text: n.text, createdMs: n.created_ms }));
    return { schema: 1, exportedAt: new Date(now).toISOString(), manualMerges: merges, contactNames, profiles, notes };
}

// Replays the merges in their original order. Merges whose handles do not exist yet wait in `pending_merges`.
export function importUserState(db, identity, state) {
    const out = { applied: 0, already: 0, pending: 0, skippedReverted: 0, skippedNoAnchor: 0, renamed: 0 };
    for (const m of state.manualMerges ?? []) {
        if (m.revertedAt) { out.skippedReverted++; continue; }
        if (!m.keptHandles?.length || !m.movedHandles?.length) { out.skippedNoAnchor++; continue; }
        out[identity.replayMerge({ movedHandles: m.movedHandles, anchor: m.keptHandles[0] })]++;
    }
    for (const c of state.contactNames ?? []) {
        const row = db.prepare("SELECT contact_id id FROM contact_handles WHERE handle_norm = ?").get(c.handle_norm);
        if (row) { db.prepare("UPDATE contacts SET display_name = ? WHERE id = ?").run(c.displayName, row.id); out.renamed++; }
    }
    // profiles and notes (state schema 2; older exports simply have none)
    const lookup = db.prepare("SELECT contact_id id FROM contact_handles WHERE handle_norm = ?");
    // A person written about before any of their messages are back gets an automatic contact for that handle, so the
    // note has a home; when the messages arrive they find the same contact.
    const ownerOf = { get(handle) {
        const row = lookup.get(handle);
        if (row) return row;
        const t = Date.now();
        const id = `c_${Math.random().toString(36).slice(2)}${t.toString(36)}`;
        const kind = handle.startsWith("group:") || handle.startsWith("other:") ? "other" : handle.endsWith("@wa") ? "whatsapp" : handle.includes("@") ? "email" : "phone";
        db.prepare("INSERT OR IGNORE INTO handles (handle_norm, kind, first_seen_ms, last_seen_ms) VALUES (?, ?, ?, ?)").run(handle, kind, t, t);
        db.prepare("INSERT INTO contacts (id, display_name, origin, hidden, created_ms) VALUES (?, ?, 'auto', 0, ?)").run(id, handle, t);
        db.prepare("INSERT INTO contact_handles (handle_norm, contact_id, link_origin, linked_ms) VALUES (?, ?, 'auto', ?)").run(handle, id, t);
        return { id };
    } };
    out.profiles = 0;
    out.notes = 0;
    for (const p of state.profiles ?? []) {
        const row = ownerOf.get(p.handle_norm);
        if (!row) continue;
        db.prepare(`INSERT INTO contact_profile (contact_id, profession, company, relationship, linkedin_url, intro, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(contact_id) DO NOTHING`).run(row.id, p.profession ?? "", p.company ?? "", p.relationship ?? "", p.linkedinUrl ?? "", p.intro ?? "", Date.now());
        out.profiles++;
    }
    for (const n of state.notes ?? []) {
        const row = ownerOf.get(n.handle_norm);
        if (!row) continue;
        const dup = db.prepare("SELECT 1 FROM contact_notes WHERE contact_id = ? AND text = ? AND created_ms = ?").get(row.id, n.text, n.createdMs);
        if (dup) continue;
        db.prepare("INSERT INTO contact_notes (id, contact_id, text, created_ms) VALUES (?, ?, ?, ?)").run(`n_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`, row.id, n.text, n.createdMs);
        out.notes++;
    }
    return out;
}
