import Foundation
import SQLite3

struct IMessageAttachmentExport: Codable {
    let guid: String?
    let name: String?
    let filename: String?
    let mimeType: String?
    let uti: String?
    let totalBytes: Int64?
}

struct IMessageRowExport: Codable {
    let rowID: Int64
    let guid: String
    let text: String
    let date: Int64
    let isFromMe: Bool
    let handleID: String?
    let service: String?
    let attachments: [IMessageAttachmentExport]
}

enum IMessageExportError: LocalizedError {
    case open(String)
    case prepare(String)
    case step(String)

    var errorDescription: String? {
        switch self {
        case .open(let text), .prepare(let text), .step(let text):
            return text
        }
    }
}

struct IMessageExportCommand {
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

        let resolvedDbPath = dbPath ?? FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Library")
            .appending(path: "Messages")
            .appending(path: "chat.db")
            .path

        let rows = try exportRows(dbPath: resolvedDbPath, afterRowID: afterRowID, limit: limit)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(rows)
        FileHandle.standardOutput.write(data)
    }

    private static func exportRows(dbPath: String, afterRowID: Int64, limit: Int32) throws -> [IMessageRowExport] {
        var db: OpaquePointer?
        guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
            throw IMessageExportError.open("Unable to open iMessage database at \(dbPath)")
        }
        defer { sqlite3_close(db) }

        let sql = """
        SELECT
            m.ROWID,
            m.guid,
            m.text,
            m.subject,
            m.date,
            m.is_from_me,
            h.id,
            m.service,
            m.associated_message_type,
            m.associated_message_guid,
            m.associated_message_emoji,
            m.attributedBody,
            m.cache_has_attachments
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        WHERE
            m.ROWID > ?
            AND (
                COALESCE(m.text, '') != '' OR
                COALESCE(m.subject, '') != '' OR
                m.attributedBody IS NOT NULL OR
                m.cache_has_attachments = 1 OR
                m.associated_message_guid IS NOT NULL
            )
        ORDER BY m.ROWID ASC
        LIMIT ?
        """

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            throw IMessageExportError.prepare("Unable to prepare iMessage export query")
        }
        defer { sqlite3_finalize(stmt) }

        sqlite3_bind_int64(stmt, 1, afterRowID)
        sqlite3_bind_int(stmt, 2, limit)

        var rows: [IMessageRowExport] = []
        while true {
            let step = sqlite3_step(stmt)
            if step == SQLITE_DONE {
                break
            }
            guard step == SQLITE_ROW else {
                let message = String(cString: sqlite3_errmsg(db))
                throw IMessageExportError.step("iMessage export query failed: \(message)")
            }

            let rowID = sqlite3_column_int64(stmt, 0)
            let guid = stringValue(stmt, column: 1) ?? "msg-\(rowID)"
            let plainText = stringValue(stmt, column: 2)
            let subject = stringValue(stmt, column: 3)
            let date = sqlite3_column_int64(stmt, 4)
            let isFromMe = sqlite3_column_int(stmt, 5) == 1
            let handleID = stringValue(stmt, column: 6)
            let service = stringValue(stmt, column: 7)
            let associatedMessageType = sqlite3_column_int(stmt, 8)
            let associatedMessageEmoji = stringValue(stmt, column: 10)
            let attributedBody = dataValue(stmt, column: 11)
            let cacheHasAttachments = sqlite3_column_int(stmt, 12) == 1

            let attachments = try fetchAttachments(db: db, rowID: rowID)
            let richText = decodeAttributedBodyText(attributedBody)
            let finalText = composeMessageText(
                plainText: plainText,
                richText: richText,
                subject: subject,
                associatedMessageType: associatedMessageType,
                associatedMessageEmoji: associatedMessageEmoji,
                attachments: attachments,
                cacheHasAttachments: cacheHasAttachments
            )

            rows.append(
                IMessageRowExport(
                    rowID: rowID,
                    guid: guid,
                    text: finalText,
                    date: date,
                    isFromMe: isFromMe,
                    handleID: handleID,
                    service: service,
                    attachments: attachments
                )
            )
        }

        return rows
    }

    private static func fetchAttachments(db: OpaquePointer, rowID: Int64) throws -> [IMessageAttachmentExport] {
        let sql = """
        SELECT
            a.guid,
            a.transfer_name,
            a.filename,
            a.mime_type,
            a.uti,
            a.total_bytes
        FROM attachment a
        JOIN message_attachment_join maj ON maj.attachment_id = a.ROWID
        WHERE maj.message_id = ?
        ORDER BY a.ROWID ASC
        """

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            throw IMessageExportError.prepare("Unable to prepare attachment query")
        }
        defer { sqlite3_finalize(stmt) }

        sqlite3_bind_int64(stmt, 1, rowID)

        var attachments: [IMessageAttachmentExport] = []
        while true {
            let step = sqlite3_step(stmt)
            if step == SQLITE_DONE {
                break
            }
            guard step == SQLITE_ROW else {
                let message = String(cString: sqlite3_errmsg(db))
                throw IMessageExportError.step("Attachment query failed: \(message)")
            }

            attachments.append(
                IMessageAttachmentExport(
                    guid: stringValue(stmt, column: 0),
                    name: stringValue(stmt, column: 1),
                    filename: stringValue(stmt, column: 2),
                    mimeType: stringValue(stmt, column: 3),
                    uti: stringValue(stmt, column: 4),
                    totalBytes: sqlite3_column_type(stmt, 5) == SQLITE_NULL ? nil : sqlite3_column_int64(stmt, 5)
                )
            )
        }

        return attachments
    }

    private static func composeMessageText(
        plainText: String?,
        richText: String?,
        subject: String?,
        associatedMessageType: Int32,
        associatedMessageEmoji: String?,
        attachments: [IMessageAttachmentExport],
        cacheHasAttachments: Bool
    ) -> String {
        let candidates = [
            normalizeBody(plainText),
            normalizeBody(richText),
            normalizeBody(subject)
        ]
        let base = candidates.first(where: { !$0.isEmpty }) ?? reactionFallback(
            associatedMessageType: associatedMessageType,
            associatedMessageEmoji: associatedMessageEmoji
        )

        let attachmentSummary = attachmentSummaryBlock(attachments, cacheHasAttachments: cacheHasAttachments)
        if base.isEmpty {
            return attachmentSummary.placeholder + attachmentSummary.tail
        }
        return base + attachmentSummary.tail
    }

    private static func reactionFallback(associatedMessageType: Int32, associatedMessageEmoji: String?) -> String {
        switch associatedMessageType {
        case 2000:
            let emoji = normalizeBody(associatedMessageEmoji)
            if !emoji.isEmpty {
                return "Reacted \(emoji)"
            }
            return "Reaction"
        default:
            return ""
        }
    }

    private static func attachmentSummaryBlock(
        _ attachments: [IMessageAttachmentExport],
        cacheHasAttachments: Bool
    ) -> (placeholder: String, tail: String) {
        guard cacheHasAttachments || !attachments.isEmpty else {
            return ("", "")
        }

        let normalized = attachments.map { item in
            [
                "name": firstNonEmpty(item.name, item.filename, fallbackName(for: item.mimeType, uti: item.uti)),
                "id": item.guid ?? "",
                "mime": item.mimeType ?? "",
                "size": item.totalBytes.map(String.init) ?? ""
            ]
        }.map { dict in
            dict.filter { !$0.value.isEmpty }
        }

        let placeholder: String
        if let first = normalized.first?["name"] {
            placeholder = normalized.count == 1 ? "[Attachment: \(first)]" : "[Attachments: \(normalized.count)]"
        } else {
            placeholder = normalized.count <= 1 ? "[Attachment]" : "[Attachments: \(normalized.count)]"
        }

        guard !normalized.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: normalized, options: []),
              let json = String(data: data, encoding: .utf8)
        else {
            return (placeholder, "")
        }

        return (placeholder, "\n\n[ATTACHMENTS: \(json)]")
    }

    private static func fallbackName(for mimeType: String?, uti: String?) -> String {
        let lowerMime = (mimeType ?? "").lowercased()
        let lowerUTI = (uti ?? "").lowercased()
        if lowerMime.hasPrefix("image/") || lowerUTI.contains("image") {
            return "Image"
        }
        if lowerMime.hasPrefix("video/") || lowerUTI.contains("movie") || lowerUTI.contains("video") {
            return "Video"
        }
        if lowerMime.hasPrefix("audio/") || lowerUTI.contains("audio") {
            return "Audio"
        }
        if lowerMime == "application/pdf" || lowerUTI.contains("pdf") {
            return "PDF"
        }
        return "File"
    }

    private static func decodeAttributedBodyText(_ data: Data?) -> String? {
        guard let data else { return nil }
        guard
            let cls = NSClassFromString("NSUnarchiver") as AnyObject?,
            let unmanaged = cls.perform(NSSelectorFromString("unarchiveObjectWithData:"), with: data),
            let object = unmanaged.takeUnretainedValue() as AnyObject?
        else {
            return nil
        }
        if let attributed = object as? NSAttributedString {
            return normalizeBody(attributed.string)
        }
        if let string = object as? String {
            return normalizeBody(string)
        }
        return nil
    }

    private static func normalizeBody(_ value: String?) -> String {
        let raw = value ?? ""
        let withoutObjectMarkers = raw.replacingOccurrences(of: "\u{FFFC}", with: "")
        let lines = withoutObjectMarkers
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
        let collapsed = lines
            .joined(separator: "\n")
            .replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return collapsed
    }

    private static func stringValue(_ stmt: OpaquePointer, column: Int32) -> String? {
        guard let pointer = sqlite3_column_text(stmt, column) else { return nil }
        return String(cString: pointer)
    }

    private static func dataValue(_ stmt: OpaquePointer, column: Int32) -> Data? {
        guard let bytes = sqlite3_column_blob(stmt, column) else { return nil }
        let count = Int(sqlite3_column_bytes(stmt, column))
        guard count > 0 else { return nil }
        return Data(bytes: bytes, count: count)
    }

    private static func firstNonEmpty(_ values: String?...) -> String {
        for value in values {
            let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                return trimmed
            }
        }
        return "File"
    }
}
