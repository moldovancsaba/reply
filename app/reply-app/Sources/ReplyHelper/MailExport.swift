import Foundation
import SQLite3

struct AppleMailRowExport: Codable {
    let rowID: Int64
    let globalMessageID: String?
    let documentID: String?
    let conversationID: String?
    let dateSent: Int64
    let dateReceived: Int64
    let mailboxURL: String?
    let senderAddress: String?
    let subject: String?
    let summary: String?
    let recipients: [String]
}

struct AppleMailExportPayload: Codable {
    let dbPath: String
    let sourceMaxRowID: Int64
    let selfEmails: [String]
    let rows: [AppleMailRowExport]
}

enum MailExportError: LocalizedError {
    case path(String)
    case open(String)
    case prepare(String)
    case step(String)

    var errorDescription: String? {
        switch self {
        case .path(let text), .open(let text), .prepare(let text), .step(let text):
            return text
        }
    }
}

struct MailExportCommand {
    static func run(args: [String]) throws {
        var dbPath: String?
        var afterRowID: Int64 = 0
        var limit: Int32 = 500

        var index = 0
        while index < args.count {
            let arg = args[index]
            switch arg {
            case "--db-path":
                index += 1
                guard index < args.count else {
                    throw ReplyHelperError.invalidArgument("Missing value for --db-path")
                }
                dbPath = args[index]
            case "--after-rowid":
                index += 1
                guard index < args.count, let parsed = Int64(args[index]) else {
                    throw ReplyHelperError.invalidArgument("Invalid value for --after-rowid")
                }
                afterRowID = parsed
            case "--limit":
                index += 1
                guard index < args.count, let parsed = Int32(args[index]), parsed > 0 else {
                    throw ReplyHelperError.invalidArgument("Invalid value for --limit")
                }
                limit = parsed
            default:
                throw ReplyHelperError.invalidArgument("Unknown flag: \(arg)")
            }
            index += 1
        }

        let resolvedDbPath = try dbPath ?? resolveAppleMailIndexPath()
        let payload = try exportPayload(dbPath: resolvedDbPath, afterRowID: afterRowID, limit: limit)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(payload)
        FileHandle.standardOutput.write(data)
    }

    private static func exportPayload(dbPath: String, afterRowID: Int64, limit: Int32) throws -> AppleMailExportPayload {
        var db: OpaquePointer?
        guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
            throw MailExportError.open("Unable to open Apple Mail database at \(dbPath)")
        }
        defer { sqlite3_close(db) }

        let sourceMaxRowID = try queryMaxRowID(db: db)
        let rows = try fetchRows(db: db, afterRowID: afterRowID, limit: limit)
        let recipientMap = try fetchRecipients(db: db, rowIDs: rows.map(\.rowID))
        let selfEmails = try collectSelfEmails(db: db)

