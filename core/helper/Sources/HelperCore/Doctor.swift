import Foundation

public struct DoctorReport: Encodable, Equatable {
    public let imessage: String
    public let mail: String
    public let contacts: String
    public var worstFailure: HelperFailure? {
        for s in [imessage, mail, contacts] {
            switch s {
            case "permission_denied": return .permissionDenied("A source is not readable.")
            case "source_missing": return .sourceMissing("A source was not found.")
            case "source_locked": return .sourceLocked("A source is busy.")
            case "schema_unsupported": return .schemaUnsupported("A source has an unsupported layout.")
            default: continue
            }
        }
        return nil
    }
}

/// Checks access to each source without reading any message content.
public func doctor(imessageDB: String, mailRoot: String, checkContacts: Bool = true, only: String? = nil) -> DoctorReport {
    func state(_ body: () throws -> Void) -> String {
        do { try body(); return SourceAccess.ok.rawValue } catch let f as HelperFailure { return f.code } catch { return "internal" }
    }
    let im = only != nil && only != "imessage" ? "skipped" : state {
        let db = try ReadOnlyDB(path: imessageDB, what: "The Messages database")
        try IMessage.checkSchema(db)
    }
    let ml = only != nil && only != "mail" ? "skipped" : state {
        let path = try Mail.resolveIndex(root: mailRoot)
        let db = try ReadOnlyDB(path: path, what: "The Mail index")
        for (t, c) in Mail.requiredColumns where !db.hasColumns(t, c) { throw HelperFailure.schemaUnsupported("Mail index layout") }
    }
    let ct = only != nil && only != "contacts" ? "skipped" : (checkContacts ? ContactsSource.authorization().rawValue : SourceAccess.ok.rawValue)
    return DoctorReport(imessage: im, mail: ml, contacts: ct)
}
