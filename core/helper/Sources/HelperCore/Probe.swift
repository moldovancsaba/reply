import Foundation
import SQLite3

public enum SourceAccess: String, Equatable {
    case ok
    case permissionDenied = "permission_denied"
    case sourceMissing = "source_missing"
    case sourceLocked = "source_locked"
    case schemaUnsupported = "schema_unsupported"
    /// Contacts only: the user has not been asked yet. The first `contacts` export triggers the macOS prompt.
    case needsConsent = "needs_consent"
}

/// Distinguishes "no such file" from "macOS refused" by errno (FileManager.fileExists cannot tell them apart).
public func probe(path: String) -> SourceAccess {
    let fd = open(path, O_RDONLY)
    if fd >= 0 { close(fd); return .ok }
    switch errno {
    case ENOENT, ENOTDIR: return .sourceMissing
    case EPERM, EACCES: return .permissionDenied
    default: return .sourceMissing
    }
}

public func failure(for access: SourceAccess, what: String) -> HelperFailure? {
    switch access {
    case .ok: return nil
    case .permissionDenied: return .permissionDenied("\(what) is not readable. Grant Full Disk Access to the app that starts Reply Core.")
    case .sourceMissing: return .sourceMissing("\(what) was not found.")
    case .sourceLocked: return .sourceLocked("\(what) is busy.")
    case .schemaUnsupported: return .schemaUnsupported("\(what) has an unsupported layout.")
    case .needsConsent: return nil
    }
}

public final class ReadOnlyDB {
    public let handle: OpaquePointer

    /// Opens read-only; retries once after 200 ms when the source is busy. Throws a classified HelperFailure.
    public init(path: String, what: String) throws {
        if let f = failure(for: probe(path: path), what: what) { throw f }
        var attempt = 0
        while true {
            var db: OpaquePointer?
            let rc = sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil)
            if rc == SQLITE_OK, let db {
                sqlite3_busy_timeout(db, 200)
                self.handle = db
                return
            }
            let busy = rc == SQLITE_BUSY || rc == SQLITE_LOCKED
            if let db { sqlite3_close(db) }
            if busy && attempt == 0 { attempt += 1; usleep(200_000); continue }
            if busy { throw HelperFailure.sourceLocked("\(what) is busy.") }
            if rc == SQLITE_AUTH || rc == SQLITE_PERM { throw HelperFailure.permissionDenied("\(what) is not readable. Grant Full Disk Access to the app that starts Reply Core.") }
            throw HelperFailure.internalError("cannot open \(what) (sqlite code \(rc))")
        }
    }

    deinit { sqlite3_close(handle) }

    public func hasColumns(_ table: String, _ columns: [String]) -> Bool {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, "PRAGMA table_info(\(table))", -1, &stmt, nil) == SQLITE_OK, let stmt else { return false }
        defer { sqlite3_finalize(stmt) }
        var have = Set<String>()
        while sqlite3_step(stmt) == SQLITE_ROW { if let t = sqlite3_column_text(stmt, 1) { have.insert(String(cString: t)) } }
        return columns.allSatisfy(have.contains)
    }

    /// Prepares a statement; maps SQLITE_BUSY/LOCKED to sourceLocked and other failures to schemaUnsupported/internal.
    public func prepare(_ sql: String) throws -> OpaquePointer {
        var stmt: OpaquePointer?
        let rc = sqlite3_prepare_v2(handle, sql, -1, &stmt, nil)
        guard rc == SQLITE_OK, let stmt else {
            if rc == SQLITE_BUSY || rc == SQLITE_LOCKED { throw HelperFailure.sourceLocked("source is busy") }
            throw HelperFailure.schemaUnsupported("query failed to prepare: \(String(cString: sqlite3_errmsg(handle)))")
        }
        return stmt
    }

    public func step(_ stmt: OpaquePointer) throws -> Bool {
        let rc = sqlite3_step(stmt)
        if rc == SQLITE_ROW { return true }
        if rc == SQLITE_DONE { return false }
        if rc == SQLITE_BUSY || rc == SQLITE_LOCKED { throw HelperFailure.sourceLocked("source is busy") }
        throw HelperFailure.internalError("query failed (sqlite code \(rc))")
    }
}

public func text(_ stmt: OpaquePointer, _ col: Int32) -> String? {
    guard sqlite3_column_type(stmt, col) != SQLITE_NULL, let p = sqlite3_column_text(stmt, col) else { return nil }
    return String(cString: p)
}

public func int64(_ stmt: OpaquePointer, _ col: Int32) -> Int64 {
    sqlite3_column_type(stmt, col) == SQLITE_NULL ? 0 : sqlite3_column_int64(stmt, col)
}

public func blob(_ stmt: OpaquePointer, _ col: Int32) -> Data? {
    guard let bytes = sqlite3_column_blob(stmt, col) else { return nil }
    let count = Int(sqlite3_column_bytes(stmt, col))
    return count > 0 ? Data(bytes: bytes, count: count) : nil
}
