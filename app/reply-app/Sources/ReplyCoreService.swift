import AppKit
import Foundation

@MainActor
final class ReplyCoreService: ObservableObject {
    @Published var runtimeState: ReplyRuntimeState = .unknown
    @Published var health: HealthPayload?
    @Published var baseURL: URL?
    @Published var lastRefreshAt: Date?
    @Published var launchErrorMessage: String = ""
    @Published var logLines: [String] = []
    @Published var managementState: ManagementState = .unknown
    @Published var settingsDraft: NativeSettingsDraft = .empty
    @Published var settingsLoadError: String = ""
    @Published var settingsSaveError: String = ""
    @Published var isLoadingSettings = false
    @Published var isSavingSettings = false
    @Published var syncInFlight: Set<SyncChannel> = []
    @Published var runtimeInfo: NativeRuntimeInfo?
    @Published var workspaceMode: ReplyWorkspaceMode = .conversations
    @Published var conversations: [ReplyConversation] = []
    @Published var selectedConversationHandle: String?
    @Published var messages: [ReplyMessage] = []
    @Published var currentConversationId: String?
    @Published var currentConversationKind: String = "direct"
    @Published var currentConversationTitle: String = ""
    @Published var conversationTotalCount: Int = 0
    @Published var conversationsHasMore = false
    @Published var isLoadingMoreConversations = false
    @Published var threadGapRemaining: Int = 0
    @Published var isLoadingMoreThreadGap = false
    @Published var selectedProfile: ReplyProfile?
    @Published var draftMessage: String = "" {
        didSet {
            guard !suppressDraftTracking else { return }
            if let handle = selectedConversationHandle, composerSeedHandle == handle {
                composerHasManualEdits = true
            }
        }
    }
    @Published var selectedChannel: ReplyMessageChannel = .imessage
    @Published var currentConversationChannels: [ReplyMessageChannel] = []
    @Published var allowedReplyChannels: [ReplyMessageChannel] = []
    @Published var conversationSearch: String = ""
    @Published var isLoadingConversations = false
    @Published var isLoadingMessages = false
    @Published var isLoadingProfile = false
    @Published var isSavingProfile = false
    @Published var sendErrorMessage: String = ""
    @Published var workspaceErrorMessage: String = ""
    @Published var profileErrorMessage: String = ""
    @Published var profileSaveErrorMessage: String = ""
    @Published var sendInFlight = false
    @Published var regenerateDraftInFlight = false
    @Published var conversationRefreshInFlight = false
    @Published var profileDraft: ReplyProfileDraft = .empty

    private var suppressDraftTracking = false
    private var composerSeedHandle: String?
    private var composerHasManualEdits = false
    private var currentDraftTelemetryContext: ReplyDraftTelemetryContext?
    private var currentDraftSelectionReportKey: String?

    private var launchProcess: Process?
    private var refreshTask: Task<Void, Never>?
    private var launchWatchTask: Task<Void, Never>?
    private var mirrorRefreshTask: Task<Void, Never>?
    private let preferredPorts = Array(45311...45326) + Array(45431...45446)
    private var hasAttemptedAutoLaunch = false
    private var consecutiveHealthFailures = 0
    private var lastIMessageMirrorAt: Date?
    private var lastOllamaStartAttemptAt: Date?
    private var launchDeadline: Date?
    private let nativeClientToken: String
    private let conversationPageSize = 50
    private let threadWindowSize = 20
    private var oldestThreadMessages: [ReplyMessage] = []
    private var newestThreadMessages: [ReplyMessage] = []

    init() {
        self.nativeClientToken = Self.loadOrCreateNativeClientToken()
    }

    deinit {
        refreshTask?.cancel()
        launchWatchTask?.cancel()
        mirrorRefreshTask?.cancel()
    }

    func startMonitoring() {
        if refreshTask != nil { return }
        refreshTask = Task {
            while !Task.isCancelled {
                await refreshHealth()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    func refreshHealth() async {
        scheduleAppleSourceMirrorRefreshIfNeeded()
        if let (detected, payload) = await detectReachableHealth() {
            health = payload
            baseURL = detected
            lastRefreshAt = Date()
            hasAttemptedAutoLaunch = true
            consecutiveHealthFailures = 0
            if isLaunchReady(payload) {
                runtimeState = .online
                launchDeadline = nil
                if payload.status == "online" || payload.ok == true {
                    launchErrorMessage = ""
                }
                await detectManagementStateIfNeeded()
                await autoStartOllamaIfNeeded(payload)
                if !isLoadingSettings {
                    await loadSettingsIfNeeded()
                }
                if conversations.isEmpty && workspaceMode == .conversations {
                    await loadWorkspaceIfNeeded()
                }
            } else {
                runtimeState = .starting
                launchErrorMessage = launchProgressMessage(from: payload)
            }
        } else if shouldPreserveStartingState() {
            runtimeState = .starting
            lastRefreshAt = Date()
            if launchErrorMessage.isEmpty {
                launchErrorMessage = "Starting local runtime..."
            }
        } else {
            handleHealthMiss("{reply} runtime health probe did not respond.")
        }
    }

    func loadWorkspaceIfNeeded() async {
        guard runtimeState == .online, baseURL != nil else { return }
        if conversations.isEmpty {
            await loadConversations()
        } else if let handle = selectedConversationHandle, !messages.isEmpty == false {
            await loadConversation(handle: handle)
        }
    }

    func loadConversations(reset: Bool = true) async {
        guard let baseURL else { return }
        if reset {
            isLoadingConversations = true
        } else {
            if isLoadingMoreConversations || !conversationsHasMore { return }
            isLoadingMoreConversations = true
        }
        workspaceErrorMessage = ""
        defer {
            if reset {
                isLoadingConversations = false
            } else {
                isLoadingMoreConversations = false
            }
        }
        do {
            var components = URLComponents(url: baseURL.appending(path: "api/conversations"), resolvingAgainstBaseURL: false)
            let offset = reset ? 0 : conversations.count
            components?.queryItems = [
                URLQueryItem(name: "offset", value: "\(offset)"),
                URLQueryItem(name: "limit", value: "\(conversationPageSize)"),
                URLQueryItem(name: "sort", value: "newest"),
            ]
            if !conversationSearch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                components?.queryItems?.append(URLQueryItem(name: "q", value: conversationSearch))
            }
            guard let url = components?.url else { return }
            let payload: ReplyConversationListResponse = try await requestJSON(url: url)
            conversationTotalCount = payload.total
            conversationsHasMore = payload.hasMore
            if reset {
                conversations = payload.contacts
            } else {
                let existing = Set(conversations.map(\.id))
                conversations.append(contentsOf: payload.contacts.filter { !existing.contains($0.id) })
            }

            if workspaceMode == .conversations {
                let selectedStillExists = selectedConversationHandle.flatMap { current in
                    conversations.first(where: { $0.handle == current })?.handle
                }
                let nextHandle = selectedStillExists ?? conversations.first?.handle
                if let nextHandle {
                    await loadConversation(handle: nextHandle)
                } else {
                    selectedConversationHandle = nil
                    messages = []
                    currentConversationId = nil
                    currentConversationKind = "direct"
                    currentConversationTitle = ""
                    selectedProfile = nil
                    profileDraft = .empty
                }
            }
        } catch {
            workspaceErrorMessage = error.localizedDescription
        }
    }

    func loadMoreConversationsIfNeeded(current conversation: ReplyConversation) async {
        guard conversationsHasMore else { return }
        guard conversation.id == conversations.last?.id else { return }
        await loadConversations(reset: false)
    }

    func loadConversation(handle: String) async {
        guard !handle.isEmpty else { return }
        let previousHandle = selectedConversationHandle
        workspaceMode = .conversations
        selectedConversationHandle = handle
        if previousHandle != handle {
            applyComposerDraft("", for: handle, preserveManualEdits: false, draftTelemetryContext: nil)
            sendErrorMessage = ""
        }
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadMessages(handle: handle) }
            group.addTask { await self.loadProfile(handle: handle) }
        }
    }

