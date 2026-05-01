import Foundation
import Contacts

struct ContactRecord: Encodable {
    let displayName: String
    let profession: String
    let company: String
    let linkedinUrl: String
    let notes: String
    let emails: [String]
    let phones: [String]
}

enum ExportError: LocalizedError {
    case accessDenied

    var errorDescription: String? {
        switch self {
        case .accessDenied:
            return "Contacts access denied. Grant Contacts permission to the Reply host process and try again."
        }
    }
}

@main
struct ContactsExporter {
    static func main() async {
        do {
            let records = try await exportContacts()
            let encoder = JSONEncoder()
            encoder.outputFormatting = []
            let data = try encoder.encode(records)
            FileHandle.standardOutput.write(data)
        } catch {
            fputs("\(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }

    static func exportContacts() async throws -> [ContactRecord] {
        let store = CNContactStore()
        let granted = try await requestAccess(store: store)
        guard granted else {
            throw ExportError.accessDenied
        }

        let keys: [CNKeyDescriptor] = [
            CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactMiddleNameKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactOrganizationNameKey as CNKeyDescriptor,
            CNContactJobTitleKey as CNKeyDescriptor,
            CNContactUrlAddressesKey as CNKeyDescriptor
        ]

        let request = CNContactFetchRequest(keysToFetch: keys)
        request.unifyResults = true
        request.sortOrder = .userDefault

        var out: [ContactRecord] = []
        try store.enumerateContacts(with: request) { contact, _ in
            let displayName = CNContactFormatter.string(from: contact, style: .fullName)?.trimmingCharacters(in: .whitespacesAndNewlines)
                ?? [contact.givenName, contact.middleName, contact.familyName]
                    .joined(separator: " ")
                    .trimmingCharacters(in: .whitespacesAndNewlines)

            let urls = contact.urlAddresses.map { $0.value as String }
            let linkedinUrl = urls.first(where: { $0.localizedCaseInsensitiveContains("linkedin.com") }) ?? ""
            let emails = contact.emailAddresses.map { String($0.value) }.filter { !$0.isEmpty }
            let phones = contact.phoneNumbers.map { $0.value.stringValue }.filter { !$0.isEmpty }

            out.append(ContactRecord(
                displayName: displayName,
                profession: contact.jobTitle,
                company: contact.organizationName,
                linkedinUrl: linkedinUrl,
                notes: "",
                emails: emails,
                phones: phones
            ))
        }

        return out
    }

    static func requestAccess(store: CNContactStore) async throws -> Bool {
        let current = CNContactStore.authorizationStatus(for: .contacts)
        if current == .authorized {
            return true
        }
        if current == .denied || current == .restricted {
            return false
        }
        return try await withCheckedThrowingContinuation { continuation in
            store.requestAccess(for: .contacts) { granted, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: granted)
                }
            }
        }
    }
}
