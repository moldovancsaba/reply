import Foundation
import SQLite3

public enum Mail {
    static let requiredColumns: [String: [String]] = [
        "messages": ["ROWID", "global_message_id", "conversation_id", "date_sent", "date_received", "mailbox", "sender", "subject", "summary", "deleted"],
        "mailboxes": ["ROWID", "url"],
        "addresses": ["ROWID", "address"],
        "subjects": ["ROWID", "subject"],
        "summaries": ["ROWID", "summary"],
        "recipients": ["message", "address", "type", "position"],
    ]

    /// Finds `<root>/V<highest>/MailData/Envelope Index` (the version folder changes with macOS releases).
    public static func resolveIndex(root: String) throws -> String {
        if let f = failure(for: probe(path: root), what: "The Mail folder") { throw f }
        guard let entries = try? FileManager.default.contentsOfDirectory(atPath: root) else {
            throw HelperFailure.permissionDenied("The Mail folder is not readable. Grant Full Disk Access to the app that starts Reply Core.")
        }
        let candidates = entries.compactMap { name -> (Int, String)? in
            guard name.hasPrefix("V"), let v = Int(name.dropFirst()) else { return nil }
            let path = "\(root)/\(name)/MailData/Envelope Index"
            return FileManager.default.fileExists(atPath: path) ? (v, path) : nil
        }.sorted { $0.0 > $1.0 }
        guard let chosen = candidates.first?.1 else { throw HelperFailure.sourceMissing("No Mail account data was found. Add an account in the Mail app.") }
        return chosen
    }

    public static func mailboxKind(url: String?) -> String {
        let lower = (url?.removingPercentEncoding ?? url ?? "").lowercased()
        if lower.contains("draft") { return "drafts" }
        if lower.contains("junk") || lower.contains("spam") { return "junk" }
        if lower.contains("trash") || lower.contains("deleted") || lower.hasSuffix("/bin") { return "trash" }
        if lower.contains("sent") { return "sent" }
        if lower.contains("inbox") { return "inbox" }
        if lower.contains("archive") || lower.contains("all mail") { return "archive" }
        return "other"
    }

    public static func accountId(url: String?) -> String {
        guard let url, let u = URLComponents(string: url), let host = u.host, !host.isEmpty else { return "" }
        return host.removingPercentEncoding ?? host
    }

    public static func normalizeAddress(_ raw: String?) -> String? {
        let value = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        if let s = value.firstIndex(of: "<"), let e = value.firstIndex(of: ">"), s < e { return String(value[value.index(after: s)..<e]).lowercased() }
        return value.lowercased()
    }

    public static func export(root: String, afterRowID: Int64, limit: Int, writer: NDJSONWriter) throws {
        let path = try resolveIndex(root: root)
        let db = try ReadOnlyDB(path: path, what: "The Mail index")
        for (table, cols) in requiredColumns where !db.hasColumns(table, cols) { throw HelperFailure.schemaUnsupported("Mail index is missing \(table) columns") }

        // addresses that appear as senders in sent mailboxes are the user's own
        var selfEmails = Set<String>()
        let selfStmt = try db.prepare("SELECT DISTINCT a.address, mb.url FROM messages m JOIN addresses a ON a.ROWID = m.sender JOIN mailboxes mb ON mb.ROWID = m.mailbox")
        while try db.step(selfStmt) {
            if mailboxKind(url: text(selfStmt, 1)) == "sent", let a = normalizeAddress(text(selfStmt, 0)) { selfEmails.insert(a) }
        }
        sqlite3_finalize(selfStmt)

        let stmt = try db.prepare("""
            SELECT m.ROWID, m.global_message_id, m.conversation_id, m.date_sent, m.date_received, mb.url, a.address, subj.subject, sm.summary
            FROM messages m
            LEFT JOIN mailboxes mb ON mb.ROWID = m.mailbox
            LEFT JOIN addresses a ON a.ROWID = m.sender
            LEFT JOIN subjects subj ON subj.ROWID = m.subject
            LEFT JOIN summaries sm ON sm.ROWID = m.summary
            WHERE m.ROWID > ? AND m.deleted = 0
            ORDER BY m.ROWID ASC LIMIT ?
            """)
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int64(stmt, 1, afterRowID)
        sqlite3_bind_int(stmt, 2, Int32(limit))
        struct Row { let rowID: Int64; let gid: String?; let conv: String?; let sent: Int64; let received: Int64; let url: String?; let sender: String?; let subject: String?; let summary: String? }
        var rows: [Row] = []
        while try db.step(stmt) {
            rows.append(Row(rowID: int64(stmt, 0), gid: text(stmt, 1), conv: text(stmt, 2), sent: int64(stmt, 3), received: int64(stmt, 4), url: text(stmt, 5), sender: text(stmt, 6), subject: text(stmt, 7), summary: text(stmt, 8)))
        }
        let recipients = try fetchRecipients(db, rowIDs: rows.map(\.rowID))

        var last = afterRowID
        for r in rows {
            let kind = mailboxKind(url: r.url)
            let sender = normalizeAddress(r.sender)
            let to = recipients[r.rowID] ?? []
            let isFromMe = kind == "sent" || (sender.map(selfEmails.contains) ?? false)
            let counterpart = isFromMe ? (to.first ?? "") : (sender ?? "")
            let ts = (r.received > 0 ? r.received : r.sent) * 1000
            let subject = r.subject.map { normalizeBody($0) }.flatMap { $0.isEmpty ? nil : $0 }
            var record = MessageRecord(
                source: "mail", providerMessageKey: r.gid.flatMap { $0.isEmpty ? nil : $0 } ?? "row:\(r.rowID)", account: accountId(url: r.url),
                threadKey: r.conv ?? "", counterpartHandle: counterpart, isFromMe: isFromMe, tsMs: ts, subject: subject,
                text: normalizeBody(r.summary), attachments: [])
            record.sender = sender
            record.to = to
            record.mailboxKind = kind
            record.accountLabel = accountId(url: r.url)
            if !writer.emit(record) { return }
            last = r.rowID
        }
        writer.emit(CursorRecord(source: "mail", cursor: ["rowid": last], exported: rows.count, more: rows.count == limit))
    }

    static func fetchRecipients(_ db: ReadOnlyDB, rowIDs: [Int64]) throws -> [Int64: [String]] {
        guard !rowIDs.isEmpty else { return [:] }
        let marks = rowIDs.map { _ in "?" }.joined(separator: ",")
        let stmt = try db.prepare("""
            SELECT r.message, a.address FROM recipients r JOIN addresses a ON a.ROWID = r.address
            WHERE r.message IN (\(marks)) ORDER BY r.message ASC, COALESCE(r.type, 0) ASC, COALESCE(r.position, 0) ASC
            """)
        defer { sqlite3_finalize(stmt) }
        for (i, id) in rowIDs.enumerated() { sqlite3_bind_int64(stmt, Int32(i + 1), id) }
        var out: [Int64: [String]] = [:]
        while try db.step(stmt) {
            if let a = normalizeAddress(text(stmt, 1)) { out[int64(stmt, 0), default: []].append(a) }
        }
        return out
    }
}