    func loadMessages(handle: String) async {
        guard let baseURL else { return }
        isLoadingMessages = true
        threadGapRemaining = 0
        defer { isLoadingMessages = false }
        do {
            async let newestTask = loadThreadPage(baseURL: baseURL, handle: handle, offset: 0, limit: threadWindowSize, order: "newest")
            async let oldestTask = loadThreadPage(baseURL: baseURL, handle: handle, offset: 0, limit: threadWindowSize, order: "oldest")
            let newestPayload = try await newestTask
            let oldestPayload = try await oldestTask
            if selectedConversationHandle == handle {
                newestThreadMessages = newestPayload.messages
                oldestThreadMessages = oldestPayload.messages
                let merged = dedupeMessages(oldestThreadMessages + newestThreadMessages)
                messages = merged.sorted(by: messageAscending)
                currentConversationId = newestPayload.conversationId ?? oldestPayload.conversationId
                currentConversationKind = newestPayload.conversationKind ?? oldestPayload.conversationKind ?? "direct"
                currentConversationTitle = newestPayload.conversationTitle ?? oldestPayload.conversationTitle ?? ""
                let total = newestPayload.total ?? oldestPayload.total ?? merged.count
                threadGapRemaining = max(0, total - merged.count)
                currentConversationChannels = normalizedChannels(newestPayload.channels ?? oldestPayload.channels)
                allowedReplyChannels = normalizedChannels(newestPayload.allowedChannels ?? oldestPayload.allowedChannels)
                selectedChannel = resolveSelectedChannel(
                    handle: handle,
                    defaultChannelRaw: newestPayload.defaultChannel ?? oldestPayload.defaultChannel,
                    messages: messages,
                    allowedChannels: allowedReplyChannels,
                    visibleChannels: currentConversationChannels
                )
            }
        } catch {
            if selectedConversationHandle == handle {
                workspaceErrorMessage = error.localizedDescription
                messages = []
                currentConversationId = nil
                currentConversationKind = "direct"
                currentConversationTitle = ""
                oldestThreadMessages = []
                newestThreadMessages = []
                threadGapRemaining = 0
                currentConversationChannels = []
                allowedReplyChannels = []
            }
        }
    }

    func loadMoreThreadGap() async {
        guard let baseURL, let handle = selectedConversationHandle else { return }
        guard !isLoadingMoreThreadGap else { return }
        guard threadGapRemaining > 0 else { return }
        isLoadingMoreThreadGap = true
        defer { isLoadingMoreThreadGap = false }

        do {
            let payload = try await loadThreadPage(
                baseURL: baseURL,
                handle: handle,
                offset: newestThreadMessages.count,
                limit: min(threadWindowSize, threadGapRemaining),
                order: "newest"
            )
            let newChunk = payload.messages.filter { candidate in
                !messages.contains(where: { $0.id == candidate.id })
            }
            newestThreadMessages.append(contentsOf: newChunk)
            messages = dedupeMessages(oldestThreadMessages + newestThreadMessages).sorted(by: messageAscending)
            let total = payload.total ?? messages.count
            threadGapRemaining = max(0, total - messages.count)
        } catch {
            workspaceErrorMessage = error.localizedDescription
        }
    }

    func loadProfile(handle: String) async {
        guard let baseURL else { return }
        isLoadingProfile = true
        profileErrorMessage = ""
        defer { isLoadingProfile = false }
        do {
            var components = URLComponents(url: baseURL.appending(path: "api/kyc"), resolvingAgainstBaseURL: false)
            components?.queryItems = [URLQueryItem(name: "handle", value: handle)]
            guard let url = components?.url else { return }
            let payload: ReplyProfile = try await requestJSON(url: url, protectedRoute: true)
            if selectedConversationHandle == handle {
                selectedProfile = payload
                profileDraft = ReplyProfileDraft(profile: payload)
            }
            await seedComposerDraft(for: handle, profile: payload)
        } catch {
            if selectedConversationHandle == handle {
                selectedProfile = nil
                profileDraft = .empty
                profileErrorMessage = error.localizedDescription
            }
        }
    }

    func refreshCurrentConversation() async {
        guard let handle = selectedConversationHandle else { return }
        if conversationRefreshInFlight { return }
        conversationRefreshInFlight = true
        workspaceErrorMessage = ""
        defer { conversationRefreshInFlight = false }

        if let syncChannel = currentSyncChannel {
            await triggerSync(syncChannel)
        }
        await loadConversation(handle: handle)
        await loadConversations()
        await refreshHealth()
    }

