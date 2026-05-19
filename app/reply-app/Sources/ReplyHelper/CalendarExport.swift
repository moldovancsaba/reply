import EventKit
import Foundation

struct AppleCalendarRowExport: Codable {
    let calendar: String
    let title: String
    let start: String
    let end: String
    let location: String
    let description: String
}

enum CalendarExportError: LocalizedError {
    case accessDenied

    var errorDescription: String? {
        switch self {
        case .accessDenied:
            return "Calendar access denied. Grant Calendar permission to the reply app and try again."
        }
    }
}

struct CalendarExportCommand {
    static func run(args _: [String]) throws {
        let records = try exportEvents()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(records)
        FileHandle.standardOutput.write(data)
    }

    private static func exportEvents() throws -> [AppleCalendarRowExport] {
        let store = EKEventStore()
        let granted = try requestAccess(store: store)
        guard granted else {
            throw CalendarExportError.accessDenied
        }

        let startCutoff = Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date()
        let endCutoff = Calendar.current.date(byAdding: .day, value: 180, to: Date()) ?? Date()
        let predicate = store.predicateForEvents(withStart: startCutoff, end: endCutoff, calendars: nil)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        return store.events(matching: predicate)
            .sorted { $0.startDate < $1.startDate }
            .map { event in
                AppleCalendarRowExport(
                    calendar: event.calendar.title,
                    title: event.title ?? "",
                    start: formatter.string(from: event.startDate),
                    end: formatter.string(from: event.endDate),
                    location: event.location ?? "",
                    description: event.notes ?? ""
                )
            }
            .filter { !$0.title.isEmpty && !$0.start.isEmpty }
    }

    private static func requestAccess(store: EKEventStore) throws -> Bool {
        if #available(macOS 14.0, *) {
            let status = EKEventStore.authorizationStatus(for: .event)
            if status == .fullAccess || status == .writeOnly {
                return true
            }
            if status == .denied || status == .restricted {
                return false
            }
            return try waitForFullAccess(store)
        } else {
            let status = EKEventStore.authorizationStatus(for: .event)
            if status == .authorized {
                return true
            }
            if status == .denied || status == .restricted {
                return false
            }
            return try waitForLegacyAccess(store)
        }
    }

    @available(macOS 14.0, *)
    private static func waitForFullAccess(_ store: EKEventStore) throws -> Bool {
        let semaphore = DispatchSemaphore(value: 0)
        var granted = false
        var thrownError: Error?
        store.requestFullAccessToEvents { value, error in
            granted = value
            thrownError = error
            semaphore.signal()
        }
        semaphore.wait()
        if let thrownError {
            throw thrownError
        }
        return granted
    }

    private static func waitForLegacyAccess(_ store: EKEventStore) throws -> Bool {
        let semaphore = DispatchSemaphore(value: 0)
        var granted = false
        var thrownError: Error?
        store.requestAccess(to: .event) { value, error in
            granted = value
            thrownError = error
            semaphore.signal()
        }
        semaphore.wait()
        if let thrownError {
            throw thrownError
        }
        return granted
    }
}
