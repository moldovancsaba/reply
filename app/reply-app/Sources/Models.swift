import Foundation

struct HealthPayload: Decodable {
    let ok: Bool?
    let version: String?
    let status: String?
    let statusMessage: String?
    let httpPort: Int?
    let httpHost: String?
    let services: [String: ServiceHealth]?
    let channels: [String: ChannelHealth]?
    let preflight: PreflightPayload?
}

struct ServiceHealth: Decodable {
    let name: String?
    let status: String?
    let detail: String?
    let pid: Int?
    let startedAt: String?
    let restartAttempts: Int?
    let repairRequired: Bool?
    let lastError: String?
    let logPath: String?
}

struct ChannelHealth: Decodable {
    let state: String?
    let message: String?
    let processed: Int?
    let total: Int?
    let connector: String?
    let provider: String?
    let account: String?
    let connected: Bool?
    let progress: Int?
    let lastSync: String?
    let lastSuccessfulSync: String?
    let lastAttemptedSync: String?
}

struct PreflightPayload: Decodable {
    let overall: String
    let runId: String?
    let checks: [PreflightCheck]
}

struct PreflightCheck: Decodable, Identifiable {
    let id: String
    let category: String?
    let title: String
    let severity: String?
    let status: String
    let detail: String?
    let hint: String?
}

enum ManagementState: Equatable {
    case unknown
    case unmanaged
    case managed

    var label: String {
        switch self {
        case .unknown:
            return "Unknown"
        case .unmanaged:
            return "Unmanaged"
        case .managed:
            return "Managed"
        }
    }
}

enum ReplyRuntimeState: Equatable {
    case unknown
    case starting
    case online
    case offline
    case error(String)

    var label: String {
        switch self {
        case .unknown:
            return "Checking"
        case .starting:
            return "Starting"
        case .online:
            return "Online"
        case .offline:
            return "Offline"
        case .error:
            return "Error"
        }
    }
}

enum SidebarTab: String, CaseIterable, Identifiable {
    case system
    case reply

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system:
            return "Overview"
        case .reply:
            return "Workspace"
        }
    }

    var systemImage: String {
        switch self {
        case .system:
            return "square.grid.2x2"
        case .reply:
            return "bubble.left.and.bubble.right.fill"
        }
    }
}

struct NativeSettingsPayload: Decodable {
    let ai: NativeAISettings?
    let worker: NativeWorkerSettings?
    let health: NativeHealthSettings?
}

struct NativeAISettings: Codable {
    var draftRuntime: String?
    var ollamaHost: String?
    var ollamaPort: Int?
    var ollamaModel: String?
    var annotationOllamaModel: String?
    var kycOllamaModel: String?
    var trinityGeneratorModel: String?
    var trinityRefinerModel: String?
    var trinityEvaluatorModel: String?
}

struct NativeWorkerSettings: Codable {
    var pollIntervalSeconds: Int?
    var quantities: NativeWorkerQuantities?
}

struct NativeWorkerQuantities: Codable {
    var imessage: Int?
    var whatsapp: Int?
    var gmail: Int?
    var notes: Int?
}

struct NativeHealthSettings: Codable {
    var ollamaProbeTimeoutMs: Int?
    var uiHealthPollIntervalMs: Int?
}

struct NativeSettingsDraft: Codable {
    var ai: NativeAISettings
    var worker: NativeWorkerSettings
    var health: NativeHealthSettings

    static let empty = NativeSettingsDraft(
        ai: NativeAISettings(
            draftRuntime: "auto",
            ollamaHost: "",
            ollamaPort: 11434,
            ollamaModel: "",
            annotationOllamaModel: "",
            kycOllamaModel: "",
            trinityGeneratorModel: "granite4:350m",
            trinityRefinerModel: "mistral:latest",
            trinityEvaluatorModel: "qwen2.5:7b"
        ),
        worker: NativeWorkerSettings(
            pollIntervalSeconds: 60,
            quantities: NativeWorkerQuantities(
                imessage: 1000,
                whatsapp: 500,
                gmail: 500,
                notes: 0
            )
        ),
        health: NativeHealthSettings(
            ollamaProbeTimeoutMs: 3000,
            uiHealthPollIntervalMs: 15000
        )
    )

    init(ai: NativeAISettings, worker: NativeWorkerSettings, health: NativeHealthSettings) {
        self.ai = ai
        self.worker = worker
        self.health = health
    }

    init(payload: NativeSettingsPayload) {
        let fallback = NativeSettingsDraft.empty
        ai = NativeAISettings(
            draftRuntime: payload.ai?.draftRuntime ?? fallback.ai.draftRuntime,
            ollamaHost: payload.ai?.ollamaHost ?? fallback.ai.ollamaHost,
            ollamaPort: payload.ai?.ollamaPort ?? fallback.ai.ollamaPort,
            ollamaModel: payload.ai?.ollamaModel ?? fallback.ai.ollamaModel,
            annotationOllamaModel: payload.ai?.annotationOllamaModel ?? fallback.ai.annotationOllamaModel,
            kycOllamaModel: payload.ai?.kycOllamaModel ?? fallback.ai.kycOllamaModel,
            trinityGeneratorModel: payload.ai?.trinityGeneratorModel ?? fallback.ai.trinityGeneratorModel,
            trinityRefinerModel: payload.ai?.trinityRefinerModel ?? fallback.ai.trinityRefinerModel,
            trinityEvaluatorModel: payload.ai?.trinityEvaluatorModel ?? fallback.ai.trinityEvaluatorModel
        )
        worker = NativeWorkerSettings(
            pollIntervalSeconds: payload.worker?.pollIntervalSeconds ?? fallback.worker.pollIntervalSeconds,
            quantities: NativeWorkerQuantities(
                imessage: payload.worker?.quantities?.imessage ?? fallback.worker.quantities?.imessage,
                whatsapp: payload.worker?.quantities?.whatsapp ?? fallback.worker.quantities?.whatsapp,
                gmail: payload.worker?.quantities?.gmail ?? fallback.worker.quantities?.gmail,
                notes: payload.worker?.quantities?.notes ?? fallback.worker.quantities?.notes
            )
        )
        health = NativeHealthSettings(
            ollamaProbeTimeoutMs: payload.health?.ollamaProbeTimeoutMs ?? fallback.health.ollamaProbeTimeoutMs,
            uiHealthPollIntervalMs: payload.health?.uiHealthPollIntervalMs ?? fallback.health.uiHealthPollIntervalMs
        )
    }
}

enum SyncChannel: String, CaseIterable, Identifiable {
    case imessage
    case whatsapp
    case mail
    case notes
    case calendar
    case contacts
    case kyc

    var id: String { rawValue }

    var title: String {
        switch self {
        case .imessage: return "iMessage"
        case .whatsapp: return "WhatsApp"
        case .mail: return "Mail"
        case .notes: return "Apple Notes"
        case .calendar: return "Apple Calendar"
        case .contacts: return "Apple Contacts"
        case .kyc: return "Contact Intelligence"
        }
    }
}
