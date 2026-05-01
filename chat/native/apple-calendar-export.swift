import Foundation
import EventKit

struct CalendarEventRecord: Encodable {
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
            return "Calendar access denied. Grant Calendar permission to the {reply} host process and try again."
        }
    }
}

@main
struct CalendarExporter {
    static func main() async {
        do {
            let records = try await exportEvents()
            let encoder = JSONEncoder()
            let data = try encoder.encode(records)
            FileHandle.standardOutput.write(data)
        } catch {
            fputs("\(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }

    static func exportEvents() async throws -> [CalendarEventRecord] {
        let store = EKEventStore()
        let granted = try await requestAccess(store: store)
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
                CalendarEventRecord(
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

    static func requestAccess(store: EKEventStore) async throws -> Bool {
        if #available(macOS 14.0, *) {
            let status = EKEventStore.authorizationStatus(for: .event)
            if status == .fullAccess || status == .writeOnly {
                return true
            }
            if status == .denied || status == .restricted {
                return false
            }
            return try await store.requestFullAccessToEvents()
        } else {
            let status = EKEventStore.authorizationStatus(for: .event)
            if status == .authorized {
                return true
            }
            if status == .denied || status == .restricted {
                return false
            }
            return try await withCheckedThrowingContinuation { continuation in
                store.requestAccess(to: .event) { granted, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume(returning: granted)
                    }
                }
            }
        }
    }
}