        return AppleMailExportPayload(
            dbPath: dbPath,
            sourceMaxRowID: sourceMaxRowID,
            selfEmails: Array(selfEmails).sorted(),
            rows: rows.map { row in
                AppleMailRowExport(
                    rowID: row.rowID,
                    globalMessageID: row.globalMessageID,
                    documentID: row.documentID,
                    conversationID: row.conversationID,
                    dateSent: row.dateSent,
                    dateReceived: row.dateReceived,
                    mailboxURL: row.mailboxURL,
                    senderAddress: row.senderAddress,
                    subject: row.subject,
                    summary: row.summary,
                    recipients: recipientMap[row.rowID] ?? []
                )
            }
        )
    }

    private static func resolveAppleMailIndexPath() throws -> String {
        let fm = FileManager.default
        let root = fm.homeDirectoryForCurrentUser
            .appending(path: "Library")
            .appending(path: "Mail")

        guard let entries = try? fm.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else {
            throw MailExportError.path("Unable to enumerate Apple Mail data under \(root.path)")
        }

        let candidates = entries.compactMap { url -> (url: URL, version: Int, modifiedAt: Date)? in
            let name = url.lastPathComponent
            guard name.hasPrefix("V"), let version = Int(name.dropFirst()) else {
                return nil
            }
            let candidate = url.appending(path: "MailData").appending(path: "Envelope Index")
            guard fm.fileExists(atPath: candidate.path) else {
                return nil
            }
            let modifiedAt = (try? candidate.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return (candidate, version, modifiedAt)
        }
        .sorted { lhs, rhs in
            if lhs.version != rhs.version { return lhs.version > rhs.version }
            return lhs.modifiedAt > rhs.modifiedAt
        }

        guard let chosen = candidates.first?.url.path else {
            throw MailExportError.path("Unable to locate Apple Mail Envelope Index under \(root.path)")
        }
        return chosen
    }

    private static func queryMaxRowID(db: OpaquePointer) throws -> Int64 {
        let sql = "SELECT MAX(ROWID) FROM messages"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            throw MailExportError.prepare("Unable to prepare Apple Mail max row query")
        }
        defer { sqlite3_finalize(stmt) }

        guard sqlite3_step(stmt) == SQLITE_ROW else {
            let message = String(cString: sqlite3_errmsg(db))
            throw MailExportError.step("Apple Mail max row query failed: \(message)")
        }
        return sqlite3_column_type(stmt, 0) == SQLITE_NULL ? 0 : sqlite3_column_int64(stmt, 0)
    }

    private static func fetchRows(db: OpaquePointer, afterRowID: Int64, limit: Int32) throws -> [AppleMailBaseRow] {
        let sql = """
        SELECT
            m.ROWID,
            m.global_message_id,
            m.document_id,
            m.conversation_id,
            m.date_sent,
            m.date_received,
            mb.url,
            a.address,
            subj.subject,
            sm.summary
        FROM messages m
        LEFT JOIN mailboxes mb ON mb.ROWID = m.mailbox
        LEFT JOIN addresses a ON a.ROWID = m.sender
        LEFT JOIN subjects subj ON subj.ROWID = m.subject
        LEFT JOIN summaries sm ON sm.ROWID = m.summary
        WHERE m.ROWID > ?
          AND m.deleted = 0
        ORDER BY m.ROWID ASC
        LIMIT ?
        """

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            throw MailExportError.prepare("Unable to prepare Apple Mail export query")
        }
        defer { sqlite3_finalize(stmt) }

        sqlite3_bind_int64(stmt, 1, afterRowID)
        sqlite3_bind_int(stmt, 2, limit)

        var rows: [AppleMailBaseRow] = []
        while true {
            let step = sqlite3_step(stmt)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW else {
                let message = String(cString: sqlite3_errmsg(db))
                throw MailExportError.step("Apple Mail export query failed: \(message)")
            }
            rows.append(
                AppleMailBaseRow(
                    rowID: sqlite3_column_int64(stmt, 0),
                    globalMessageID: stringValue(stmt, column: 1),
                    documentID: stringValue(stmt, column: 2),
                    conversationID: stringValue(stmt, column: 3),
                    dateSent: sqlite3_column_type(stmt, 4) == SQLITE_NULL ? 0 : sqlite3_column_int64(stmt, 4),
                    dateReceived: sqlite3_column_type(stmt, 5) == SQLITE_NULL ? 0 : sqlite3_column_int64(stmt, 5),
                    mailboxURL: stringValue(stmt, column: 6),
                    senderAddress: stringValue(stmt, column: 7),
                    subject: stringValue(stmt, column: 8),
                    summary: stringValue(stmt, column: 9)
                )
            )
        }
        return rows
    }

    private static func fetchRecipients(db: OpaquePointer, rowIDs: [Int64]) throws -> [Int64: [String]] {
        let ids = Array(Set(rowIDs)).sorted()
        guard !ids.isEmpty else { return [:] }

        let placeholders = ids.map { _ in "?" }.joined(separator: ", ")
        let sql = """
        SELECT
            r.message,
            a.address
        FROM recipients r
        JOIN addresses a ON a.ROWID = r.address
        WHERE r.message IN (\(placeholders))
        ORDER BY r.message ASC, COALESCE(r.type, 0) ASC, COALESCE(r.position, 0) ASC
        """

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            throw MailExportError.prepare("Unable to prepare Apple Mail recipient query")
        }
        defer { sqlite3_finalize(stmt) }

        for (idx, rowID) in ids.enumerated() {
            sqlite3_bind_int64(stmt, Int32(idx + 1), rowID)
        }

        var out: [Int64: [String]] = [:]
        while true {
            let step = sqlite3_step(stmt)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW else {
                let message = String(cString: sqlite3_errmsg(db))
                throw MailExportError.step("Apple Mail recipient query failed: \(message)")
            }
            let rowID = sqlite3_column_int64(stmt, 0)
            guard let address = stringValue(stmt, column: 1)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !address.isEmpty else {
                continue
            }
            out[rowID, default: []].append(address)
        }
        return out
    }

    private static func collectSelfEmails(db: OpaquePointer) throws -> Set<String> {
        let sql = """
        SELECT DISTINCT a.address, mb.url
        FROM messages m
        JOIN addresses a ON a.ROWID = m.sender
        JOIN mailboxes mb ON mb.ROWID = m.mailbox
        WHERE a.address IS NOT NULL AND TRIM(a.address) != ''
        """

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            throw MailExportError.prepare("Unable to prepare Apple Mail self-email query")
        }
        defer { sqlite3_finalize(stmt) }

        var emails = Set<String>()
        while true {
            let step = sqlite3_step(stmt)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW else {
                let message = String(cString: sqlite3_errmsg(db))
                throw MailExportError.step("Apple Mail self-email query failed: \(message)")
            }
            guard let mailboxURL = stringValue(stmt, column: 1), isSentAppleMailbox(mailboxURL),
                  let address = normalizeEmailHeader(stringValue(stmt, column: 0)),
                  !address.isEmpty else {
                continue
            }
            emails.insert(address)
        }
        return emails
    }

    private static func normalizeEmailHeader(_ raw: String?) -> String? {
        let value = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        if let start = value.firstIndex(of: "<"), let end = value.firstIndex(of: ">"), start < end {
            return value[value.index(after: start)..<end].lowercased()
        }
        return value.lowercased()
    }

    private static func isSentAppleMailbox(_ raw: String) -> Bool {
        let lower = raw.removingPercentEncoding?.lowercased() ?? raw.lowercased()
        return lower.contains("sent messages") || lower.hasSuffix("/sent") || lower.contains("/sent/")
    }
}

private struct AppleMailBaseRow {
    let rowID: Int64
    let globalMessageID: String?
    let documentID: String?
    let conversationID: String?
    let dateSent: Int64
    let dateReceived: Int64
    let mailboxURL: String?
    let senderAddress: String?
    let subject: String?
    let summary: String?
}

private func stringValue(_ stmt: OpaquePointer, column: Int32) -> String? {
    guard sqlite3_column_type(stmt, column) != SQLITE_NULL,
          let text = sqlite3_column_text(stmt, column) else {
        return nil
    }
    return String(cString: text)
}
