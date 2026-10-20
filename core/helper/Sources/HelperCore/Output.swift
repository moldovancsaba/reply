import Foundation

/// One JSON object per line on stdout. Diagnostics go to stderr and never contain message content.
public final class NDJSONWriter {
    private let encoder: JSONEncoder
    private let sink: (Data) -> Bool

    public init(sink: @escaping (Data) -> Bool = NDJSONWriter.stdoutSink) {
        encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        self.sink = sink
    }

    /// Returns false when the reader went away (broken pipe); callers stop quietly.
    @discardableResult
    public func emit<T: Encodable>(_ record: T) -> Bool {
        guard var data = try? encoder.encode(record) else { return false }
        data.append(0x0A)
        return sink(data)
    }

    public static func stdoutSink(_ data: Data) -> Bool {
        data.withUnsafeBytes { raw -> Bool in
            var offset = 0
            while offset < raw.count {
                let n = write(STDOUT_FILENO, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                if n <= 0 { return false }
                offset += n
            }
            return true
        }
    }
}

public struct CursorRecord: Encodable {
    public let type = "cursor"
    public let schemaVersion = helperSchemaVersion
    public let source: String
    public let cursor: [String: Int64]
    public let exported: Int
    public let more: Bool
    public init(source: String, cursor: [String: Int64], exported: Int, more: Bool) {
        self.source = source; self.cursor = cursor; self.exported = exported; self.more = more
    }
}

public struct WarningRecord: Encodable {
    public let type = "warning"
    public let schemaVersion = helperSchemaVersion
    public let code: String
    public let count: Int
    public init(code: String, count: Int) { self.code = code; self.count = count }
}

public struct AttachmentRecord: Encodable, Equatable {
    public let name: String?
    public let mimeType: String?
    public let bytes: Int64?
    public init(name: String?, mimeType: String?, bytes: Int64?) { self.name = name; self.mimeType = mimeType; self.bytes = bytes }
}

public struct MessageRecord: Encodable {
    public let type = "message"
    public let schemaVersion = helperSchemaVersion
    public let source: String
    public let providerMessageKey: String
    public let account: String
    public let threadKey: String
    public let counterpartHandle: String
    public let isFromMe: Bool
    public let tsMs: Int64
    public let subject: String?
    public let text: String
    public let attachments: [AttachmentRecord]
    // iMessage only
    public var isGroup: Bool?
    public var isReaction: Bool?
    public var service: String?
    // Mail only
    public var sender: String?
    public var to: [String]?
    public var mailboxKind: String?
    public var accountLabel: String?

    public init(source: String, providerMessageKey: String, account: String, threadKey: String, counterpartHandle: String,
                isFromMe: Bool, tsMs: Int64, subject: String?, text: String, attachments: [AttachmentRecord]) {
        self.source = source; self.providerMessageKey = providerMessageKey; self.account = account; self.threadKey = threadKey
        self.counterpartHandle = counterpartHandle; self.isFromMe = isFromMe; self.tsMs = tsMs; self.subject = subject
        self.text = text; self.attachments = attachments
    }
}

public struct ContactRecord: Encodable, Equatable {
    public let type = "contact"
    public let schemaVersion = helperSchemaVersion
    public let contactId: String
    public let displayName: String
    public let phones: [String]
    public let emails: [String]
    // Address-book details shown on the profile; nil/empty ones are left out of the JSON.
    public let givenName: String?
    public let familyName: String?
    public let nickname: String?
    public let organization: String?
    public let jobTitle: String?
    public let department: String?
    public let birthday: String?
    public let urls: [String]?
    public let addresses: [String]?
    /// Small thumbnail (JPEG or PNG), base64; left out when the person has none or it is over the size cap.
    public let photo: String?
    public init(contactId: String, displayName: String, phones: [String], emails: [String], givenName: String? = nil, familyName: String? = nil, nickname: String? = nil, organization: String? = nil, jobTitle: String? = nil, department: String? = nil, birthday: String? = nil, urls: [String]? = nil, addresses: [String]? = nil, photo: String? = nil) {
        self.contactId = contactId; self.displayName = displayName; self.phones = phones; self.emails = emails
        self.givenName = givenName; self.familyName = familyName; self.nickname = nickname; self.organization = organization
        self.jobTitle = jobTitle; self.department = department; self.birthday = birthday; self.urls = urls; self.addresses = addresses; self.photo = photo
    }
}
