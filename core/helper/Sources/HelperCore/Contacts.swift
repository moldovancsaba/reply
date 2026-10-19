import Contacts
import Foundation

public enum ContactsSource {
    public static func authorization() -> SourceAccess {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .authorized: return .ok
        case .denied, .restricted: return .permissionDenied
        case .notDetermined: return .needsConsent
        default: return .permissionDenied
        }
    }

    static func nonEmpty(_ s: String) -> String? { s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : s }

    /// "1985-03-09", or "--03-09" when the year is unknown.
    static func birthdayString(_ c: DateComponents) -> String? {
        guard let m = c.month, let d = c.day else { return nil }
        let md = String(format: "%02d-%02d", m, d)
        if let y = c.year, y > 0 { return String(format: "%04d-", y) + md }
        return "--" + md
    }

    public static func displayName(formatted: String?, organization: String?, firstHandle: String?) -> String {
        for c in [formatted, organization, firstHandle] {
            let t = (c ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { return t }
        }
        return ""
    }

    /// Exports every person (the Contacts framework offers no per-contact modification date; the service fingerprints records).
    /// `after` is an offset into the identifier-sorted list; `limit` 0 means unlimited.
    public static func export(after: Int, limit: Int, writer: NDJSONWriter) throws {
        let store = CNContactStore()
        var status = CNContactStore.authorizationStatus(for: .contacts)
        if status == .notDetermined {
            let sem = DispatchSemaphore(value: 0)
            store.requestAccess(for: .contacts) { _, _ in sem.signal() }
            sem.wait()
            status = CNContactStore.authorizationStatus(for: .contacts)
        }
        guard status == .authorized else {
            throw HelperFailure.permissionDenied("Contacts access is not granted. Allow Contacts for the app that starts Reply Core.")
        }
        let keys: [CNKeyDescriptor] = [
            CNContactIdentifierKey as CNKeyDescriptor,
            CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
            CNContactOrganizationNameKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactNicknameKey as CNKeyDescriptor,
            CNContactJobTitleKey as CNKeyDescriptor,
            CNContactDepartmentNameKey as CNKeyDescriptor,
            CNContactBirthdayKey as CNKeyDescriptor,
            CNContactUrlAddressesKey as CNKeyDescriptor,
            CNContactPostalAddressesKey as CNKeyDescriptor,
        ]
        let request = CNContactFetchRequest(keysToFetch: keys)
        request.unifyResults = true
        var records: [ContactRecord] = []
        do {
            try store.enumerateContacts(with: request) { c, _ in
                let phones = c.phoneNumbers.map { $0.value.stringValue }.filter { !$0.isEmpty }
                let emails = c.emailAddresses.map { String($0.value) }.filter { !$0.isEmpty }
                let name = displayName(formatted: CNContactFormatter.string(from: c, style: .fullName), organization: c.organizationName, firstHandle: phones.first ?? emails.first)
                records.append(ContactRecord(
                    contactId: c.identifier, displayName: name, phones: phones, emails: emails,
                    givenName: nonEmpty(c.givenName), familyName: nonEmpty(c.familyName), nickname: nonEmpty(c.nickname),
                    organization: nonEmpty(c.organizationName), jobTitle: nonEmpty(c.jobTitle), department: nonEmpty(c.departmentName),
                    birthday: c.birthday.flatMap(birthdayString),
                    urls: c.urlAddresses.isEmpty ? nil : c.urlAddresses.map { String($0.value) }.filter { !$0.isEmpty },
                    addresses: c.postalAddresses.isEmpty ? nil : c.postalAddresses.map { CNPostalAddressFormatter.string(from: $0.value, style: .mailingAddress).replacingOccurrences(of: "\n", with: ", ") }.filter { !$0.isEmpty }
                ))
            }
        } catch {
            throw HelperFailure.internalError("Contacts enumeration failed: \(error.localizedDescription)")
        }
        records.sort { $0.contactId < $1.contactId }
        let slice = Array(records.dropFirst(after).prefix(limit > 0 ? limit : Int.max))
        for r in slice { if !writer.emit(r) { return } }
        let next = after + slice.count
        writer.emit(CursorRecord(source: "contacts", cursor: ["offset": Int64(next)], exported: slice.count, more: next < records.count))
    }
}
