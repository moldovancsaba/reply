import Security
import SQLite3
import XCTest
@testable import HelperCore

// Real bytes captured from NSArchiver.archivedData(withRootObject: NSAttributedString(string:)) on macOS 26.
private let vectors: [(String, String)] = [
    ("Hi", "040b73747265616d747970656481e803840140848484124e5341747472696275746564537472696e67008484084e534f626a656374008592848484084e53537472696e67019484012b02486986840269490102928484840c4e5344696374696f6e6172790094840169008686"),
    ("café 😀", "040b73747265616d747970656481e803840140848484124e5341747472696275746564537472696e67008484084e534f626a656374008592848484084e53537472696e67019484012b0a636166c3a920f09f988086840269490107928484840c4e5344696374696f6e6172790094840169008686"),
]

private func data(hex: String) -> Data {
    var d = Data(); var i = hex.startIndex
    while i < hex.endIndex { let j = hex.index(i, offsetBy: 2); d.append(UInt8(hex[i..<j], radix: 16)!); i = j }
    return d
}

private final class Capture {
    var lines: [[String: Any]] = []
    lazy var writer = NDJSONWriter { [unowned self] d in
        for line in String(decoding: d, as: UTF8.self).split(separator: "\n") {
            self.lines.append(try! JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String: Any])
        }
        return true
    }
}

/// Produces real typedstream bytes. NSArchiver is looked up at runtime because the class is deprecated (zero-warning rule).
private func archive(_ object: NSAttributedString) -> Data {
    let cls = NSClassFromString("NSArchiver") as AnyObject
    return cls.perform(NSSelectorFromString("archivedDataWithRootObject:"), with: object)!.takeUnretainedValue() as! Data
}

private func tempDir() -> URL {
    let u = FileManager.default.temporaryDirectory.appendingPathComponent("rch-\(UUID().uuidString)")
    try! FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
    return u
}

