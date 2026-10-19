import Foundation
import SQLite3

public enum IMessage {
    public static let defaultDBPath = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Messages/chat.db").path
    static let requiredColumns: [String: [String]] = [
        "message": ["ROWID", "guid", "text", "subject", "handle_id", "service", "date", "is_from_me", "associated_message_type", "attributedBody", "cache_has_attachments"],
        "handle": ["ROWID", "id"],
        "chat": ["ROWID", "guid", "style", "chat_identifier"],
        "chat_message_join": ["chat_id", "message_id"],
    ]

    public static func checkSchema(_ db: ReadOnlyDB) throws {
        for (table, cols) in requiredColumns where !db.hasColumns(table, cols) {
            throw HelperFailure.schemaUnsupported("Messages database is missing \(table) columns")
        }
    }

    public static func attachmentPlaceholder(_ attachments: [AttachmentRecord]) -> String {
        guard !attachments.isEmpty else { return "[Attachment]" }
        if attachments.count == 1 { return "[Attachment: \(attachments[0].name ?? "File")]" }
        return "[Attachments: \(attachments.count)]"
    }

    public static func export(dbPath: String, afterRowID: Int64, limit: Int, writer: NDJSONWriter) throws {
        let db = try ReadOnlyDB(path: dbPath, what: "The Messages database")
        try checkSchema(db)
        let stmt = try db.prepare("""
            SELECT m.ROWID, m.guid, m.text, m.subject, m.date, m.is_from_me, h.id, m.service,
                   m.associated_message_type, m.attributedBody, m.cache_has_attachments,
                   c.guid, c.style, c.chat_identifier
            FROM message m
            LEFT JOIN handle h ON h.ROWID = m.handle_id
            LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
            LEFT JOIN chat c ON c.ROWID = cmj.chat_id
            WHERE m.ROWID > ?
              AND (COALESCE(m.text, '') != '' OR COALESCE(m.subject, '') != '' OR m.attributedBody IS NOT NULL
                   OR m.cache_has_attachments = 1 OR m.associated_message_type >= 2000)
            GROUP BY m.ROWID
            ORDER BY m.ROWID ASC
            LIMIT ?
            """)
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int64(stmt, 1, afterRowID)
        sqlite3_bind_int(stmt, 2, Int32(limit))

        var last = afterRowID, exported = 0, undecodable = 0
        while try db.step(stmt) {
            let rowID = int64(stmt, 0)
            let guid = text(stmt, 1) ?? "msg-\(rowID)"
            let plain = normalizeBody(text(stmt, 2))
            let subject = text(stmt, 3).map { normalizeBody($0) }.flatMap { $0.isEmpty ? nil : $0 }
            let isFromMe = sqlite3_column_int(stmt, 5) == 1
            let handleID = text(stmt, 6)
            let amType = sqlite3_column_int(stmt, 8)
            let body = blob(stmt, 9)
            let hasAttachments = sqlite3_column_int(stmt, 10) == 1
            let chatGuid = text(stmt, 11)
            let isGroup = sqlite3_column_type(stmt, 12) != SQLITE_NULL && sqlite3_column_int(stmt, 12) == 43
            let chatIdentifier = text(stmt, 13)

            let attachments = hasAttachments ? try fetchAttachments(db, rowID: rowID) : []
            let isReaction = amType >= 2000
            var message = plain
            if message.isEmpty, body != nil {
                if let rich = decodeAttributedBody(body), !rich.isEmpty { message = rich } else { undecodable += 1 }
            }
            if message.isEmpty, isReaction { message = "Reaction" }
            if message.isEmpty, hasAttachments { message = attachmentPlaceholder(attachments) }

            let counterpart = isGroup ? (isFromMe ? "" : (handleID ?? "")) : (handleID ?? chatIdentifier ?? "")
            var record = MessageRecord(
                source: "imessage", providerMessageKey: guid, account: "", threadKey: chatGuid ?? handleID ?? "unknown",
                counterpartHandle: counterpart, isFromMe: isFromMe, tsMs: appleToUnixMs(int64(stmt, 4)), subject: subject,
                text: message, attachments: attachments)
            record.isGroup = isGroup
            record.isReaction = isReaction
            record.service = text(stmt, 7)
            if !writer.emit(record) { return }
            last = rowID
            exported += 1
        }
        if undecodable > 0 { writer.emit(WarningRecord(code: "undecodable_text", count: undecodable)) }
        writer.emit(CursorRecord(source: "imessage", cursor: ["rowid": last], exported: exported, more: exported == limit))
    }

    static func fetchAttachments(_ db: ReadOnlyDB, rowID: Int64) throws -> [AttachmentRecord] {
        guard db.hasColumns("attachment", ["ROWID", "transfer_name", "filename", "mime_type", "total_bytes"]),
              db.hasColumns("message_attachment_join", ["message_id", "attachment_id"]) else { return [] }
        let stmt = try db.prepare("""
            SELECT a.transfer_name, a.filename, a.mime_type, a.total_bytes
            FROM attachment a JOIN message_attachment_join j ON j.attachment_id = a.ROWID
            WHERE j.message_id = ? ORDER BY a.ROWID ASC
            """)
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int64(stmt, 1, rowID)
        var out: [AttachmentRecord] = []
        while try db.step(stmt) {
            let name = [text(stmt, 0), text(stmt, 1).map { ($0 as NSString).lastPathComponent }].compactMap { $0 }.first { !$0.isEmpty }
            out.append(AttachmentRecord(name: name, mimeType: text(stmt, 2), bytes: sqlite3_column_type(stmt, 3) == SQLITE_NULL ? nil : sqlite3_column_int64(stmt, 3)))
        }
        return out
    }
}
