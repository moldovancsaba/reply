import Foundation

enum ReplyHelperError: LocalizedError {
    case usage(String)
    case invalidArgument(String)

    var errorDescription: String? {
        switch self {
        case .usage(let text):
            return text
        case .invalidArgument(let text):
            return text
        }
    }
}

struct ReplyHelper {
    static func main() throws {
        var args = Array(CommandLine.arguments.dropFirst())
        guard let command = args.first else {
            throw ReplyHelperError.usage(Self.usageText)
        }
        args.removeFirst()

        switch command {
        case "mirror-imessage":
            try mirrorIMessage(args: args)
        case "export-imessage":
            try IMessageExportCommand.run(args: args)
        default:
            throw ReplyHelperError.invalidArgument("Unknown command: \(command)\n\n\(Self.usageText)")
        }
    }

    static var usageText: String {
        """
        reply-helper usage:
          reply-helper mirror-imessage --target-root <dir> [--log-file <path>]
          reply-helper export-imessage [--db-path <path>] --after-rowid <n> --limit <n>
        """
    }

    private static func mirrorIMessage(args: [String]) throws {
        var targetRoot: String?
        var logFile: String?

        var index = 0
        while index < args.count {
            let arg = args[index]
            switch arg {
            case "--target-root":
                index += 1
                guard index < args.count else {
                    throw ReplyHelperError.invalidArgument("Missing value for --target-root")
                }
                targetRoot = args[index]
            case "--log-file":
                index += 1
                guard index < args.count else {
                    throw ReplyHelperError.invalidArgument("Missing value for --log-file")
                }
                logFile = args[index]
            default:
                throw ReplyHelperError.invalidArgument("Unknown flag: \(arg)")
            }
            index += 1
        }

        guard let targetRoot else {
            throw ReplyHelperError.invalidArgument("mirror-imessage requires --target-root")
        }

        let fm = FileManager.default
        let sourceRoot = fm.homeDirectoryForCurrentUser
            .appending(path: "Library")
            .appending(path: "Messages")
        let target = URL(fileURLWithPath: targetRoot, isDirectory: true)
        try fm.createDirectory(at: target, withIntermediateDirectories: true)

        try mirrorIfPresent(sourceRoot.appending(path: "chat.db"), to: target.appending(path: "chat.db"))
        try mirrorIfPresent(sourceRoot.appending(path: "chat.db-wal"), to: target.appending(path: "chat.db-wal"))
        try mirrorIfPresent(sourceRoot.appending(path: "chat.db-shm"), to: target.appending(path: "chat.db-shm"))

        if let logFile {
            try appendLog("mirror ok \(sourceRoot.path) -> \(target.path)", logFile: logFile)
        }
    }

    private static func mirrorIfPresent(_ source: URL, to target: URL) throws {
        let fm = FileManager.default
        guard fm.fileExists(atPath: source.path) else { return }

        let sourceValues = try source.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        if fm.fileExists(atPath: target.path) {
            let targetValues = try target.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
            if sourceValues.contentModificationDate == targetValues.contentModificationDate,
               sourceValues.fileSize == targetValues.fileSize {
                return
            }
        }

        let tmp = target.deletingLastPathComponent().appending(path: ".\(target.lastPathComponent).tmp")
        if fm.fileExists(atPath: tmp.path) {
            try? fm.removeItem(at: tmp)
        }
        try fm.copyItem(at: source, to: tmp)
        if fm.fileExists(atPath: target.path) {
            try fm.removeItem(at: target)
        }
        try fm.moveItem(at: tmp, to: target)
    }

    private static func appendLog(_ line: String, logFile: String) throws {
        let fm = FileManager.default
        let url = URL(fileURLWithPath: logFile)
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let stamp = ISO8601DateFormatter().string(from: Date())
        let data = ("[\(stamp)] \(line)\n").data(using: .utf8) ?? Data()
        if fm.fileExists(atPath: url.path) {
            let handle = try FileHandle(forWritingTo: url)
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
            try handle.close()
        } else {
            try data.write(to: url)
        }
    }
}

do {
    try ReplyHelper.main()
} catch {
    fputs("[reply-helper] \(error.localizedDescription)\n", stderr)
    exit(1)
}
