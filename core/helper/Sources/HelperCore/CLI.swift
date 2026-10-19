import Foundation

public enum CLI {
    public static let usage = """
        reply-core-helper \(helperVersion) (schema \(helperSchemaVersion))
          imessage [--db <path>] [--after <rowid>] [--limit <n>]
          mail     [--root <path>] [--after <rowid>] [--limit <n>]
          contacts [--after <offset>] [--limit <n>]
          doctor   [--db <path>] [--root <path>] [--skip-contacts] [--only imessage|mail|contacts]
          --version
        Exit codes: 0 ok, 2 usage, 10 permission_denied, 11 source_missing, 12 source_locked, 13 schema_unsupported, 20 internal
        """

    struct Options {
        var db = IMessage.defaultDBPath
        var root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Mail").path
        var after: Int64 = 0
        var limit: Int?
        var skipContacts = false
        var only: String?
    }

    static func parse(_ args: [String]) throws -> Options {
        var o = Options()
        var i = 0
        func value() throws -> String {
            i += 1
            guard i < args.count else { throw HelperFailure.usage("Missing value for \(args[i - 1])") }
            return args[i]
        }
        while i < args.count {
            switch args[i] {
            case "--db": o.db = try value()
            case "--root": o.root = try value()
            case "--after":
                guard let v = Int64(try value()), v >= 0 else { throw HelperFailure.usage("--after must be a non-negative integer") }
                o.after = v
            case "--limit":
                guard let v = Int(try value()), v >= 0 else { throw HelperFailure.usage("--limit must be a non-negative integer") }
                o.limit = v
            case "--skip-contacts": o.skipContacts = true
            case "--only":
                let v = try value()
                guard ["imessage", "mail", "contacts"].contains(v) else { throw HelperFailure.usage("--only must be imessage, mail or contacts") }
                o.only = v
            default: throw HelperFailure.usage("Unknown argument: \(args[i])")
            }
            i += 1
        }
        return o
    }

    /// Runs one command; returns the process exit code. Diagnostics go to stderr, records to `writer`.
    public static func run(_ argv: [String], writer: NDJSONWriter = NDJSONWriter()) -> Int32 {
        var args = argv
        guard let command = args.first else { fputs(usage + "\n", stderr); return 2 }
        args.removeFirst()
        do {
            if command == "--version" { print("\(helperVersion) schema=\(helperSchemaVersion)"); return 0 }
            let o = try parse(args)
            switch command {
            case "imessage":
                let limit = o.limit ?? 500
                guard limit > 0 else { throw HelperFailure.usage("--limit must be positive") }
                try IMessage.export(dbPath: o.db, afterRowID: o.after, limit: limit, writer: writer)
            case "mail":
                let limit = o.limit ?? 500
                guard limit > 0 else { throw HelperFailure.usage("--limit must be positive") }
                try Mail.export(root: o.root, afterRowID: o.after, limit: limit, writer: writer)
            case "contacts":
                try ContactsSource.export(after: Int(o.after), limit: o.limit ?? 0, writer: writer) // omitted or 0 = everything
            case "doctor":
                let report = doctor(imessageDB: o.db, mailRoot: o.root, checkContacts: !o.skipContacts, only: o.only)
                writer.emit(report)
                if let f = report.worstFailure {
                    fputs("reply-core-helper: \(f.message) Run doctor again after fixing it.\n", stderr)
                    return f.exitCode
                }
            default:
                throw HelperFailure.usage("Unknown command: \(command)")
            }
            return 0
        } catch let f as HelperFailure {
            fputs("reply-core-helper: \(f.code): \(f.message)\n", stderr)
            return f.exitCode
        } catch {
            fputs("reply-core-helper: internal: \(error.localizedDescription)\n", stderr)
            return 20
        }
    }
}
