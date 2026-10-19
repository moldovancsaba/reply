import Foundation
import Security

/// Generic-password items in the login keychain, used for IMAP app passwords. Secrets travel on stdin/stdout only,
/// never in arguments (which `ps` shows).
public enum KeychainStore {
    public static let servicePrefix = "reply-core."

    public static func failure(for status: OSStatus) -> HelperFailure {
        switch status {
        case errSecItemNotFound:
            return .sourceMissing("No saved password was found.")
        case errSecInteractionNotAllowed, errSecAuthFailed, errSecUserCanceled, errSecNotAvailable:
            return .permissionDenied("The keychain is locked or access was refused. Unlock the keychain and allow reply-core-helper.")
        default:
            return .internalError("keychain error \(status)")
        }
    }

    private static func query(service: String, account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    public static func set(service: String, account: String, secret: Data) throws {
        let del = SecItemDelete(query(service: service, account: account) as CFDictionary)
        guard del == errSecSuccess || del == errSecItemNotFound else { throw failure(for: del) }
        var add = query(service: service, account: account)
        add[kSecValueData as String] = secret
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw failure(for: status) }
    }

    public static func get(service: String, account: String) throws -> Data {
        var q = query(service: service, account: account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        guard status == errSecSuccess, let data = out as? Data else { throw failure(for: status) }
        return data
    }

    public static func delete(service: String, account: String) throws {
        let status = SecItemDelete(query(service: service, account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw failure(for: status) }
    }
}

public struct SecretRecord: Encodable {
    public let type = "secret"
    public let schemaVersion = helperSchemaVersion
    public let secret: String
    public init(secret: String) { self.secret = secret }
}
