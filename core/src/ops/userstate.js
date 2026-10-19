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
    return { schema: 1, exportedAt: new Date(now).toISOString(), manualMerges: merges, contactNames };
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
    return out;
}
