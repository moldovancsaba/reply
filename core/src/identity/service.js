import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import { kindOf } from "../storage/repo.js";

// Identity rules (docs/CORE_IDENTITY.md): handles link to contacts only through (1) automatic single-handle contacts,
// (2) the user's own address book, (3) explicit merges. Nothing here ever infers a link from names, domains or resemblance between numbers.
export function createIdentity({ db, repo, now = () => Date.now() }) {
    const q = {
        contact: db.prepare("SELECT * FROM contacts WHERE id = ?"),
        handlesOf: db.prepare("SELECT handle_norm, link_origin FROM contact_handles WHERE contact_id = ?"),
        countMsgs: (n) => db.prepare(`SELECT COUNT(*) n FROM messages WHERE handle_norm IN (${new Array(n).fill("?").join(",")})`),
        relink: db.prepare("UPDATE contact_handles SET contact_id = ?, link_origin = ?, linked_ms = ? WHERE handle_norm = ?"),
        hide: db.prepare("UPDATE contacts SET hidden = 1, merged_into = ? WHERE id = ?"),
        unhide: db.prepare("UPDATE contacts SET hidden = 0, merged_into = NULL WHERE id = ?"),
        insertLog: db.prepare("INSERT INTO merge_log (id, ts_ms, action, from_contact_id, to_contact_id, handles_json, reverted_by) VALUES (?,?,?,?,?,?,NULL)"),
        markReverted: db.prepare("UPDATE merge_log SET reverted_by = ? WHERE id = ?"),
        log: db.prepare("SELECT * FROM merge_log WHERE id = ?"),
        owner: db.prepare("SELECT contact_id, link_origin FROM contact_handles WHERE handle_norm = ?"),
        deleteSummary: db.prepare("DELETE FROM contact_summary WHERE contact_id = ?"),
        byExternal: db.prepare("SELECT * FROM contacts WHERE external_id = ?"),
        insertContact: db.prepare("INSERT INTO contacts (id, display_name, origin, hidden, created_ms, external_id) VALUES (?,?,?,0,?,?)"),
        rename: db.prepare("UPDATE contacts SET display_name = ? WHERE id = ?"),
        handleRow: db.prepare("SELECT 1 FROM handles WHERE handle_norm = ?"),
        insertHandle: db.prepare("INSERT INTO handles (handle_norm, kind, first_seen_ms, last_seen_ms) VALUES (?,?,?,?)"),
        insertLink: db.prepare("INSERT INTO contact_handles (handle_norm, contact_id, link_origin, linked_ms) VALUES (?,?,?,?)"),
        deleteContact: db.prepare("DELETE FROM contacts WHERE id = ?"),
        history: db.prepare(`SELECT l.*, f.display_name AS from_name, t.display_name AS to_name FROM merge_log l
            LEFT JOIN contacts f ON f.id = l.from_contact_id LEFT JOIN contacts t ON t.id = l.to_contact_id
            WHERE l.from_contact_id = @id OR l.to_contact_id = @id ORDER BY l.ts_ms DESC, l.rowid DESC`),
        contactsWithHandles: db.prepare("SELECT DISTINCT contact_id FROM contact_handles"),
        allManual: db.prepare("SELECT handle_norm FROM contact_handles WHERE link_origin = 'manual_merge'"),
        merges: db.prepare("SELECT * FROM merge_log WHERE action = 'merge' AND reverted_by IS NULL ORDER BY ts_ms ASC, rowid ASC"),
        allContacts: db.prepare("SELECT id FROM contacts"),
        emptyAuto: db.prepare("SELECT c.id FROM contacts c WHERE c.origin = 'auto' AND NOT EXISTS (SELECT 1 FROM contact_handles h WHERE h.contact_id = c.id)"),
    };

    const activeContact = (id) => {
        const c = q.contact.get(id);
        if (!c || c.merged_into) throw new AppError(404, "contact_not_found", "That contact no longer exists.");
        return c;
    };

    const messageCount = (handles) => (handles.length ? q.countMsgs(handles.length).get(...handles).n : 0);

    function merge(sourceId, targetId) {
        if (sourceId === targetId) throw new AppError(400, "cannot_merge_self", "Choose a different contact.");
        return db.transaction(() => {
            activeContact(sourceId);
            activeContact(targetId);
            const owned = q.handlesOf.all(sourceId);
            const handles = owned.map((h) => h.handle_norm);
            const moved = messageCount(handles);
            for (const h of handles) q.relink.run(targetId, "manual_merge", now(), h);
            const logId = `m_${randomUUID().slice(0, 12)}`;
            q.insertLog.run(logId, now(), "merge", sourceId, targetId, JSON.stringify(owned.map((h) => ({ handle_norm: h.handle_norm, prior_origin: h.link_origin }))), );
            q.hide.run(targetId, sourceId);
            repo.rebuildSummary(targetId);
            q.deleteSummary.run(sourceId);
            return { mergeLogId: logId, movedHandles: handles, movedMessages: moved, targetContactId: targetId };
        })();
    }

    function unmerge(logId) {
        return db.transaction(() => {
            const log = q.log.get(logId);
            if (!log || log.action !== "merge") throw new AppError(404, "merge_not_found", "That merge does not exist.");
            if (log.reverted_by) throw new AppError(409, "merge_already_reverted", "That merge was already undone.");
            const entries = JSON.parse(log.handles_json);
            const conflicts = entries.map((e) => e.handle_norm).filter((h) => q.owner.get(h)?.contact_id !== log.to_contact_id);
            if (conflicts.length) {
                const err = new AppError(409, "handle_conflict", "Some handles were moved again since this merge. Undo the later merge first.");
                err.details = { handles: conflicts };
                throw err;
            }
            if (!q.contact.get(log.from_contact_id)) throw new AppError(404, "contact_not_found", "The original contact no longer exists.");
            for (const e of entries) q.relink.run(log.from_contact_id, e.prior_origin, now(), e.handle_norm);
            q.unhide.run(log.from_contact_id);
            repo.rebuildSummary(log.from_contact_id);
            repo.rebuildSummary(log.to_contact_id);
            const undoId = `m_${randomUUID().slice(0, 12)}`;
            q.insertLog.run(undoId, now(), "unmerge", log.from_contact_id, log.to_contact_id, log.handles_json);
            q.markReverted.run(undoId, logId);
            return { mergeLogId: undoId, restoredContactId: log.from_contact_id, restoredHandles: entries.map((e) => e.handle_norm) };
        })();
    }

    function history(contactId) {
        if (!q.contact.get(contactId)) throw new AppError(404, "contact_not_found", "That contact does not exist.");
        return q.history.all({ id: contactId }).map((l) => ({
            id: l.id, ts: new Date(l.ts_ms).toISOString(), action: l.action, fromName: l.from_name, toName: l.to_name,
            handlesCount: JSON.parse(l.handles_json).length, ...(l.reverted_by ? { revertedBy: l.reverted_by } : {}),
        }));
    }

    // people: [{ externalId, displayName, handles: [{ handle_norm, kind }] }] from the user's own address book.
    // Precedence: a manual merge is never overridden; an `auto` link yields to the address book; two address-book
    // people claiming one handle is reported, never silently resolved.
    function importContacts(people) {
        return db.transaction(() => {
            const r = { created: 0, updated: 0, linked: 0, conflicts: [], protectedByMerge: 0 };
            const touched = new Set();
            for (const p of people) {
                let c = q.byExternal.get(p.externalId);
                if (!c) {
                    const id = randomUUID();
                    q.insertContact.run(id, p.displayName, "apple_contacts", now(), p.externalId);
                    c = q.contact.get(id);
                    r.created++;
                } else if (c.display_name !== p.displayName) {
                    q.rename.run(p.displayName, c.id);
                    r.updated++;
                }
                touched.add(c.id);
                for (const h of p.handles) {
                    if (!q.handleRow.get(h.handle_norm)) q.insertHandle.run(h.handle_norm, h.kind ?? kindOf(h.handle_norm), now(), now());
                    const link = q.owner.get(h.handle_norm);
                    if (!link) {
                        q.insertLink.run(h.handle_norm, c.id, "apple_contacts", now());
                        r.linked++;
                    } else if (link.contact_id === c.id) {
                        continue;
                    } else if (link.link_origin === "auto") {
                        q.relink.run(c.id, "apple_contacts", now(), h.handle_norm);
                        r.linked++;
                        touched.add(link.contact_id);
                    } else if (link.link_origin === "apple_contacts") {
                        r.conflicts.push({ handle_norm: h.handle_norm, keptContactId: link.contact_id, skippedExternalId: p.externalId });
                    } else {
                        r.protectedByMerge++;
                    }
                }
            }
            for (const id of touched) {
                if (q.handlesOf.all(id).length === 0 && q.contact.get(id)?.origin === "auto") {
                    q.deleteSummary.run(id);
                    q.deleteContact.run(id);
                } else repo.rebuildSummary(id);
            }
            return r;
        })();
    }

    // Recovery: undo every manual merge by relinking handles to where they came from (address-book people) or to
    // fresh auto contacts. Messages and the merge log are untouched.
    function resetToAuto() {
        return db.transaction(() => {
            const origin = new Map();
            for (const log of q.merges.all()) for (const e of JSON.parse(log.handles_json)) if (!origin.has(e.handle_norm)) origin.set(e.handle_norm, { from: log.from_contact_id, prior: e.prior_origin });
            let relinked = 0;
            for (const { handle_norm: h } of q.allManual.all()) {
                const o = origin.get(h);
                if (o && o.prior === "apple_contacts" && q.contact.get(o.from)) q.relink.run(o.from, "apple_contacts", now(), h);
                else {
                    const id = randomUUID();
                    q.insertContact.run(id, h, "auto", now(), null);
                    q.relink.run(id, "auto", now(), h);
                }
                relinked++;
            }
            for (const { id } of q.allContacts.all()) {
                if (q.handlesOf.all(id).length) q.unhide.run(id);
            }
            for (const { id } of q.emptyAuto.all()) { q.deleteSummary.run(id); q.deleteContact.run(id); }
            for (const { id } of q.allContacts.all()) repo.rebuildSummary(id);
            return { relinked };
        })();
    }

    return { merge, unmerge, history, importContacts, resetToAuto };
}
