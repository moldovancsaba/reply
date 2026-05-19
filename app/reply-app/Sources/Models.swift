import Foundation

struct HealthPayload: Decodable {
    let ok: Bool?
    let version: String?
    let status: String?
    let statusMessage: String?
    let launch: LaunchHealth?
    let httpPort: Int?
    let httpHost: String?
    let services: [String: ServiceHealth]?
    let channels: [String: ChannelHealth]?
    let preflight: PreflightPayload?
    let stats: ReplyConversationStats?
}

struct LaunchHealth: Decodable {
    let stage: String?
    let ready: Bool?
    let startedAt: String?
    let readyAt: String?
    let message: String?
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
    let conversationId: String?
    let handle: String
    let latestHandle: String?
    let path: String?
    let channel: String?
    let channels: [String]?
    let allowedChannels: [String]?
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

    var normalizedChannels: [ReplyMessageChannel] {
        let values = (channels?.isEmpty == false ? channels : (channel != nil ? [channel!] : [])) ?? []
        return values.compactMap { ReplyMessageChannel(rawValue: $0.lowercased()) }
    }

    var normalizedAllowedChannels: [ReplyMessageChannel] {
        (allowedChannels ?? []).compactMap { ReplyMessageChannel(rawValue: $0.lowercased()) }
    }

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
    let order: String?
    let offset: Int?
    let limit: Int?
    let conversationId: String?
    let channels: [String]?
    let allowedChannels: [String]?
    let defaultChannel: String?
    let conversationKind: String?
    let conversationTitle: String?
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
    let senderDisplay: String?

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
        case senderDisplay
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
    var draft: String

    static let empty = ReplyProfileDraft(
        displayName: "",
        profession: "",
        company: "",
        relationship: "",
        linkedinURL: "",
        intro: "",
        draft: ""
    )

    init(
        displayName: String,
        profession: String,
        company: String,
        relationship: String,
        linkedinURL: String,
        intro: String,
        draft: String
    ) {
        self.displayName = displayName
        self.profession = profession
        self.company = company
        self.relationship = relationship
        self.linkedinURL = linkedinURL
        self.intro = intro
        self.draft = draft
    }

    init(profile: ReplyProfile) {
        self.displayName = profile.displayName ?? profile.presentationDisplayName ?? ""
        self.profession = profile.profession ?? ""
        self.company = profile.company ?? ""
        self.relationship = profile.relationship ?? ""
        self.linkedinURL = profile.linkedinUrl ?? ""
        self.intro = profile.intro ?? ""
        self.draft = profile.draft ?? ""
    }
}

struct ReplyPreparedDraftResponse: Decodable {
    let status: String?
    let stale: Bool?
    let suggestion: String?
    let explanation: String?
    let runtimeMode: String?
    let rankedDraftSet: ReplyRankedDraftSet?

    enum CodingKeys: String, CodingKey {
        case status
        case stale
        case suggestion
        case explanation
        case runtimeMode
        case rankedDraftSet
    }
}

struct ReplyRankedDraftSet: Decodable {
    let cycleId: String?
    let threadRef: String?
    let channel: String?
    let traceRef: String?
    let contractVersion: String?
    let drafts: [ReplyDraftCandidate]?

    enum CodingKeys: String, CodingKey {
        case cycleId = "cycle_id"
        case threadRef = "thread_ref"
        case channel
        case traceRef = "trace_ref"
        case contractVersion = "contract_version"
        case drafts
    }
}

struct ReplyDraftCandidate: Decodable {
    let companyId: String?
    let candidateId: String?
    let rank: Int?
    let draftText: String?
    let rationale: String?

    enum CodingKeys: String, CodingKey {
        case companyId = "company_id"
        case candidateId = "candidate_id"
        case rank
        case draftText = "draft_text"
        case rationale
    }
}

struct ReplyDraftTelemetryContext: Equatable {
    let companyId: String?
    let cycleId: String
    let threadRef: String
    let channel: String
    let selectedCandidateId: String?
    let selectedDraftText: String
    let originalDraftText: String
    let generatedAtMs: Int64

    init?(
        handle: String,
        response: ReplyPreparedDraftResponse,
        generatedAt: Date = Date()
    ) {
        let rankedDraftSet = response.rankedDraftSet
        let cycleId = String(rankedDraftSet?.cycleId ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let threadRef = String(rankedDraftSet?.threadRef ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let channel = String(rankedDraftSet?.channel ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let drafts = rankedDraftSet?.drafts ?? []
        let topDraft = drafts.first
        let selectedDraftText = String(topDraft?.draftText ?? response.suggestion ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if cycleId.isEmpty || threadRef.isEmpty || channel.isEmpty || selectedDraftText.isEmpty {
            return nil
        }
        self.companyId = topDraft?.companyId
        self.cycleId = cycleId
        self.threadRef = threadRef
        self.channel = channel
        self.selectedCandidateId = {
            let value = String(topDraft?.candidateId ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return value.isEmpty ? nil : value
        }()
        self.selectedDraftText = selectedDraftText
        self.originalDraftText = selectedDraftText
        self.generatedAtMs = Int64(generatedAt.timeIntervalSince1970 * 1000)
    }

    var sendPayload: [String: Any] {
        var payload: [String: Any] = [
            "cycleId": cycleId,
            "threadRef": threadRef,
            "channel": channel,
            "selectedDraftText": selectedDraftText,
            "originalDraftText": originalDraftText,
            "generatedAtMs": generatedAtMs,
        ]
        if let companyId, !companyId.isEmpty {
            payload["companyId"] = companyId
        }
        if let selectedCandidateId, !selectedCandidateId.isEmpty {
            payload["selectedCandidateId"] = selectedCandidateId
        }
        return payload
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