private func makeMessagesDB(at path: String, rows: [(guid: String, text: String?, body: Data?, date: Int64, fromMe: Bool, att: Bool, amType: Int)], dropColumn: Bool = false) {
    var db: OpaquePointer?
    XCTAssertEqual(sqlite3_open(path, &db), SQLITE_OK)
    defer { sqlite3_close(db) }
    let sub = dropColumn ? "" : "associated_message_type INTEGER DEFAULT 0, "
    sqlite3_exec(db, """
        CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
        CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, style INTEGER, chat_identifier TEXT);
        CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, subject TEXT, handle_id INTEGER, service TEXT, date INTEGER, is_from_me INTEGER, \(sub)attributedBody BLOB, cache_has_attachments INTEGER);
        CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
        INSERT INTO handle VALUES (1, '+12125550100');
        INSERT INTO chat VALUES (1, 'iMessage;-;+12125550100', 45, '+12125550100');
        """, nil, nil, nil)
    if dropColumn { return }
    for (i, r) in rows.enumerated() {
        var st: OpaquePointer?
        sqlite3_prepare_v2(db, "INSERT INTO message (ROWID, guid, text, subject, handle_id, service, date, is_from_me, associated_message_type, attributedBody, cache_has_attachments) VALUES (?, ?, ?, NULL, 1, 'iMessage', ?, ?, ?, ?, ?)", -1, &st, nil)
        sqlite3_bind_int64(st, 1, Int64(i + 1))
        sqlite3_bind_text(st, 2, r.guid, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        if let t = r.text { sqlite3_bind_text(st, 3, t, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) } else { sqlite3_bind_null(st, 3) }
        sqlite3_bind_int64(st, 4, r.date)
        sqlite3_bind_int(st, 5, r.fromMe ? 1 : 0)
        sqlite3_bind_int(st, 6, Int32(r.amType))
        if let b = r.body { _ = b.withUnsafeBytes { sqlite3_bind_blob(st, 7, $0.baseAddress, Int32(b.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self)) } } else { sqlite3_bind_null(st, 7) }
        sqlite3_bind_int(st, 8, r.att ? 1 : 0)
        XCTAssertEqual(sqlite3_step(st), SQLITE_DONE)
        sqlite3_finalize(st)
        sqlite3_exec(db, "INSERT INTO chat_message_join VALUES (1, \(i + 1))", nil, nil, nil)
    }
}

final class HelperCoreTests: XCTestCase {
    func testAppleTimeConversion() {
        XCTAssertEqual(appleToUnixMs(0), 0)
        XCTAssertEqual(appleToUnixMs(-5), 0)
        XCTAssertEqual(appleToUnixMs(1), 978_307_201_000)
        let seconds: Int64 = 780_000_000
        XCTAssertEqual(appleToUnixMs(seconds), (seconds + 978_307_200) * 1000)
        XCTAssertEqual(appleToUnixMs(seconds * 1_000_000_000), (seconds + 978_307_200) * 1000, "nanoseconds and seconds map to the same instant")
    }

    func testAttributedBodyDecodesRealArchiverBytes() {
        for (text, hex) in vectors { XCTAssertEqual(decodeAttributedBody(data(hex: hex)), text) }
    }

    func testAttributedBodyMatchesRealArchiverForManyStrings() {
        let long = String(repeating: "lorem ipsum ", count: 30_000) // > 65,535 bytes: four-byte length form
        let samples = ["a", "line one\nline two", "emoji 😀😀 and café", String(repeating: "x", count: 127), String(repeating: "x", count: 128),
                       String(repeating: "é", count: 300), String(repeating: "word ", count: 5000), "日本語のメッセージ", long]
        for s in samples {
            let blob = archive(NSAttributedString(string: s))
            XCTAssertEqual(decodeAttributedBody(blob), normalizeBody(s), "length \(s.utf8.count)")
        }
    }

    func testAttributedBodyFailsSoftly() {
        XCTAssertNil(decodeAttributedBody(nil))
        XCTAssertNil(decodeAttributedBody(Data()))
        for cut in stride(from: 0, to: vectors[1].1.count, by: 2) {
            // every truncation point must return nil or a string, never crash
            _ = decodeAttributedBody(data(hex: String(vectors[1].1.prefix(cut))))
        }
        XCTAssertNil(decodeAttributedBody(data(hex: String(vectors[0].1.prefix(60)))), "truncated blob")
        var lying = data(hex: vectors[0].1); lying[lying.firstIndex(of: 0x2b)! + 1] = 0x7f
        XCTAssertNil(decodeAttributedBody(lying), "length larger than the blob")
        XCTAssertNil(decodeAttributedBody(Data(repeating: 7, count: 64)), "garbage blob")
    }

    func testNormalizeBody() {
        XCTAssertEqual(normalizeBody("  a \u{FFFC}\n\n\n\n b  "), "a\n\nb")
        XCTAssertEqual(normalizeBody(nil), "")
    }

    func testMailHelpers() {
        XCTAssertEqual(Mail.mailboxKind(url: "imap://A/INBOX"), "inbox")
        XCTAssertEqual(Mail.mailboxKind(url: "imap://A/Sent%20Messages"), "sent")
        XCTAssertEqual(Mail.mailboxKind(url: "imap://A/%5BGmail%5D/Sent%20Mail"), "sent")
        XCTAssertEqual(Mail.mailboxKind(url: "imap://A/Drafts"), "drafts")
        XCTAssertEqual(Mail.mailboxKind(url: "imap://A/Junk"), "junk")
        XCTAssertEqual(Mail.mailboxKind(url: "imap://A/Deleted%20Messages"), "trash")
        XCTAssertEqual(Mail.mailboxKind(url: "imap://A/Archive"), "archive")
        XCTAssertEqual(Mail.mailboxKind(url: nil), "other")
        XCTAssertEqual(Mail.accountId(url: "imap://ACC-0001/INBOX"), "ACC-0001")
        XCTAssertEqual(Mail.normalizeAddress("Anna <Anna.K@Example.COM>"), "anna.k@example.com")
        XCTAssertNil(Mail.normalizeAddress("  "))
    }

    func testProbeClassifiesByErrno() throws {
        let dir = tempDir(); defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertEqual(probe(path: dir.appendingPathComponent("nope").path), .sourceMissing)
        let f = dir.appendingPathComponent("locked"); FileManager.default.createFile(atPath: f.path, contents: Data())
        XCTAssertEqual(probe(path: f.path), .ok)
        try FileManager.default.setAttributes([.posixPermissions: 0], ofItemAtPath: f.path)
        XCTAssertEqual(probe(path: f.path), .permissionDenied)
    }

    func testContactDisplayNameFallback() throws {
        XCTAssertEqual(ContactsSource.displayName(formatted: " Anna K ", organization: "Org", firstHandle: "+1"), "Anna K")
        XCTAssertEqual(ContactsSource.displayName(formatted: "", organization: "Org", firstHandle: "+1"), "Org")
        XCTAssertEqual(ContactsSource.displayName(formatted: nil, organization: nil, firstHandle: "+1"), "+1")
        XCTAssertEqual(ContactsSource.birthdayString(DateComponents(year: 1985, month: 3, day: 9)), "1985-03-09")
        XCTAssertEqual(ContactsSource.birthdayString(DateComponents(month: 12, day: 24)), "--12-24")
        XCTAssertNil(ContactsSource.birthdayString(DateComponents(year: 1985)))
        XCTAssertNil(ContactsSource.nonEmpty("  "))
        let r = ContactRecord(contactId: "1", displayName: "A", phones: [], emails: [], organization: "Org", jobTitle: "CTO")
        let json = String(data: try JSONEncoder().encode(r), encoding: .utf8)!
        XCTAssertTrue(json.contains("\"organization\":\"Org\"") && json.contains("\"jobTitle\":\"CTO\""))
        XCTAssertFalse(json.contains("nickname"), "empty details are left out of the JSON")
        XCTAssertEqual(ContactsSource.displayName(formatted: nil, organization: nil, firstHandle: nil), "")
    }

    func testIMessageExportPagesDecodesAndWarns() throws {
        let dir = tempDir(); defer { try? FileManager.default.removeItem(at: dir) }
        let path = dir.appendingPathComponent("chat.db").path
        let ns: Int64 = 780_000_000 * 1_000_000_000
        makeMessagesDB(at: path, rows: [
            ("g1", "plain", nil, ns, false, false, 0),
            ("g2", nil, data(hex: vectors[1].1), ns + 1, true, false, 0),
            ("g3", nil, Data(repeating: 7, count: 32), ns + 2, false, false, 0),
            ("g4", nil, nil, ns + 3, false, true, 0),
            ("g5", nil, nil, ns + 4, false, false, 2000),
        ])
        let cap = Capture()
        try IMessage.export(dbPath: path, afterRowID: 0, limit: 3, writer: cap.writer)
        let msgs = cap.lines.filter { $0["type"] as? String == "message" }
        XCTAssertEqual(msgs.map { $0["text"] as? String }, ["plain", "café 😀", ""])
        XCTAssertEqual(msgs[1]["isFromMe"] as? Bool, true)
        let warn = cap.lines.first { $0["type"] as? String == "warning" }
        XCTAssertEqual(warn?["code"] as? String, "undecodable_text")
        XCTAssertEqual(warn?["count"] as? Int, 1)
        let cur = cap.lines.last!
        XCTAssertEqual((cur["cursor"] as? [String: Int])?["rowid"], 3)
        XCTAssertEqual(cur["more"] as? Bool, true)

        let cap2 = Capture()
        try IMessage.export(dbPath: path, afterRowID: 3, limit: 3, writer: cap2.writer)
        let m2 = cap2.lines.filter { $0["type"] as? String == "message" }
        XCTAssertEqual(m2.map { $0["text"] as? String }, ["[Attachment]", "Reaction"])
        XCTAssertEqual(m2[1]["isReaction"] as? Bool, true)
        XCTAssertEqual(cap2.lines.last?["more"] as? Bool, false)

        let cap3 = Capture()
        try IMessage.export(dbPath: path, afterRowID: 5, limit: 3, writer: cap3.writer)
        XCTAssertEqual(cap3.lines.count, 1, "nothing new: only the cursor record")
        XCTAssertEqual((cap3.lines[0]["cursor"] as? [String: Int])?["rowid"], 5, "cursor never moves backwards")
    }

    func testUnsupportedSchemaIsClassified() throws {
        let dir = tempDir(); defer { try? FileManager.default.removeItem(at: dir) }
        let path = dir.appendingPathComponent("chat.db").path
        makeMessagesDB(at: path, rows: [], dropColumn: true)
        XCTAssertThrowsError(try IMessage.export(dbPath: path, afterRowID: 0, limit: 1, writer: Capture().writer)) {
            XCTAssertEqual(($0 as? HelperFailure)?.exitCode, 13)
        }
    }

    func testMissingSourceAndDoctorExitCodes() {
        let report = doctor(imessageDB: "/nonexistent/chat.db", mailRoot: "/nonexistent/Mail", checkContacts: false)
        XCTAssertEqual(report.imessage, "source_missing")
        XCTAssertEqual(report.mail, "source_missing")
        XCTAssertEqual(report.worstFailure?.exitCode, 11)
    }

    func testDoctorOnlyChecksTheRequestedSource() {
        let r = doctor(imessageDB: "/nonexistent/chat.db", mailRoot: "/nonexistent/Mail", checkContacts: false, only: "contacts")
        XCTAssertEqual([r.imessage, r.mail, r.contacts], ["skipped", "skipped", "ok"])
        XCTAssertNil(r.worstFailure)
        XCTAssertThrowsError(try CLI.parse(["--only", "calendar"]))
    }

    func testKeychainCommandValidatesBeforeTouchingTheKeychain() {
        let w = Capture().writer
        XCTAssertEqual(CLI.run(["keychain"], writer: w), 2)
        XCTAssertEqual(CLI.run(["keychain", "wipe"], writer: w), 2)
        XCTAssertEqual(CLI.run(["keychain", "get", "--account", "a"], writer: w), 2, "service is required")
        XCTAssertEqual(CLI.run(["keychain", "get", "--service", "login", "--account", "a"], writer: w), 2, "only reply-core.* services are reachable")
        XCTAssertEqual(CLI.run(["keychain", "get", "--service", "reply-core.imap", "--account", ""], writer: w), 2)
        XCTAssertThrowsError(try CLI.runKeychain(["set", "--service", "reply-core.x", "--account", "a"], writer: w, readStdin: { Data() })) {
            XCTAssertEqual(($0 as? HelperFailure)?.exitCode, 2, "an empty secret is refused")
        }
    }

    func testKeychainStatusMapping() {
        XCTAssertEqual(KeychainStore.failure(for: errSecItemNotFound).exitCode, 11)
        XCTAssertEqual(KeychainStore.failure(for: errSecInteractionNotAllowed).exitCode, 10)
        XCTAssertEqual(KeychainStore.failure(for: errSecAuthFailed).exitCode, 10)
        XCTAssertEqual(KeychainStore.failure(for: errSecParam).exitCode, 20)
    }

    func testBrokenPipeStopsQuietly() {
        let w = NDJSONWriter { _ in false }
        XCTAssertFalse(w.emit(WarningRecord(code: "x", count: 1)))
    }

    func testCLIParsing() {
        XCTAssertThrowsError(try CLI.parse(["--after", "-1"]))
        XCTAssertThrowsError(try CLI.parse(["--limit"]))
        XCTAssertThrowsError(try CLI.parse(["--bogus"]))
        XCTAssertEqual(try CLI.parse(["--after", "5", "--limit", "9"]).limit, 9)
        XCTAssertEqual(CLI.run([], writer: Capture().writer), 2)
        XCTAssertEqual(CLI.run(["nope"], writer: Capture().writer), 2)
        XCTAssertEqual(CLI.run(["imessage", "--limit", "0"], writer: Capture().writer), 2)
        XCTAssertNil(try CLI.parse([]).limit, "an omitted limit stays omitted (contacts export everything)")
        XCTAssertEqual(DoctorReport(imessage: "ok", mail: "ok", contacts: "needs_consent").worstFailure, nil, "needing consent is not a failure")
        XCTAssertEqual(CLI.run(["imessage", "--db", "/nonexistent/x.db"], writer: Capture().writer), 11)
    }
}
