import SwiftUI

struct SystemStatusView: View {
    @ObservedObject var service: ReplyCoreService

    private let primaryChannelOrder = ["imessage", "whatsapp", "mail", "notes", "calendar", "contacts", "kyc"]
    private let deferredChannelKeys = ["linkedin_messages", "linkedin_posts"]

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                headerCard
                actionCard
                attentionSection
                preflightSection
                coreReadinessSection
                primaryChannelsSection
                deferredConnectorsSection
                logSection
            }
            .padding(20)
        }
        .background(Color.clear)
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Runtime", systemImage: "desktopcomputer")
                .font(.headline)
            HStack {
                statusPill(service.runtimeState.label, color: runtimeColor(service.runtimeState))
                if let version = service.health?.version {
                    Text("Version \(version)")
                        .foregroundStyle(.secondary)
                }
                if let date = service.lastRefreshAt {
                    Spacer()
                    Text("Last refresh \(date.formatted(date: .omitted, time: .standard))")
                        .font(.caption)
                        .foregroundStyle(ReplyConstellationPalette.textSecondary)
                }
            }
            if !service.launchErrorMessage.isEmpty {
                Text(service.launchErrorMessage)
                    .font(.callout)
                    .foregroundStyle(ReplyConstellationPalette.danger)
            }
            Text("If iMessage is blocked, enable Full Disk Access for the runtime binary {reply} uses: \(service.nodeBinaryHint)")
                .font(.caption)
                .foregroundStyle(ReplyConstellationPalette.textSecondary)
        }
        .modifier(CardStyle())
    }

    private var actionCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Actions", systemImage: "slider.horizontal.3")
                .font(.headline)
            Text("Blocks below become interactive when their data is loaded. Use this area for repair and inspection actions.")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                Button("Refresh Runtime") {
                    Task { await service.refreshHealth() }
                }
                Button("Open Full Disk Access") {
                    service.openFullDiskAccessSettings()
                }
                Button("Open Worker Log") {
                    service.openWorkerLog()
                }
                .disabled(service.health?.services?["worker"] == nil)
            }
        }
        .modifier(CardStyle())
    }

    @ViewBuilder
    private var attentionSection: some View {
        let items = attentionItems()
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Label("Needs Attention", systemImage: "exclamationmark.triangle.fill")
                    .font(.headline)
                ForEach(items.indices, id: \.self) { index in
                    let item = items[index]
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.title)
                                    .fontWeight(.semibold)
                                Text(item.message)
                                    .font(.callout)
                                if let help = item.help {
                                    Text(help)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            statusPill(item.status, color: preflightColor(item.status))
                        }
                        if let action = item.action {
                            Button(action.label) {
                                action.handler()
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .modifier(CardStyle())
        }
    }

    private var preflightSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Foundation", systemImage: "checklist")
                    .font(.headline)
                if let preflight = service.health?.preflight {
                    statusPill(preflight.overall, color: preflightColor(preflight.overall))
                } else {
                    statusPill("Loading", color: .orange)
                }
            }

            if let preflight = service.health?.preflight {
                ForEach(preflight.checks.filter { $0.id != "background_worker" }) { check in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(check.title)
                                    .fontWeight(.semibold)
                                if let detail = check.detail, !detail.isEmpty {
                                    Text(detail)
                                        .font(.callout)
                                }
                            }
                            Spacer()
                            statusPill(check.status, color: preflightColor(check.status))
                        }
                        if let remediation = remediationText(for: check) {
                            Text(remediation)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else if let hint = check.hint, !hint.isEmpty {
                            Text(hint)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            } else {
                loadingText("Loading foundation checks…")
            }
        }
        .modifier(CardStyle())
    }

    private var coreReadinessSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Core Runtime", systemImage: "server.rack")
                .font(.headline)

            if let services = service.health?.services, !services.isEmpty {
                ForEach(services.keys.sorted().filter { $0 != "openclaw" }, id: \.self) { key in
                    if let item = services[key] {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(item.name ?? key)
                                        .fontWeight(.semibold)
                                    if let detail = item.detail ?? item.lastError, !detail.isEmpty {
                                        Text(detail)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    if key == "worker", item.status == "crashed" || item.status == "error" {
                                        Text("Open the worker log from the Actions block. The dashboard restart guidance is legacy and will be replaced by native runtime ownership.")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                                statusPill(item.status ?? "unknown", color: preflightColor(item.status ?? "unknown"))
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            } else {
                loadingText("Waiting for runtime service data…")
            }
        }
        .modifier(CardStyle())
    }

    private var primaryChannelsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Data Sources", systemImage: "tray.full")
                .font(.headline)

            if let channels = service.health?.channels, !channels.isEmpty {
                let ordered = primaryChannelOrder.filter { channels[$0] != nil }
                ForEach(ordered, id: \.self) { key in
                    if let item = channels[key] {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(channelTitle(key))
                                        .fontWeight(.semibold)
                                    if let message = item.message, !message.isEmpty {
                                        Text(message)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    if let sync = item.lastSuccessfulSync ?? item.lastSync {
                                        Text("Last successful sync: \(sync)")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                                statusPill(item.state ?? "unknown", color: preflightColor(item.state ?? "unknown"))
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            } else {
                loadingText("Waiting for channel sync status…")
            }
        }
        .modifier(CardStyle())
    }

    @ViewBuilder
    private var deferredConnectorsSection: some View {
        if let channels = service.health?.channels {
            let visibleDeferred = deferredChannelKeys.compactMap { key -> (String, ChannelHealth)? in
                guard let item = channels[key] else { return nil }
                let isInteresting = item.state == "error" || item.state == "running" || item.message?.isEmpty == false
                return isInteresting ? (key, item) : nil
            }
            if !visibleDeferred.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Deferred Connectors", systemImage: "shippingbox")
                        .font(.headline)
                    Text("These are not part of the core MVP runtime path. They are shown separately so they do not block the main product surface.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    ForEach(Array(visibleDeferred.enumerated()), id: \.offset) { _, pair in
                        let key = pair.0
                        let item = pair.1
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(channelTitle(key))
                                        .fontWeight(.semibold)
                                    if let message = item.message, !message.isEmpty {
                                        Text(message)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                                statusPill(item.state ?? "unknown", color: preflightColor(item.state ?? "unknown"))
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
                .modifier(CardStyle())
            }
        }
    }

    @ViewBuilder
    private var logSection: some View {
        if !service.logLines.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Label("App Launch Log", systemImage: "text.alignleft")
                    .font(.headline)
                Text(service.logLines.joined(separator: "\n"))
                    .font(.system(size: 11, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            .modifier(CardStyle())
        }
    }

    private func remediationText(for check: PreflightCheck) -> String? {
        switch check.id {
        case "imessage_source":
            if check.status == "blocked" || check.status == "degraded" {
                return "Do this in macOS: System Settings → Privacy & Security → Full Disk Access → enable \(service.nodeBinaryHint). Then restart {reply}."
            }
        case "background_worker":
            if check.status != "ok" {
                return "The worker is a runtime component. Open the worker log from the Actions block, then restart the {reply} runtime from this app if needed."
            }
        case "openclaw_gateway":
            if check.status != "ok" {
                return "WhatsApp routing depends on the local gateway. Keep using the rest of {reply}, then repair WhatsApp separately."
            }
        default:
            break
        }
        return nil
    }

    private func attentionItems() -> [(title: String, message: String, help: String?, status: String, action: (label: String, handler: () -> Void)?)] {
        var items: [(String, String, String?, String, (label: String, handler: () -> Void)?)] = []

        if let worker = service.health?.services?["worker"], worker.status == "crashed" || worker.status == "error" {
            items.append((
                "Background Worker",
                worker.lastError ?? "The background worker is not currently healthy.",
                "Open the worker log, then restart the {reply} runtime from this app if needed.",
                worker.status ?? "error",
                ("Open Worker Log", { service.openWorkerLog() })
            ))
        }

        if let imessage = service.health?.channels?["imessage"], imessage.state == "error" {
            items.append((
                "iMessage Access",
                imessage.message ?? "iMessage is blocked.",
                "Grant Full Disk Access to the runtime binary {reply} uses, then restart the app runtime.",
                imessage.state ?? "error",
                ("Open Full Disk Access", { service.openFullDiskAccessSettings() })
            ))
        }

        return items
    }

    private func channelTitle(_ key: String) -> String {
        switch key {
        case "imessage":
            return "iMessage"
        case "whatsapp":
            return "WhatsApp"
        case "mail":
            return "Mail"
        case "notes":
            return "Apple Notes"
        case "calendar":
            return "Apple Calendar"
        case "contacts":
            return "Apple Contacts"
        case "kyc":
            return "KYC / Contact Intelligence"
        case "linkedin_messages":
            return "LinkedIn Messages"
        case "linkedin_posts":
            return "LinkedIn Posts"
        default:
            return key.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private func loadingText(_ text: String) -> some View {
        HStack {
            ProgressView()
                .scaleEffect(0.8)
            Text(text)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
    }

    private func statusPill(_ text: String, color: Color) -> some View {
        Text(text.capitalized)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(color.opacity(0.14))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private func runtimeColor(_ state: ReplyRuntimeState) -> Color {
        switch state {
        case .unknown:
            return ReplyConstellationPalette.textSecondary
        case .starting:
            return ReplyConstellationPalette.warning
        case .online:
            return ReplyConstellationPalette.success
        case .offline:
            return ReplyConstellationPalette.textSecondary
        case .error:
            return ReplyConstellationPalette.danger
        }
    }

    private func preflightColor(_ status: String) -> Color {
        switch status.lowercased() {
        case "ok", "online", "ready", "idle", "running", "live":
            return ReplyConstellationPalette.success
        case "degraded", "warning", "starting", "loading":
            return ReplyConstellationPalette.warning
        case "blocked", "error", "repair_required", "crashed", "offline":
            return ReplyConstellationPalette.danger
        default:
            return ReplyConstellationPalette.textSecondary
        }
    }
}

private struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .replyConstellationCard()
    }
}
