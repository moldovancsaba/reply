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
    let stats: ReplyConversationStats?
}

struct ReplyConversationStats: Decodable {
    let total: Int?
    let draft: Int?
    let active: Int?
    let resolved: Int?
    let byChannel: [String: Int]?
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
    let runtime: NativeRuntimeInfo?
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

struct NativeRuntimeInfo: Decodable {
    let ollamaPort: String?
    let platform: String?
    let effectiveOllamaBase: String?
    let draftRuntime: String?
    let trinity: TrinityRuntimeStatus?
}

struct TrinityRuntimeStatus: Decodable {
    let configPath: String?
    let provider: String?
    let llmEnabled: Bool?
    let ollamaBaseURL: String?
    let timeoutSeconds: Double?
    let providerStatus: String?
    let providerError: String?
    let availableModels: [TrinityAvailableModel]?
    let roles: TrinityRoleStatusMap?

    enum CodingKeys: String, CodingKey {
        case configPath = "config_path"
        case provider
        case llmEnabled = "llm_enabled"
        case ollamaBaseURL = "ollama_base_url"
        case timeoutSeconds = "timeout_seconds"
        case providerStatus = "provider_status"
        case providerError = "provider_error"
        case availableModels = "available_models"
        case roles
    }
}

struct TrinityRoleStatusMap: Decodable {
    let generator: TrinityRoleStatus?
    let refiner: TrinityRoleStatus?
    let evaluator: TrinityRoleStatus?
}

struct TrinityRoleStatus: Decodable {
    let provider: String?
    let model: String?
    let temperature: Double?
    let keepAlive: String?
    let installed: Bool?

    enum CodingKeys: String, CodingKey {
        case provider
        case model
        case temperature
        case keepAlive = "keep_alive"
        case installed
    }
}

struct TrinityAvailableModel: Decodable, Hashable, Identifiable {
    let name: String
    let size: Int64?
    let modifiedAt: String?

    var id: String { name }

    enum CodingKeys: String, CodingKey {
        case name
        case size
        case modifiedAt = "modified_at"
    }
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

struct ReplyConversationListResponse: Decodable {
    let contacts: [ReplyConversation]
    let hasMore: Bool
    let total: Int
}

struct ReplyConversation: Decodable, Identifiable, Hashable {
    let handle: String
    let latestHandle: String?
    let path: String?
    let channel: String?
    let source: String?
    let displayName: String?
    let presentationDisplayName: String?
    let lastMessage: String?
    let preview: String?
    let previewDate: String?
    let count: Int?
    let countIn: Int?
    let countOut: Int?

    var id: String { handle }

    var resolvedTitle: String {
        let candidate = (presentationDisplayName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? presentationDisplayName
            : displayName) ?? handle
        return candidate
    }

    var resolvedPreview: String {
        let candidate = (preview?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? preview
            : lastMessage) ?? ""
        return candidate
    }

    var unreadLabel: String {
        let value = max(count ?? 0, 0)
        return value > 99 ? "99+" : "\(value)"
    }
}

struct ReplyThreadResponse: Decodable {
    let messages: [ReplyMessage]
    let hasMore: Bool?
    let total: Int?
}

struct ReplyMessage: Decodable, Identifiable, Hashable {
    let id: String
    let role: String?
    let isFromMe: Bool?
    let text: String?
    let date: String?
    let channel: String?
    let source: String?
    let path: String?
    let handle: String?

    enum CodingKeys: String, CodingKey {
        case id
        case role
        case isFromMe = "is_from_me"
        case text
        case date
        case channel
        case source
        case path
        case handle
    }

    var authoredByMe: Bool {
        if let isFromMe { return isFromMe }
        return role == "me"
    }
}

struct ReplyProfile: Decodable {
    let handle: String
    let contactId: String?
    let visibilityState: String?
    let displayName: String?
    let presentationDisplayName: String?
    let profession: String?
    let relationship: String?
    let intro: String?
    let company: String?
    let linkedinUrl: String?
    let draft: String?
    let notes: [ReplyProfileNote]?
    let channels: ReplyProfileChannels?
}

struct ReplyProfileDraft: Equatable {
    var displayName: String
    var profession: String
    var company: String
    var relationship: String
    var linkedinURL: String
    var intro: String

    static let empty = ReplyProfileDraft(
        displayName: "",
        profession: "",
        company: "",
        relationship: "",
        linkedinURL: "",
        intro: ""
    )

    init(
        displayName: String,
        profession: String,
        company: String,
        relationship: String,
        linkedinURL: String,
        intro: String
    ) {
        self.displayName = displayName
        self.profession = profession
        self.company = company
        self.relationship = relationship
        self.linkedinURL = linkedinURL
        self.intro = intro
    }

    init(profile: ReplyProfile) {
        self.displayName = profile.displayName ?? profile.presentationDisplayName ?? ""
        self.profession = profile.profession ?? ""
        self.company = profile.company ?? ""
        self.relationship = profile.relationship ?? ""
        self.linkedinURL = profile.linkedinUrl ?? ""
        self.intro = profile.intro ?? ""
    }
}

struct ReplyProfileNote: Decodable, Hashable {
    let text: String?
}

struct ReplyProfileChannels: Decodable, Hashable {
    let phone: [String]?
    let email: [String]?
    let whatsapp: [String]?
    let linkedin: [String]?
    let imessage: [String]?
}

enum ReplyWorkspaceMode: String, CaseIterable, Identifiable {
    case conversations
    case dashboard

    var id: String { rawValue }

    var label: String {
        switch self {
        case .conversations: "Conversations"
        case .dashboard: "Dashboard"
        }
    }

    var systemImage: String {
        switch self {
        case .conversations: "message"
        case .dashboard: "square.grid.2x2"
        }
    }
}

enum ReplyMessageChannel: String, CaseIterable, Identifiable {
    case imessage
    case whatsapp
    case linkedin
    case email

    var id: String { rawValue }

    var label: String {
        switch self {
        case .imessage: "iMessage"
        case .whatsapp: "WhatsApp"
        case .linkedin: "LinkedIn"
        case .email: "Email"
        }
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