    func saveSelectedProfile() async {
        guard let baseURL, let handle = selectedConversationHandle else { return }
        if isSavingProfile { return }
        isSavingProfile = true
        profileSaveErrorMessage = ""

        struct Payload: Encodable {
            let handle: String
            let displayName: String
            let profession: String
            let company: String
            let relationship: String
            let linkedinUrl: String
            let intro: String
            let approval: Approval
        }

        struct Approval: Encodable {
            let confirmed: Bool
            let source: String
            let at: String
        }

        do {
            let url = baseURL.appending(path: "api/kyc")
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            applyProtectedHeaders(to: &request, includeHumanApproval: true)
            request.httpBody = try JSONEncoder().encode(Payload(
                handle: handle,
                displayName: profileDraft.displayName,
                profession: profileDraft.profession,
                company: profileDraft.company,
                relationship: profileDraft.relationship,
                linkedinUrl: profileDraft.linkedinURL,
                intro: profileDraft.intro,
                approval: Approval(
                    confirmed: true,
                    source: "native-profile-save",
                    at: ISO8601DateFormatter().string(from: Date())
                )
            ))
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw NSError(domain: "ReplyCoreService", code: 7, userInfo: [NSLocalizedDescriptionKey: "Saving profile failed."])
            }
            isSavingProfile = false
            await loadProfile(handle: handle)
            Task { @MainActor in
                await self.loadConversations()
            }
        } catch {
            isSavingProfile = false
            profileSaveErrorMessage = error.localizedDescription
        }
    }

    func sendCurrentMessage() async {
        guard let baseURL, let handle = selectedConversationHandle else { return }
        let text = draftMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard allowedReplyChannels.contains(selectedChannel) else {
            sendErrorMessage = "This conversation is not allowed to send on \(selectedChannel.label)."
            return
        }
        sendInFlight = true
        sendErrorMessage = ""
        defer { sendInFlight = false }
        do {
            let endpoint: String
            switch selectedChannel {
            case .imessage: endpoint = "api/send-imessage"
            case .whatsapp: endpoint = "api/send-whatsapp"
            case .linkedin: endpoint = "api/send-linkedin"
            case .email: endpoint = "api/send-email"
            }
            var request = URLRequest(url: baseURL.appending(path: endpoint))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            applyProtectedHeaders(to: &request, includeHumanApproval: true)
            var payload: [String: Any] = [
                "recipient": handle,
                "text": text,
                "trigger": [
                    "kind": "human_enter",
                    "at": ISO8601DateFormatter().string(from: Date())
                ],
                "approval": [
                    "confirmed": true,
                    "source": "native-send",
                    "at": ISO8601DateFormatter().string(from: Date())
                ]
            ]
            if let conversationId = currentConversationId, !conversationId.isEmpty {
                payload["conversationId"] = conversationId
            }
            if let draftTelemetryContext = currentDraftTelemetryContext {
                payload["draftContext"] = draftTelemetryContext.sendPayload
            }
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw NSError(domain: "ReplyCoreService", code: 5, userInfo: [NSLocalizedDescriptionKey: "Send failed."])
            }
            if let draftTelemetryContext = currentDraftTelemetryContext {
                if draftShouldEmitEditedMemoryEvent(finalText: text, draftContext: draftTelemetryContext) {
                    await reportDraftEditedMemoryEvent(handle: handle, finalText: text, draftContext: draftTelemetryContext)
                }
            } else {
                await reportGenericSendFeedback(handle: handle, finalText: text)
            }
            applyComposerDraft("", for: handle, preserveManualEdits: false, draftTelemetryContext: nil)
            await loadConversation(handle: handle)
            await loadConversations()
        } catch {
            sendErrorMessage = error.localizedDescription
        }
    }

    func regenerateDraft() async {
        guard let handle = selectedConversationHandle else { return }
        if regenerateDraftInFlight { return }
        regenerateDraftInFlight = true
        sendErrorMessage = ""
        defer { regenerateDraftInFlight = false }

        let existingText = draftMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await reportRegenerateFeedback(handle: handle, existingText: existingText)
            let prepared = try await fetchPreparedDraft(for: handle, refresh: true)
            let suggestion = (prepared.suggestion ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !suggestion.isEmpty else {
                throw NSError(domain: "ReplyCoreService", code: 8, userInfo: [NSLocalizedDescriptionKey: "No regenerated draft is available for this conversation."])
            }
            let context = ReplyDraftTelemetryContext(handle: handle, response: prepared)
            applyComposerDraft(suggestion, for: handle, preserveManualEdits: false, draftTelemetryContext: context)
            await reportDraftSelectedIfNeeded(handle: handle, draftContext: context, notes: "native_regenerate_auto_apply")
        } catch {
            sendErrorMessage = error.localizedDescription
        }
    }

    func launchReply() {
        guard launchProcess == nil || launchProcess?.isRunning == false else {
            return
        }
        launchWatchTask?.cancel()
        runtimeState = .starting
        launchErrorMessage = "Starting local runtime..."
        health = nil
        baseURL = nil
        consecutiveHealthFailures = 0
        hasAttemptedAutoLaunch = true
        launchDeadline = Date().addingTimeInterval(45)

        guard let runtimeRoot = resolveRuntimeRoot() else {
            runtimeState = .error("Could not resolve the bundled {reply} runtime root.")
            return
        }
        guard let runtimeBinary = bundledRuntimeBinaryURL() else {
            runtimeState = .error("Could not find the bundled reply runtime binary.")
            return
        }
        guard let helperBinary = protectedDataHelperURL() else {
            runtimeState = .error("Could not find the bundled {reply} helper.")
            return
        }

        scheduleAppleSourceMirrorRefreshIfNeeded(force: true)
        stopLegacyRepoRuntime()

        let process = Process()
        let output = Pipe()
        process.executableURL = runtimeBinary
        process.arguments = [runtimeRoot.appending(path: "server.js").path]
        process.currentDirectoryURL = runtimeRoot
        var env = ProcessInfo.processInfo.environment
        env["REPLY_DATA_HOME"] = replyDataHome.path
        env["REPLY_LOG_HOME"] = replyLogHome.path
        env["REPLY_RELEASE_MODE"] = "1"
        env["REPLY_BRAIN_RUNTIME"] = "trinity"
        env["USE_TRINITY_DRAFTS"] = "1"
        env["REPLY_ALLOW_LEGACY_BRAIN"] = "0"
        env["REPLY_ALLOW_EXPERIMENTAL_BRAIN_MODES"] = "0"
        env["REPLY_NATIVE_CLIENT_TOKEN"] = nativeClientToken
        env["REPLY_HELPER_PATH"] = helperBinary.path
        env["TRINITY_RUNTIME_ROOT"] = runtimeRoot.appending(path: "trinity-runtime").path
        env["PORT"] = String(preferredPorts.first ?? 45311)
        if let mirrored = mirroredIMessageDbURL(), FileManager.default.fileExists(atPath: mirrored.path) {
            env["REPLY_IMESSAGE_DB_PATH"] = mirrored.path
        }
        env["PATH"] = "\(runtimeBinary.deletingLastPathComponent().path):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        process.environment = env
        process.standardOutput = output
        process.standardError = output

        let reader = output.fileHandleForReading
        reader.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let line = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor in
                self?.appendLog(line)
            }
        }

        process.terminationHandler = { [weak self] proc in
            Task { @MainActor in
                self?.launchProcess = nil
                if proc.terminationStatus != 0 {
                    self?.launchDeadline = nil
                    self?.runtimeState = .error("{reply} runtime exited with code \(proc.terminationStatus).")
                    self?.launchErrorMessage = "{reply} runtime exited with code \(proc.terminationStatus)."
                }
            }
        }

        do {
            try process.run()
            launchProcess = process
            beginLaunchWatch()
        } catch {
            runtimeState = .error(error.localizedDescription)
            launchErrorMessage = error.localizedDescription
        }
    }

    func restartReply() {
        stopReply()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            self.launchReply()
        }
    }

    func stopReply() {
        launchWatchTask?.cancel()
        launchWatchTask = nil
        launchDeadline = nil
        if let launchProcess, launchProcess.isRunning {
            launchProcess.terminate()
            self.launchProcess = nil
        } else if let repoRoot = resolveRepoRoot() {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/make")
            process.arguments = ["stop"]
            process.currentDirectoryURL = repoRoot
            var env = ProcessInfo.processInfo.environment
            env["REPLY_DATA_HOME"] = replyDataHome.path
            env["REPLY_LOG_HOME"] = replyLogHome.path
            process.environment = env
            process.standardOutput = Pipe()
            process.standardError = Pipe()
            try? process.run()
        }
        runtimeState = .offline
    }

    func openInBrowser() {
        guard let url = baseURL else { return }
        NSWorkspace.shared.open(url)
    }

    func openLogs() {
        let path = health?.services?["worker"]?.logPath ?? replyLogHome.path
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    func openWorkerLog() {
        let path = health?.services?["worker"]?.logPath ?? replyLogHome.appending(path: "worker.log").path
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    func openFullDiskAccessSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles") {
            NSWorkspace.shared.open(url)
        }
    }

    func loadSettings(force: Bool = false) async {
        guard let baseURL else {
            settingsLoadError = "The {reply} runtime is not connected."
            return
        }
        if isLoadingSettings { return }
        if !force, settingsLoadError.isEmpty, hasLoadedSettingsDraft {
            return
        }
        isLoadingSettings = true
        settingsLoadError = ""
        defer { isLoadingSettings = false }
        do {
            let url = baseURL.appending(path: "api/settings")
            var request = URLRequest(url: url)
            applyProtectedHeaders(to: &request, includeHumanApproval: false)
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw NSError(domain: "ReplyCoreService", code: 2, userInfo: [NSLocalizedDescriptionKey: "Settings endpoint returned a non-200 response."])
            }
            let payload = try JSONDecoder().decode(NativeSettingsPayload.self, from: data)
            settingsDraft = NativeSettingsDraft(payload: payload)
            runtimeInfo = payload.runtime
        } catch {
            settingsLoadError = error.localizedDescription
        }
    }

    func saveSettings() async {
        guard let baseURL else {
            settingsSaveError = "The {reply} runtime is not connected."
            return
        }
        if isSavingSettings { return }
        isSavingSettings = true
        settingsSaveError = ""
        defer { isSavingSettings = false }

        struct Payload: Encodable {
            let ai: NativeAISettings
            let worker: NativeWorkerSettings
            let health: NativeHealthSettings
        }

        do {
            let url = baseURL.appending(path: "api/settings")
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            applyProtectedHeaders(to: &request, includeHumanApproval: true)
            request.httpBody = try JSONEncoder().encode(Payload(
                ai: settingsDraft.ai,
                worker: settingsDraft.worker,
                health: settingsDraft.health
            ))
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw NSError(domain: "ReplyCoreService", code: 3, userInfo: [NSLocalizedDescriptionKey: "Saving settings failed."])
            }
            await loadSettings(force: true)
        } catch {
            settingsSaveError = error.localizedDescription
        }
    }

    func triggerSync(_ channel: SyncChannel) async {
        guard let baseURL else { return }
        if syncInFlight.contains(channel) { return }
        syncInFlight.insert(channel)
        defer { syncInFlight.remove(channel) }
        do {
            let url = baseURL.appending(path: "api/sync-\(channel.rawValue)")
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            applyProtectedHeaders(to: &request, includeHumanApproval: true)
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "source": channel.rawValue,
                "approval": [
                    "confirmed": true,
                    "source": "native-sync-\(channel.rawValue)",
                    "at": ISO8601DateFormatter().string(from: Date())
                ]
            ])
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw NSError(domain: "ReplyCoreService", code: 4, userInfo: [NSLocalizedDescriptionKey: "Sync trigger failed for \(channel.title)."])
            }
            await refreshHealth()
        } catch {
            launchErrorMessage = error.localizedDescription
        }
    }

    var nodeBinaryHint: String {
        if let bundled = protectedDataHelperURL() {
            return bundled.path
        }
        let candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return candidate
        }
        return "reply runtime"
    }

    var replyDataHome: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Library")
            .appending(path: "Application Support")
            .appending(path: "reply")
    }

    var replyLogHome: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Library")
            .appending(path: "Logs")
            .appending(path: "reply")
    }

    private var appleMirrorHome: URL {
        replyDataHome.appending(path: "apple-source-mirrors")
    }

    private func mirroredIMessageDbURL() -> URL? {
        appleMirrorHome.appending(path: "imessage").appending(path: "chat.db")
    }

    private func appendLog(_ raw: String) {
        let trimmed = raw
            .split(whereSeparator: \.isNewline)
            .map(String.init)
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard !trimmed.isEmpty else { return }
        logLines.append(contentsOf: trimmed.suffix(10))
        if logLines.count > 200 {
            logLines.removeFirst(logLines.count - 200)
        }
    }

    private func bundledRuntimeBinaryURL() -> URL? {
        if let path = Bundle.main.path(forResource: "reply runtime", ofType: nil) {
            let url = URL(fileURLWithPath: path)
            if FileManager.default.isExecutableFile(atPath: url.path) {
                return url
            }
        }
        return nil
    }

    private func loadSettingsIfNeeded() async {
        if hasLoadedSettingsDraft && settingsLoadError.isEmpty {
            return
        }
        await loadSettings(force: settingsLoadError.isEmpty == false)
    }

    private var hasLoadedSettingsDraft: Bool {
        !(settingsDraft.ai.ollamaModel ?? "").isEmpty ||
        !(settingsDraft.ai.annotationOllamaModel ?? "").isEmpty ||
        !(settingsDraft.ai.kycOllamaModel ?? "").isEmpty ||
        !(settingsDraft.ai.ollamaHost ?? "").isEmpty
    }

    private func protectedDataHelperURL() -> URL? {
        let helper = Bundle.main.bundleURL
            .appending(path: "Contents")
            .appending(path: "Helpers")
            .appending(path: "reply-helper")
        return FileManager.default.isExecutableFile(atPath: helper.path) ? helper : nil
    }

    private func bundledRuntimeRootURL() -> URL? {
        let root = Bundle.main.bundleURL
            .appending(path: "Contents")
            .appending(path: "Resources")
            .appending(path: "reply-core")
            .appending(path: "chat")
        let server = root.appending(path: "server.js")
        return FileManager.default.fileExists(atPath: server.path) ? root : nil
    }

    private func scheduleAppleSourceMirrorRefreshIfNeeded(force: Bool = false) {
        let now = Date()
        if !force, let last = lastIMessageMirrorAt, now.timeIntervalSince(last) < 8 {
            return
        }
        if mirrorRefreshTask != nil {
            return
        }
        lastIMessageMirrorAt = now
        guard let helper = protectedDataHelperURL() else {
            appendMirrorLog("mirror failed: protected data helper missing")
            return
        }

        let targetRoot = appleMirrorHome.appending(path: "imessage")
        let logFile = replyLogHome.appending(path: "imessage-mirror.log")
        mirrorRefreshTask = Task.detached(priority: .utility) { [helper, targetRoot, logFile] in
            do {
                try FileManager.default.createDirectory(at: targetRoot, withIntermediateDirectories: true)
                let process = Process()
                process.executableURL = helper
                process.arguments = [
                    "mirror-imessage",
                    "--target-root", targetRoot.path,
                    "--log-file", logFile.path
                ]
                process.standardOutput = Pipe()
                process.standardError = Pipe()
                try process.run()
                process.waitUntilExit()
                if process.terminationStatus != 0 {
                    await MainActor.run {
                        self.appendMirrorLog("mirror failed: helper exit \(process.terminationStatus)")
                    }
                }
            } catch {
                await MainActor.run {
                    self.appendMirrorLog("mirror failed: \(error.localizedDescription)")
                }
            }
            await MainActor.run {
                self.mirrorRefreshTask = nil
            }
        }
    }

    private func appendMirrorLog(_ line: String) {
        do {
            try FileManager.default.createDirectory(at: replyLogHome, withIntermediateDirectories: true)
            let url = replyLogHome.appending(path: "imessage-mirror.log")
            let stamp = ISO8601DateFormatter().string(from: Date())
            let data = ("[\(stamp)] \(line)\n").data(using: .utf8) ?? Data()
            if FileManager.default.fileExists(atPath: url.path) {
                let handle = try FileHandle(forWritingTo: url)
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
                try handle.close()
            } else {
                try data.write(to: url)
            }
        } catch {
            // Avoid surfacing logging failures into the runtime flow.
        }
    }

    private func autoStartOllamaIfNeeded(_ payload: HealthPayload) async {
        guard payload.services?["ollama"]?.status != "online" else { return }
        let now = Date()
        if let last = lastOllamaStartAttemptAt, now.timeIntervalSince(last) < 30 {
            return
        }
        lastOllamaStartAttemptAt = now

        let fm = FileManager.default
        if fm.fileExists(atPath: "/Applications/Ollama.app") {
            NSWorkspace.shared.open(URL(fileURLWithPath: "/Applications/Ollama.app"))
            return
        }

        let candidates = ["/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"]
        guard let binary = candidates.first(where: { fm.isExecutableFile(atPath: $0) }) else { return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: binary)
        process.arguments = ["serve"]
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        try? process.run()
    }

    private func detectReachableHealth() async -> (URL, HealthPayload)? {
        if let current = baseURL {
            do {
                let payload = try await fetchHealth(from: current)
                return (current, payload)
            } catch {
                // Fall through to port scan. We preserve the current workspace separately.
            }
        }

        for port in preferredPorts {
            let candidate = URL(string: "http://127.0.0.1:\(port)")!
            do {
                let payload = try await fetchHealth(from: candidate)
                return (candidate, payload)
            } catch {
                continue
            }
        }
        return nil
    }

    private func fetchHealth(from baseURL: URL) async throws -> HealthPayload {
        let url = baseURL.appending(path: "api/health")
        var request = URLRequest(url: url)
        request.timeoutInterval = 5
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "ReplyCoreService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Health endpoint returned a non-200 response."])
        }
        return try JSONDecoder().decode(HealthPayload.self, from: data)
    }

    private func loadThreadPage(
        baseURL: URL,
        handle: String,
        offset: Int,
        limit: Int,
        order: String
    ) async throws -> ReplyThreadResponse {
        var components = URLComponents(url: baseURL.appending(path: "api/thread"), resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "handle", value: handle),
            URLQueryItem(name: "offset", value: "\(offset)"),
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "order", value: order),
        ]
        guard let url = components?.url else {
            return ReplyThreadResponse(messages: [], hasMore: false, total: 0, order: order, offset: offset, limit: limit, conversationId: nil, channels: [], allowedChannels: [], defaultChannel: nil, conversationKind: "direct", conversationTitle: nil)
        }
        return try await requestJSON(url: url)
    }

    private func requestJSON<T: Decodable>(url: URL, protectedRoute: Bool = false, allowRecovery: Bool = true) async throws -> T {
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        applyProtectedHeaders(to: &request, includeHumanApproval: false)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(domain: "ReplyCoreService", code: 6, userInfo: [NSLocalizedDescriptionKey: "Request failed for \(url.lastPathComponent)."])
        }
        if !(200..<300).contains(http.statusCode) {
            let body = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if protectedRoute, allowRecovery, http.statusCode == 401, body.contains("operator_token_required") {
                await recoverProtectedRouteAccess()
                return try await requestJSON(url: url, protectedRoute: protectedRoute, allowRecovery: false)
            }
            let detail = body.isEmpty ? "Request failed for \(url.lastPathComponent)." : body
            throw NSError(domain: "ReplyCoreService", code: 6, userInfo: [NSLocalizedDescriptionKey: detail])
        }
        let decoder = JSONDecoder()
        return try decoder.decode(T.self, from: data)
    }

    private func seedComposerDraft(for handle: String, profile: ReplyProfile) async {
        guard selectedConversationHandle == handle else { return }

        let storedDraft = (profile.draft ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !storedDraft.isEmpty {
            applyComposerDraft(storedDraft, for: handle, preserveManualEdits: true, draftTelemetryContext: nil)
        }

        guard shouldAutoSeedPreparedDraft(for: handle) || currentDraftTelemetryContext == nil else { return }
        guard let prepared = try? await fetchPreparedDraft(for: handle, refresh: false) else { return }
        let suggestion = (prepared.suggestion ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let context = ReplyDraftTelemetryContext(handle: handle, response: prepared)

        if storedDraft.isEmpty {
            guard !suggestion.isEmpty else { return }
            applyComposerDraft(suggestion, for: handle, preserveManualEdits: true, draftTelemetryContext: context)
            await reportDraftSelectedIfNeeded(handle: handle, draftContext: context, notes: "native_auto_apply_top_candidate")
            return
        }

        if normalizeDraft(storedDraft) == normalizeDraft(suggestion) {
            applyComposerDraft(storedDraft, for: handle, preserveManualEdits: true, draftTelemetryContext: context)
            await reportDraftSelectedIfNeeded(handle: handle, draftContext: context, notes: "native_attach_context_to_saved_draft")
        }
    }

    private func shouldAutoSeedPreparedDraft(for handle: String) -> Bool {
        guard selectedConversationHandle == handle else { return false }
        if composerSeedHandle != handle { return true }
        if composerHasManualEdits { return false }
        return draftMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func fetchPreparedDraft(for handle: String, refresh: Bool) async throws -> ReplyPreparedDraftResponse {
        guard let baseURL else {
            throw NSError(domain: "ReplyCoreService", code: 11, userInfo: [NSLocalizedDescriptionKey: "The {reply} runtime is not connected."])
        }
        var components = URLComponents(url: baseURL.appending(path: "api/trinity/prepared-draft"), resolvingAgainstBaseURL: false)
        var queryItems = [URLQueryItem(name: "handle", value: handle)]
        if refresh {
            queryItems.append(URLQueryItem(name: "refresh", value: "1"))
        }
        components?.queryItems = queryItems
        guard let url = components?.url else {
            throw NSError(domain: "ReplyCoreService", code: 12, userInfo: [NSLocalizedDescriptionKey: "Invalid prepared draft URL."])
        }
        return try await requestJSON(url: url, protectedRoute: true)
    }

    private func applyComposerDraft(
        _ text: String,
        for handle: String,
        preserveManualEdits: Bool,
        draftTelemetryContext: ReplyDraftTelemetryContext?
    ) {
        guard selectedConversationHandle == handle else { return }
        if preserveManualEdits && composerSeedHandle == handle && composerHasManualEdits {
            return
        }
        suppressDraftTracking = true
        draftMessage = text
        suppressDraftTracking = false
        composerSeedHandle = handle
        composerHasManualEdits = false
        let previousContextKey = currentDraftTelemetryContext.map {
            "\($0.cycleId)::\($0.selectedCandidateId ?? "none")"
        }
        let nextContextKey = draftTelemetryContext.map {
            "\($0.cycleId)::\($0.selectedCandidateId ?? "none")"
        }
        if previousContextKey != nextContextKey {
            currentDraftSelectionReportKey = nil
        }
        currentDraftTelemetryContext = draftTelemetryContext
    }

    private func normalizeDraft(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\r\n", with: "\n")
    }

    private func draftShouldEmitEditedMemoryEvent(
        finalText: String,
        draftContext: ReplyDraftTelemetryContext
    ) -> Bool {
        let edited = normalizeDraft(finalText)
        let original = normalizeDraft(draftContext.selectedDraftText)
        return !edited.isEmpty && !original.isEmpty && edited != original
    }

    private func reportDraftEditedMemoryEvent(
        handle: String,
        finalText: String,
        draftContext: ReplyDraftTelemetryContext
    ) async {
        guard let baseURL else { return }
        let edited = normalizeDraft(finalText)
        let original = normalizeDraft(draftContext.selectedDraftText)
        guard !edited.isEmpty, !original.isEmpty, edited != original else { return }

        var metadata: [String: Any] = [
            "source_product": "reply",
            "cycle_id": draftContext.cycleId,
            "original_draft_text": original,
            "edited_length": edited.count,
            "original_length": original.count,
        ]
        if let selectedCandidateId = draftContext.selectedCandidateId, !selectedCandidateId.isEmpty {
            metadata["candidate_id"] = selectedCandidateId
        }

        var payload: [String: Any] = [
            "event_kind": "draft_edited",
            "source_ref": "draft-edited:\(draftContext.cycleId):\(draftContext.selectedCandidateId ?? "none"):\(Int(Date().timeIntervalSince1970 * 1000))",
            "occurred_at": ISO8601DateFormatter().string(from: Date()),
            "thread_ref": draftContext.threadRef,
            "channel": draftContext.channel,
            "contact_handle": handle,
            "content_text": edited,
            "metadata": metadata,
        ]
        if let companyId = draftContext.companyId, !companyId.isEmpty {
            payload["company_id"] = companyId
        }

        var request = URLRequest(url: baseURL.appending(path: "api/trinity/memory-event"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyProtectedHeaders(to: &request, includeHumanApproval: false)
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        _ = try? await URLSession.shared.data(for: request)
    }

    private func reportRegenerateFeedback(handle: String, existingText: String) async throws {
        if let draftContext = currentDraftTelemetryContext {
            var payload: [String: Any] = [
                "cycle_id": draftContext.cycleId,
                "thread_ref": draftContext.threadRef,
                "channel": draftContext.channel,
                "disposition": "REWORK_REQUESTED",
                "occurred_at": ISO8601DateFormatter().string(from: Date()),
                "original_draft_text": draftContext.selectedDraftText,
                "notes": "native_regenerate_requested",
            ]
            if let companyId = draftContext.companyId, !companyId.isEmpty {
                payload["company_id"] = companyId
            }
            if let selectedCandidateId = draftContext.selectedCandidateId, !selectedCandidateId.isEmpty {
                payload["candidate_id"] = selectedCandidateId
            }
            let normalizedExistingText = normalizeDraft(existingText)
            if !normalizedExistingText.isEmpty {
                payload["final_text"] = normalizedExistingText
            }
            try await reportTrinityOutcome(payload)
        } else if !existingText.isEmpty {
            try await postFeedback([
                "type": "draft_replaced",
                "handle": handle,
                "original_text": normalizeDraft(existingText),
                "reason": "native_regenerate_requested",
            ])
        }
    }

    private func reportGenericSendFeedback(handle: String, finalText: String) async {
        let sentText = normalizeDraft(finalText)
        guard !sentText.isEmpty else { return }
        let original = normalizeDraft(profileDraft.draft)
        do {
            if !original.isEmpty && original == sentText {
                try await postFeedback([
                    "type": "accepted",
                    "handle": handle,
                    "suggestion": sentText,
                    "rating": 1,
                    "reason": "native_send_as_is_without_cycle",
                ])
            } else if !original.isEmpty {
                try await postFeedback([
                    "type": "draft_replaced",
                    "handle": handle,
                    "original_text": original,
                    "final_text": sentText,
                    "reason": "native_send_with_modification_without_cycle",
                ])
            }
        } catch {
            // Non-blocking feedback path.
        }
    }

    private func reportDraftSelectedIfNeeded(
        handle: String,
        draftContext: ReplyDraftTelemetryContext?,
        notes: String
    ) async {
        guard let draftContext else { return }
        guard let selectedCandidateId = draftContext.selectedCandidateId, !selectedCandidateId.isEmpty else { return }
        let reportKey = "\(draftContext.cycleId)::\(selectedCandidateId)"
        if currentDraftSelectionReportKey == reportKey {
            return
        }
        var payload: [String: Any] = [
            "cycle_id": draftContext.cycleId,
            "thread_ref": draftContext.threadRef,
            "channel": draftContext.channel,
            "candidate_id": selectedCandidateId,
            "disposition": "SELECTED",
            "occurred_at": ISO8601DateFormatter().string(from: Date()),
            "original_draft_text": draftContext.selectedDraftText,
            "notes": notes,
        ]
        if let companyId = draftContext.companyId, !companyId.isEmpty {
            payload["company_id"] = companyId
        }
        do {
            try await reportTrinityOutcome(payload)
            currentDraftSelectionReportKey = reportKey
        } catch {
            // Non-blocking selection telemetry path.
        }
    }

    private func reportTrinityOutcome(_ payload: [String: Any]) async throws {
        guard let baseURL else { return }
        var request = URLRequest(url: baseURL.appending(path: "api/trinity/outcome"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyProtectedHeaders(to: &request, includeHumanApproval: false)
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "ReplyCoreService", code: 9, userInfo: [NSLocalizedDescriptionKey: "Failed to report Trinity outcome."])
        }
    }

    private func postFeedback(_ payload: [String: Any]) async throws {
        guard let baseURL else { return }
        var request = URLRequest(url: baseURL.appending(path: "api/feedback"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyProtectedHeaders(to: &request, includeHumanApproval: false)
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "ReplyCoreService", code: 10, userInfo: [NSLocalizedDescriptionKey: "Failed to save draft feedback."])
        }
    }

    private func inferChannel(for handle: String, messages: [ReplyMessage]) {
        if let channel = messages.first(where: { !($0.authoredByMe) })?.channel?.lowercased() {
            selectedChannel = ReplyMessageChannel(rawValue: channel) ?? fallbackChannel(for: handle)
            return
        }
        selectedChannel = fallbackChannel(for: handle)
    }

    private func normalizedChannels(_ values: [String]?) -> [ReplyMessageChannel] {
        let mapped = (values ?? []).compactMap { ReplyMessageChannel(rawValue: $0.lowercased()) }
        var seen = Set<ReplyMessageChannel>()
        return mapped.filter { seen.insert($0).inserted }
    }

    private func resolveSelectedChannel(
        handle: String,
        defaultChannelRaw: String?,
        messages: [ReplyMessage],
        allowedChannels: [ReplyMessageChannel],
        visibleChannels: [ReplyMessageChannel]
    ) -> ReplyMessageChannel {
        let allowed = Array(Set(allowedChannels))
        if let raw = defaultChannelRaw?.lowercased(),
           let channel = ReplyMessageChannel(rawValue: raw),
           allowed.contains(channel) {
            return channel
        }
        if let channel = messages.first(where: { !($0.authoredByMe) })?.channel?.lowercased(),
           let resolved = ReplyMessageChannel(rawValue: channel),
           allowed.contains(resolved) {
            return resolved
        }
        if let firstAllowed = allowed.first {
            return firstAllowed
        }
        if let visibleDefault = visibleChannels.first, allowed.contains(visibleDefault) {
            return visibleDefault
        }
        return selectedChannel
    }

    private func dedupeMessages(_ input: [ReplyMessage]) -> [ReplyMessage] {
        var seen = Set<String>()
        var output: [ReplyMessage] = []
        for message in input {
            if seen.insert(message.id).inserted {
                output.append(message)
            }
        }
        return output
    }

    private func messageAscending(_ lhs: ReplyMessage, _ rhs: ReplyMessage) -> Bool {
        let leftDate = parsedDate(lhs.date)
        let rightDate = parsedDate(rhs.date)
        switch (leftDate, rightDate) {
        case let (l?, r?):
            if l != r { return l < r }
        case (_?, nil):
            return true
        case (nil, _?):
            return false
        case (nil, nil):
            break
        }
        return lhs.id < rhs.id
    }

    private func parsedDate(_ raw: String?) -> Date? {
        let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !value.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let precise = formatter.date(from: value) {
            return precise
        }
        let fallback = ISO8601DateFormatter()
        fallback.formatOptions = [.withInternetDateTime]
        return fallback.date(from: value)
    }

    private func fallbackChannel(for handle: String) -> ReplyMessageChannel {
        if handle.contains("@") {
            return .email
        }
        if handle.hasPrefix("+") {
            return .imessage
        }
        return .whatsapp
    }

    private var currentSyncChannel: SyncChannel? {
        switch selectedChannel {
        case .imessage:
            return .imessage
        case .whatsapp:
            return .whatsapp
        case .email:
            return .mail
        case .linkedin:
            return nil
        }
    }

    private func applyProtectedHeaders(to request: inout URLRequest, includeHumanApproval: Bool) {
        if let token = operatorToken {
            request.setValue(token, forHTTPHeaderField: "X-Reply-Operator-Token")
        }
        request.setValue(nativeClientToken, forHTTPHeaderField: "X-Reply-Native-Token")
        if includeHumanApproval {
            request.setValue("confirmed", forHTTPHeaderField: "X-Reply-Human-Approval")
        }
    }

    private var operatorToken: String? {
        let envValue = String(ProcessInfo.processInfo.environment["REPLY_OPERATOR_TOKEN"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return envValue.isEmpty ? nil : envValue
    }

    private func recoverProtectedRouteAccess() async {
        stopReply()
        launchReply()
        try? await Task.sleep(for: .seconds(2))
        await refreshHealth()
    }

    private static func loadOrCreateNativeClientToken() -> String {
        let root = FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Library")
            .appending(path: "Application Support")
            .appending(path: "reply")
        let fileURL = root.appending(path: "native-client-token.txt")

        if let data = try? String(contentsOf: fileURL, encoding: .utf8) {
            let token = data.trimmingCharacters(in: .whitespacesAndNewlines)
            if !token.isEmpty {
                return token
            }
        }

        let token = UUID().uuidString
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            try token.write(to: fileURL, atomically: true, encoding: .utf8)
        } catch {
            return token
        }
        return token
    }

    private func handleHealthMiss(_ message: String) {
        if shouldPreserveStartingState() {
            runtimeState = .starting
            lastRefreshAt = Date()
            launchErrorMessage = launchErrorMessage.isEmpty ? "Starting local runtime..." : launchErrorMessage
            return
        }

        consecutiveHealthFailures += 1
        lastRefreshAt = Date()

        if baseURL != nil && consecutiveHealthFailures < 6 {
            // Keep the current workspace alive across transient misses so the UI does not
            // tear down and force the embedded app to reload from zero.
            launchErrorMessage = ""
            runtimeState = .online
            return
        }

        health = nil
        baseURL = nil
        runtimeState = .offline
        launchErrorMessage = message
        if !hasAttemptedAutoLaunch {
            hasAttemptedAutoLaunch = true
            launchReply()
        }
    }

    private func shouldPreserveStartingState() -> Bool {
        guard case .starting = runtimeState else { return false }
        guard let launchDeadline else { return false }
        return Date() < launchDeadline
    }

    private func beginLaunchWatch() {
        launchWatchTask?.cancel()
        launchWatchTask = Task { @MainActor in
            while !Task.isCancelled {
                await refreshHealth()
                if runtimeState == .online {
                    launchWatchTask = nil
                    return
                }
                if !shouldPreserveStartingState() {
                    launchWatchTask = nil
                    if runtimeState != .online {
                        handleHealthMiss("{reply} runtime did not become ready before the startup timeout.")
                    }
                    return
                }
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func isLaunchReady(_ payload: HealthPayload) -> Bool {
        if let ready = payload.launch?.ready {
            return ready
        }
        return payload.ok == true || payload.status == "online"
    }

    private func launchProgressMessage(from payload: HealthPayload) -> String {
        let message = payload.launch?.message?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !message.isEmpty {
            return message
        }
        if let stage = payload.launch?.stage, !stage.isEmpty {
            return "Runtime startup stage: \(stage)."
        }
        return "Starting local runtime..."
    }

    private func resolveRuntimeRoot() -> URL? {
        if let bundled = bundledRuntimeRootURL() {
            return bundled
        }
        if let repoRoot = resolveRepoRoot() {
            let chatRoot = repoRoot.appending(path: "chat")
            if FileManager.default.fileExists(atPath: chatRoot.appending(path: "server.js").path) {
                return chatRoot
            }
        }
        return nil
    }

    private func resolveRepoRoot() -> URL? {
        if let explicit = ProcessInfo.processInfo.environment["REPLY_REPO_ROOT"], !explicit.isEmpty {
            let url = URL(fileURLWithPath: explicit)
            if FileManager.default.fileExists(atPath: url.appending(path: "chat/server.js").path) {
                return url
            }
        }

        if let bundled = Bundle.main.path(forResource: "reply-repo-root", ofType: "txt") {
            let value = (try? String(contentsOfFile: bundled, encoding: .utf8))?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if let value, !value.isEmpty {
                let url = URL(fileURLWithPath: value)
                if FileManager.default.fileExists(atPath: url.appending(path: "chat/server.js").path) {
                    return url
                }
            }
        }

        let bundlePath = Bundle.main.bundleURL
        var cursor = bundlePath
        for _ in 0..<8 {
            let candidate = cursor.appending(path: "chat/server.js")
            if FileManager.default.fileExists(atPath: candidate.path) {
                return cursor
            }
            cursor.deleteLastPathComponent()
        }

        return nil
    }

    private func stopLegacyRepoRuntime() {
        let domainTarget = "gui/\(getuid())/com.reply.hub"
        let plistPath = FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Library")
            .appending(path: "LaunchAgents")
            .appending(path: "com.reply.hub.plist")
            .path

        let disable = Process()
        disable.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        disable.arguments = ["disable", domainTarget]
        disable.standardOutput = Pipe()
        disable.standardError = Pipe()
        try? disable.run()
        disable.waitUntilExit()

        let bootout = Process()
        bootout.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        bootout.arguments = ["bootout", "gui/\(getuid())", plistPath]
        bootout.standardOutput = Pipe()
        bootout.standardError = Pipe()
        try? bootout.run()
        bootout.waitUntilExit()

        let pkill = Process()
        pkill.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        pkill.arguments = ["-f", "/Users/Shared/Projects/reply/tools/scripts/reply_service.sh|/Users/Shared/Projects/reply/chat/server.js|/Users/Shared/Projects/reply/chat/background-worker.js"]
        pkill.standardOutput = Pipe()
        pkill.standardError = Pipe()
        try? pkill.run()
        pkill.waitUntilExit()
    }

    private func detectManagementStateIfNeeded() async {
        guard case .unknown = managementState else { return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/profiles")
        process.arguments = ["status", "-type", "enrollment"]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let text = String(data: data, encoding: .utf8) ?? ""
            if text.localizedCaseInsensitiveContains("MDM enrollment: Yes") ||
               text.localizedCaseInsensitiveContains("Enrolled via DEP: Yes") {
                managementState = .managed
            } else if text.localizedCaseInsensitiveContains("MDM enrollment: No") {
                managementState = .unmanaged
            } else {
                managementState = .unknown
            }
        } catch {
            managementState = .unknown
        }
    }
}
