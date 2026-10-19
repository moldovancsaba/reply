import Foundation

public let helperVersion = "1.0.0"
public let helperSchemaVersion = 1

/// Exit codes are part of the contract (core/helper/README.md).
public enum HelperFailure: Error, Equatable {
    case permissionDenied(String)
    case sourceMissing(String)
    case sourceLocked(String)
    case schemaUnsupported(String)
    case usage(String)
    case internalError(String)

    public var exitCode: Int32 {
        switch self {
        case .permissionDenied: return 10
        case .sourceMissing: return 11
        case .sourceLocked: return 12
        case .schemaUnsupported: return 13
        case .usage: return 2
        case .internalError: return 20
        }
    }

    public var code: String {
        switch self {
        case .permissionDenied: return "permission_denied"
        case .sourceMissing: return "source_missing"
        case .sourceLocked: return "source_locked"
        case .schemaUnsupported: return "schema_unsupported"
        case .usage: return "usage"
        case .internalError: return "internal"
        }
    }

    public var message: String {
        switch self {
        case .permissionDenied(let m), .sourceMissing(let m), .sourceLocked(let m),
             .schemaUnsupported(let m), .usage(let m), .internalError(let m):
            return m
        }
    }
}
