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

    private var launchProcess: Process?
    private var refreshTask: Task<Void, Never>?
    private let preferredPorts = Array(45311...45326)
    private var hasAttemptedAutoLaunch = false
    private var consecutiveHealthFailures = 0
    private var lastIMessageMirrorAt: Date?
    private var lastOllamaStartAttemptAt: Date?

    deinit {
        refreshTask?.cancel()
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
        refreshAppleSourceMirrorsIfNeeded()
        if let detected = await detectHealthyBaseURL() {
            do {
                let payload = try await fetchHealth(from: detected)
                health = payload
                baseURL = detected
                runtimeState = .online
                lastRefreshAt = Date()
                hasAttemptedAutoLaunch = true
                consecutiveHealthFailures = 0
                if payload.status == "online" || payload.ok == true {
                    launchErrorMessage = ""
                }
                await detectManagementStateIfNeeded()
                await autoStartOllamaIfNeeded(payload)
                if !isLoadingSettings {
                    await loadSettingsIfNeeded()
                }
            } catch {
                handleHealthMiss(error.localizedDescription)
            }
        } else if case .starting = runtimeState {
            lastRefreshAt = Date()
        } else {
            handleHealthMiss("{reply} runtime health probe did not respond.")
        }
    }

    func launchReply() {
        guard launchProcess == nil || launchProcess?.isRunning == false else {
            return
        }
        runtimeState = .starting
        launchErrorMessage = ""

        guard let runtimeRoot = resolveRuntimeRoot() else {
            runtimeState = .error("Could not resolve the bundled {reply} runtime root.")
            return
        }
        guard let runtimeBinary = bundledRuntimeBinaryURL() else {
            runtimeState = .error("Could not find the bundled reply runtime binary.")
            return
        }

        refreshAppleSourceMirrorsIfNeeded(force: true)

        let process = Process()
        let output = Pipe()
        process.executableURL = runtimeBinary
        process.arguments = [runtimeRoot.appending(path: "server.js").path]
        process.currentDirectoryURL = runtimeRoot
        var env = ProcessInfo.processInfo.environment
        env["REPLY_DATA_HOME"] = replyDataHome.path
        env["REPLY_LOG_HOME"] = replyLogHome.path
        if let mirrored = mirroredIMessageDbURL(), FileManager.default.fileExists(atPath: mirrored.path) {
            env["REPLY_IMESSAGE_DB_PATH"] = mirrored.path
        }
        env["PATH"] = "\(runtimeBinary.deletingLastPathComponent().path):/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
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
                    self?.runtimeState = .error("{reply} runtime exited with code \(proc.terminationStatus).")
                }
            }
        }

        do {
            try process.run()
            launchProcess = process
            Task {
                try? await Task.sleep(for: .seconds(2))
                await refreshHealth()
            }
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
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw NSError(domain: "ReplyCoreService", code: 2, userInfo: [NSLocalizedDescriptionKey: "Settings endpoint returned a non-200 response."])
            }
            let payload = try JSONDecoder().decode(NativeSettingsPayload.self, from: data)
            settingsDraft = NativeSettingsDraft(payload: payload)
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
            request.httpBody = try JSONEncoder().encode(Payload(
                ai: settingsDraft.ai,
                worker: settingsDraft.worker,
                health: settingsDraft.health
            ))
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw NSError(domain: "ReplyCoreService", code: 3, userInfo: [NSLocalizedDescriptionKey: "Saving settings failed."])
            }
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

    private func refreshAppleSourceMirrorsIfNeeded(force: Bool = false) {
        let now = Date()
        if !force, let last = lastIMessageMirrorAt, now.timeIntervalSince(last) < 8 {
            return
        }
        lastIMessageMirrorAt = now
        guard let helper = protectedDataHelperURL() else {
            appendMirrorLog("mirror failed: protected data helper missing")
            return
        }

        let targetRoot = appleMirrorHome.appending(path: "imessage")
        let logFile = replyLogHome.appending(path: "imessage-mirror.log")
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
                appendMirrorLog("mirror failed: helper exit \(process.terminationStatus)")
            }
        } catch {
            appendMirrorLog("mirror failed: \(error.localizedDescription)")
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

    private func detectHealthyBaseURL() async -> URL? {
        if let current = baseURL {
            do {
                let payload = try await fetchHealth(from: current)
                if payload.ok == true || payload.status == "online" {
                    return current
                }
            } catch {
                // Fall through to port scan. We preserve the current workspace separately.
            }
        }

        for port in preferredPorts {
            let candidate = URL(string: "http://127.0.0.1:\(port)")!
            do {
                let payload = try await fetchHealth(from: candidate)
                if payload.ok == true || payload.status == "online" {
                    return candidate
                }
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

    private func handleHealthMiss(_ message: String) {
        consecutiveHealthFailures += 1
        lastRefreshAt = Date()

        if baseURL != nil && consecutiveHealthFailures < 6 {
            // Keep the current workspace alive across transient misses so the UI does not
            // tear down and force the embedded app to reload from zero.
            launchErrorMessage = "Transient runtime check miss. Preserving the current workspace session."
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
