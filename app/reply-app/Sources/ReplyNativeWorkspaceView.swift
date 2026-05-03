import AppKit
import SwiftUI

struct ReplyNativeWorkspaceView: View {
    @ObservedObject var service: ReplyCoreService

    @Environment(\.openWindow) private var openWindow
    @State private var isSidebarVisible = true
    @State private var isProfileVisible = true
    @State private var hasBootstrappedWorkspace = false

    var body: some View {
        VStack(spacing: 0) {
            workspaceToolbar
            Divider()
            HSplitView {
                if isSidebarVisible {
                    sidebarPane
                        .frame(minWidth: 300, idealWidth: 340, maxWidth: 380)
                }
                ZStack {
                    ReplyConstellationPalette.canvas
                    mainPane
                }
                .frame(minWidth: 560, maxWidth: .infinity, maxHeight: .infinity)
                if isProfileVisible {
                    profilePane
                        .frame(minWidth: 320, idealWidth: 360, maxWidth: 420)
                }
            }
        }
        .background(Color.clear)
        .task {
            await service.refreshHealth()
            await service.loadWorkspaceIfNeeded()
            await bootstrapWorkspaceIfNeeded()
        }
        .onChange(of: service.baseURL) { _, newValue in
            guard newValue != nil else { return }
            Task {
                await service.loadWorkspaceIfNeeded()
                await bootstrapWorkspaceIfNeeded()
            }
        }
        .onChange(of: service.conversations) { _, newValue in
            guard !newValue.isEmpty else { return }
            Task { await bootstrapWorkspaceIfNeeded() }
        }
    }

    private var workspaceToolbar: some View {
        HStack(spacing: 18) {
            HStack(spacing: 16) {
                WorkspaceIconButton(
                    systemName: isSidebarVisible ? "sidebar.left" : "sidebar.left",
                    label: isSidebarVisible ? "Hide conversations" : "Show conversations"
                ) {
                    isSidebarVisible.toggle()
                }

                WorkspaceIconButton(systemName: "square.grid.2x2", label: "Dashboard") {
                    service.workspaceMode = .dashboard
                }

                WorkspaceIconButton(systemName: "arrow.clockwise", label: "Refresh") {
                    Task {
                        await service.refreshHealth()
                        await service.loadWorkspaceIfNeeded()
                    }
                }

                WorkspaceIconButton(systemName: "gearshape", label: "Settings") {
                    NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
                }

                runtimeIndicator
            }

            Spacer(minLength: 24)

            HStack(spacing: 12) {
                channelGlyph
                Text(toolbarTitle)
                    .font(.title3.weight(.semibold))
                    .lineLimit(1)
                    .foregroundStyle(ReplyConstellationPalette.textPrimary)
            }

            Spacer(minLength: 24)

            HStack(spacing: 16) {
                WorkspaceIconButton(systemName: "slider.horizontal.3", label: "Control center") {
                    openWindow(id: "control-center")
                    NSApp.activate(ignoringOtherApps: true)
                }

                WorkspaceIconButton(
                    systemName: isProfileVisible ? "sidebar.right" : "sidebar.right",
                    label: isProfileVisible ? "Hide profile" : "Show profile"
                ) {
                    isProfileVisible.toggle()
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
    }

    private var sidebarPane: some View {
        VStack(spacing: 0) {
            VStack(spacing: 12) {
                TextField("Search contacts...", text: $service.conversationSearch)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit {
                        Task { await service.loadConversations() }
                    }

                HStack {
                    Text("Newest first")
                        .foregroundStyle(ReplyConstellationPalette.textSecondary)
                    Spacer()
                    Button("Reload") {
                        Task { await service.loadConversations() }
                    }
                    .buttonStyle(.borderless)
                }
                .font(.subheadline)
            }
            .padding(18)

            Divider()

            if service.isLoadingConversations && service.conversations.isEmpty {
                loadingPanel("Loading conversations...")
            } else if service.conversations.isEmpty {
                emptyStatePanel(
                    title: "No conversations",
                    detail: "Start the runtime or refresh the local data sources to populate the workspace."
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(service.conversations) { conversation in
                            ConversationRow(
                                conversation: conversation,
                                isSelected: service.workspaceMode == .conversations && service.selectedConversationHandle == conversation.handle
                            ) {
                                Task { await service.loadConversation(handle: conversation.handle) }
                            }
                        }
                    }
                    .padding(14)
                }
            }
        }
        .background(ReplyConstellationPalette.panel.opacity(0.72))
    }

    @ViewBuilder
    private var mainPane: some View {
        if service.runtimeState != .online && service.baseURL == nil {
            offlinePane
        } else if service.workspaceMode == .dashboard {
            dashboardPane
        } else if let handle = service.selectedConversationHandle {
            conversationPane(handle: handle)
        } else if let first = service.conversations.first {
            loadingPanel("Opening \(first.resolvedTitle)...")
                .task {
                    await service.loadConversation(handle: first.handle)
                }
        } else {
            emptyStatePanel(
                title: "No active conversation",
                detail: "Pick a conversation from the sidebar or switch to the dashboard."
            )
        }
    }

    private var dashboardPane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("Dashboard")
                        .font(.largeTitle.weight(.bold))
                    Spacer()
                    Text(service.runtimeState.label)
                        .foregroundStyle(ReplyConstellationPalette.textSecondary)
                }

                DashboardMetricGrid(service: service)
                DashboardSourceSection(service: service)

                if !service.launchErrorMessage.isEmpty {
                    Text(service.launchErrorMessage)
                        .font(.callout)
                        .foregroundStyle(ReplyConstellationPalette.danger)
                        .replyConstellationCard()
                }

                if let preflight = service.health?.preflight {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Foundation")
                            .font(.headline)
                        ForEach(preflight.checks) { check in
                            HStack(alignment: .top, spacing: 12) {
                                NativeStatusPill(text: check.status, tint: toneColor(for: check.status))
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(check.title)
                                        .font(.headline)
                                    if let detail = check.detail, !detail.isEmpty {
                                        Text(detail)
                                            .foregroundStyle(ReplyConstellationPalette.textSecondary)
                                    }
                                }
                                Spacer()
                            }
                        }
                    }
                    .replyConstellationCard()
                }
            }
            .padding(22)
        }
        .background(ReplyConstellationPalette.canvas)
    }

    private func conversationPane(handle: String) -> some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(selectedConversationTitle)
                        .font(.title2.weight(.semibold))
                        .lineLimit(1)
                    Text(selectedConversationSubtitle)
                        .font(.subheadline)
                        .foregroundStyle(ReplyConstellationPalette.textSecondary)
                        .lineLimit(1)
                }
                Spacer()
                Button {
                    Task { await service.refreshCurrentConversation() }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.clockwise")
                        Text(service.conversationRefreshInFlight ? "Refreshing..." : "Refresh")
                    }
                }
                .buttonStyle(.borderless)
                .disabled(service.conversationRefreshInFlight)

                Picker("Channel", selection: $service.selectedChannel) {
                    ForEach(ReplyMessageChannel.allCases) { channel in
                        Text(channel.label).tag(channel)
                    }
                }
                .pickerStyle(.menu)
                .frame(width: 160)
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 16)

            Divider()

            if service.isLoadingMessages && service.messages.isEmpty {
                loadingPanel("Loading messages...")
            } else {
                ReplyMessageTimeline(messages: service.messages)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            Divider()

            VStack(alignment: .leading, spacing: 10) {
                if !service.sendErrorMessage.isEmpty {
                    Text(service.sendErrorMessage)
                        .font(.caption)
                        .foregroundStyle(ReplyConstellationPalette.danger)
                }

                TextEditor(text: $service.draftMessage)
                    .font(.body)
                    .padding(10)
                    .frame(minHeight: 88, maxHeight: 140)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(ReplyConstellationPalette.panel.opacity(0.85))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(ReplyConstellationPalette.border, lineWidth: 1)
                    )

                HStack {
                    Text(service.selectedChannel.label)
                        .foregroundStyle(ReplyConstellationPalette.textSecondary)
                    Spacer()
                    Button(service.sendInFlight ? "Sending..." : "Send") {
                        Task { await service.sendCurrentMessage() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(
                        service.sendInFlight ||
                        service.selectedConversationHandle != handle ||
                        service.draftMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    )
                }
            }
            .padding(18)
        }
        .background(ReplyConstellationPalette.canvas)
    }

    private var profilePane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("Profile")
                        .font(.title2.weight(.bold))
                    Spacer()
                    if service.isLoadingProfile {
                        ProgressView()
                            .controlSize(.small)
                    }
                    Button(service.isSavingProfile ? "Saving..." : "Save") {
                        Task { await service.saveSelectedProfile() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(service.selectedConversationHandle == nil || service.isSavingProfile)
                }

                if let profile = service.selectedProfile {
                    VStack(alignment: .leading, spacing: 14) {
                        profileReadOnlyField("Handle", value: profile.handle)
                        editableProfileField("Display name", text: $service.profileDraft.displayName)
                        editableProfileField("Profession", text: $service.profileDraft.profession)
                        editableProfileField("Company", text: $service.profileDraft.company)
                        editableProfileField("Relationship", text: $service.profileDraft.relationship)
                        editableProfileField("LinkedIn URL", text: $service.profileDraft.linkedinURL)
                        editableProfileTextArea("Intro", text: $service.profileDraft.intro)
                    }
                    .replyConstellationCard()

                    if let channels = profile.channels {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Channels")
                                .font(.headline)
                            profileChannelList(title: "Phone", values: channels.phone)
                            profileChannelList(title: "Email", values: channels.email)
                            profileChannelList(title: "WhatsApp", values: channels.whatsapp)
                            profileChannelList(title: "LinkedIn", values: channels.linkedin)
                            profileChannelList(title: "iMessage", values: channels.imessage)
                        }
                        .replyConstellationCard()
                    }

                    if let notes = profile.notes, !notes.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Notes")
                                .font(.headline)
                            ForEach(Array(notes.enumerated()), id: \.offset) { _, note in
                                if let text = note.text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                    Text(text)
                                        .foregroundStyle(ReplyConstellationPalette.textSecondary)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(12)
                                        .background(
                                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                                .fill(ReplyConstellationPalette.elevated.opacity(0.6))
                                        )
                                }
                            }
                        }
                        .replyConstellationCard()
                    }
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        if !service.profileErrorMessage.isEmpty {
                            Text(service.profileErrorMessage)
                                .font(.callout)
                                .foregroundStyle(ReplyConstellationPalette.danger)
                        }
                        emptyStatePanel(
                            title: "No profile selected",
                            detail: "Pick a conversation to load its contact profile."
                        )
                    }
                }

                if !service.profileSaveErrorMessage.isEmpty {
                    Text(service.profileSaveErrorMessage)
                        .font(.caption)
                        .foregroundStyle(ReplyConstellationPalette.danger)
                }
            }
            .padding(20)
        }
        .background(ReplyConstellationPalette.panel.opacity(0.72))
    }

    private var offlinePane: some View {
        VStack(spacing: 18) {
            Image(systemName: "desktopcomputer.trianglebadge.exclamationmark")
                .font(.system(size: 48, weight: .semibold))
                .foregroundStyle(ReplyConstellationPalette.warning)
            Text("{reply} runtime is not connected")
                .font(.title.weight(.bold))
            Text("Launch the local runtime and the native workspace will populate automatically.")
                .foregroundStyle(ReplyConstellationPalette.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
            HStack(spacing: 14) {
                Button("Launch runtime") {
                    service.launchReply()
                }
                .buttonStyle(.borderedProminent)

                Button("Refresh") {
                    Task { await service.refreshHealth() }
                }
            }
            if !service.launchErrorMessage.isEmpty {
                Text(service.launchErrorMessage)
                    .font(.caption)
                    .foregroundStyle(ReplyConstellationPalette.danger)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(28)
        .background(ReplyConstellationPalette.canvas)
    }

    private var toolbarTitle: String {
        if service.workspaceMode == .dashboard {
            return "{reply}"
        }
        if let current = service.conversations.first(where: { $0.handle == service.selectedConversationHandle }) {
            return current.resolvedTitle
        }
        if let handle = service.selectedConversationHandle {
            return handle
        }
        return "{reply}"
    }

    private var selectedConversationTitle: String {
        if let current = service.conversations.first(where: { $0.handle == service.selectedConversationHandle }) {
            return current.resolvedTitle
        }
        return service.selectedProfile?.presentationDisplayName
            ?? service.selectedProfile?.displayName
            ?? service.selectedConversationHandle
            ?? "{reply}"
    }

    private var selectedConversationSubtitle: String {
        if let current = service.conversations.first(where: { $0.handle == service.selectedConversationHandle }) {
            return current.resolvedPreview
        }
        return service.selectedConversationHandle ?? ""
    }

    private var channelGlyph: some View {
        Image(systemName: service.workspaceMode == .dashboard ? "square.grid.2x2" : "message")
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(ReplyConstellationPalette.textPrimary)
    }

    private var runtimeIndicator: some View {
        Circle()
            .fill(runtimeIndicatorColor)
            .frame(width: 14, height: 14)
            .overlay(
                Circle()
                    .stroke(runtimeIndicatorColor.opacity(0.3), lineWidth: 8)
            )
            .accessibilityLabel(service.runtimeState.label)
    }

    private var runtimeIndicatorColor: Color {
        switch service.runtimeState {
        case .online: ReplyConstellationPalette.success
        case .starting: ReplyConstellationPalette.warning
        case .offline, .unknown: ReplyConstellationPalette.textSecondary
        case .error: ReplyConstellationPalette.danger
        }
    }

    private func loadingPanel(_ text: String) -> some View {
        VStack(spacing: 14) {
            ProgressView()
                .controlSize(.large)
            Text(text)
                .foregroundStyle(ReplyConstellationPalette.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(28)
        .background(ReplyConstellationPalette.canvas)
    }

    private func emptyStatePanel(title: String, detail: String) -> some View {
        VStack(spacing: 12) {
            Text(title)
                .font(.title3.weight(.semibold))
            Text(detail)
                .multilineTextAlignment(.center)
                .foregroundStyle(ReplyConstellationPalette.textSecondary)
                .frame(maxWidth: 360)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(28)
        .background(ReplyConstellationPalette.canvas)
    }

    private func profileReadOnlyField(_ title: String, value: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.caption.weight(.semibold))
                .foregroundStyle(ReplyConstellationPalette.textSecondary)
            Text(cleanProfileValue(value))
                .font(.body)
                .foregroundStyle(ReplyConstellationPalette.textPrimary)
        }
    }

    private func editableProfileField(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .font(.caption.weight(.semibold))
                .foregroundStyle(ReplyConstellationPalette.textSecondary)
            TextField(title, text: text)
                .textFieldStyle(.roundedBorder)
        }
    }

    private func editableProfileTextArea(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .font(.caption.weight(.semibold))
                .foregroundStyle(ReplyConstellationPalette.textSecondary)
            TextEditor(text: text)
                .frame(minHeight: 88, maxHeight: 140)
                .padding(8)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(ReplyConstellationPalette.elevated.opacity(0.7))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(ReplyConstellationPalette.border, lineWidth: 1)
                )
        }
    }

    @ViewBuilder
    private func profileChannelList(title: String, values: [String]?) -> some View {
        if let values, !values.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(title.uppercased())
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(ReplyConstellationPalette.textSecondary)
                ForEach(values, id: \.self) { value in
                    Text(value)
                        .foregroundStyle(ReplyConstellationPalette.textPrimary)
                }
            }
        }
    }

    private func cleanProfileValue(_ value: String?) -> String {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "Not set" : trimmed
    }

    private func toneColor(for status: String) -> Color {
        switch status.lowercased() {
        case "pass", "ok", "online", "healthy": ReplyConstellationPalette.success
        case "warn", "warning", "starting", "running": ReplyConstellationPalette.warning
        case "error", "failed", "offline", "blocked": ReplyConstellationPalette.danger
        default: ReplyConstellationPalette.textSecondary
        }
    }

    @MainActor
    private func bootstrapWorkspaceIfNeeded() async {
        guard !hasBootstrappedWorkspace else { return }
        guard service.selectedConversationHandle == nil, let first = service.conversations.first else { return }
        hasBootstrappedWorkspace = true
        await service.loadConversation(handle: first.handle)
    }
}

private struct WorkspaceIconButton: View {
    let systemName: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(ReplyConstellationPalette.textPrimary)
                .frame(width: 30, height: 30)
        }
        .buttonStyle(.plain)
        .help(label)
    }
}

private struct ConversationRow: View {
    let conversation: ReplyConversation
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(conversation.resolvedTitle)
                            .font(.headline)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Text(conversation.unreadLabel)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(ReplyConstellationPalette.textSecondary)
                    }

                    if !conversation.resolvedPreview.isEmpty {
                        Text(conversation.resolvedPreview)
                            .font(.subheadline)
                            .foregroundStyle(ReplyConstellationPalette.textSecondary)
                            .lineLimit(2)
                    }
                }

                Image(systemName: channelSymbol(for: conversation.channel))
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(channelColor(for: conversation.channel))
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(isSelected ? ReplyConstellationPalette.accent.opacity(0.22) : ReplyConstellationPalette.panel.opacity(0.38))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(isSelected ? ReplyConstellationPalette.accent : ReplyConstellationPalette.border.opacity(0.55), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func channelSymbol(for value: String?) -> String {
        switch value?.lowercased() {
        case "whatsapp": "message.circle.fill"
        case "email": "envelope.fill"
        case "linkedin": "person.2.square.stack.fill"
        default: "message.fill"
        }
    }

    private func channelColor(for value: String?) -> Color {
        switch value?.lowercased() {
        case "whatsapp": ReplyConstellationPalette.success
        case "email": ReplyConstellationPalette.accent
        case "linkedin": ReplyConstellationPalette.warning
        default: ReplyConstellationPalette.accent
        }
    }
}

private struct ReplyMessageTimeline: View {
    let messages: [ReplyMessage]

    private var orderedMessages: [ReplyMessage] {
        messages.sorted { lhs, rhs in
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
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    ForEach(orderedMessages) { message in
                        MessageBubble(message: message)
                            .id(message.id)
                    }
                }
                .padding(22)
            }
            .onAppear {
                scrollToBottom(with: proxy)
            }
            .onChange(of: messages.count) { _, _ in
                scrollToBottom(with: proxy)
            }
        }
    }

    private func scrollToBottom(with proxy: ScrollViewProxy) {
        guard let lastId = orderedMessages.last?.id else { return }
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo(lastId, anchor: .bottom)
            }
        }
    }

    private func parsedDate(_ raw: String?) -> Date? {
        let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !value.isEmpty else { return nil }
        if let date = ISO8601DateFormatter().date(from: value) {
            return date
        }
        return nil
    }
}

private struct MessageBubble: View {
    let message: ReplyMessage

    var body: some View {
        HStack {
            if message.authoredByMe { Spacer(minLength: 60) }

            VStack(alignment: .leading, spacing: 8) {
                if !messageBody.isEmpty {
                    Text(messageBody)
                        .font(.body)
                        .foregroundStyle(message.authoredByMe ? ReplyConstellationPalette.chrome : ReplyConstellationPalette.textPrimary)
                        .textSelection(.enabled)
                }
                if !attachments.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(attachments.enumerated()), id: \.offset) { _, attachment in
                            HStack(spacing: 8) {
                                Image(systemName: attachment.symbol)
                                    .font(.system(size: 13, weight: .semibold))
                                Text(attachment.label)
                                    .font(.subheadline.weight(.medium))
                                    .lineLimit(2)
                            }
                            .foregroundStyle(message.authoredByMe ? ReplyConstellationPalette.chrome : ReplyConstellationPalette.textPrimary)
                        }
                    }
                    .padding(.top, messageBody.isEmpty ? 0 : 2)
                }
                HStack(spacing: 8) {
                    Text(message.date ?? "")
                    if let channel = message.channel, !channel.isEmpty {
                        Text(channel.capitalized)
                    }
                }
                .font(.caption)
                .foregroundStyle(message.authoredByMe ? ReplyConstellationPalette.chrome.opacity(0.8) : ReplyConstellationPalette.textSecondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(message.authoredByMe ? ReplyConstellationPalette.accent : ReplyConstellationPalette.panel.opacity(0.92))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(message.authoredByMe ? ReplyConstellationPalette.accent : ReplyConstellationPalette.border.opacity(0.5), lineWidth: 1)
            )
            .frame(maxWidth: 620, alignment: message.authoredByMe ? .trailing : .leading)

            if !message.authoredByMe { Spacer(minLength: 60) }
        }
        .frame(maxWidth: .infinity, alignment: message.authoredByMe ? .trailing : .leading)
    }

    private var parsedContent: ParsedMessageContent {
        ParsedMessageContent(text: message.text)
    }

    private var messageBody: String {
        let trimmed = parsedContent.body.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty && attachments.isEmpty {
            return "Empty message"
        }
        return trimmed
    }

    private var attachments: [ParsedAttachment] {
        parsedContent.attachments
    }
}

private struct DashboardMetricGrid: View {
    @ObservedObject var service: ReplyCoreService

    private let columns = [
        GridItem(.flexible(minimum: 180), spacing: 16),
        GridItem(.flexible(minimum: 180), spacing: 16),
        GridItem(.flexible(minimum: 180), spacing: 16)
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 16) {
            MetricCard(
                title: "Runtime",
                value: service.runtimeState.label,
                subtitle: service.health?.statusMessage ?? "Local native workspace"
            )
            MetricCard(
                title: "Conversations",
                value: "\(service.health?.stats?.total ?? service.conversations.count)",
                subtitle: "Visible conversation threads"
            )
            MetricCard(
                title: "Drafts",
                value: "\(service.health?.stats?.draft ?? 0)",
                subtitle: "Pending drafted replies"
            )
            MetricCard(
                title: "Active",
                value: "\(service.health?.stats?.active ?? 0)",
                subtitle: "Active tracked threads"
            )
            MetricCard(
                title: "Resolved",
                value: "\(service.health?.stats?.resolved ?? 0)",
                subtitle: "Resolved threads"
            )
            MetricCard(
                title: "Knowledge Inputs",
                value: "\(knowledgeInputCount)",
                subtitle: "Notes, calendar, contacts, KYC"
            )
        }
    }

    private var knowledgeInputCount: Int {
        let keys = ["notes", "calendar", "contacts", "kyc"]
        return keys.reduce(0) { partial, key in
            let channel = service.health?.channels?[key]
            return partial + max(channel?.total ?? 0, channel?.processed ?? 0)
        }
    }
}

private struct MetricCard: View {
    let title: String
    let value: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased())
                .font(.caption.weight(.semibold))
                .foregroundStyle(ReplyConstellationPalette.textSecondary)
            Text(value)
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(ReplyConstellationPalette.textPrimary)
            Text(subtitle)
                .foregroundStyle(ReplyConstellationPalette.textSecondary)
        }
        .replyConstellationCard()
    }
}

private struct DashboardSourceSection: View {
    @ObservedObject var service: ReplyCoreService

    private let columns = [
        GridItem(.flexible(minimum: 240), spacing: 16),
        GridItem(.flexible(minimum: 240), spacing: 16)
    ]

    private let conversationKeys = ["imessage", "whatsapp", "mail"]
    private let knowledgeKeys = ["notes", "calendar", "contacts", "kyc"]
    private let deferredKeys = ["linkedin_messages", "linkedin_posts"]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            sourceGroup("Conversation Sources", keys: conversationKeys)
            sourceGroup("Knowledge Inputs", keys: knowledgeKeys)
            sourceGroup("Deferred Connectors", keys: deferredKeys)
        }
    }

    @ViewBuilder
    private func sourceGroup(_ title: String, keys: [String]) -> some View {
        let cards = keys.compactMap { key -> (String, ChannelHealth)? in
            guard let health = service.health?.channels?[key] else { return nil }
            return (key, health)
        }
        if !cards.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text(title)
                    .font(.headline)
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(cards, id: \.0) { pair in
                        let key = pair.0
                        let health = pair.1
                        DashboardSourceCard(
                            title: sourceTitle(for: key),
                            subtitle: health.message ?? "No status message yet.",
                            count: max(health.total ?? 0, health.processed ?? 0),
                            state: health.state ?? "unknown",
                            lastSuccessfulSync: health.lastSuccessfulSync ?? health.lastSync,
                            lastAttemptedSync: health.lastAttemptedSync,
                            syncTitle: syncTitle(for: key),
                            syncInFlight: syncInFlight(for: key),
                            syncAction: syncChannel(for: key).map { channel in
                                { Task { await service.triggerSync(channel) } }
                            }
                        )
                    }
                }
            }
        }
    }

    private func sourceTitle(for key: String) -> String {
        switch key {
        case "imessage": return "iMessage"
        case "whatsapp": return "WhatsApp"
        case "mail": return "Mail"
        case "notes": return "Apple Notes"
        case "calendar": return "Apple Calendar"
        case "contacts": return "Apple Contacts"
        case "kyc": return "Contact Intelligence"
        case "linkedin_messages": return "LinkedIn Messages"
        case "linkedin_posts": return "LinkedIn Posts"
        default: return key.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private func syncTitle(for key: String) -> String {
        switch key {
        case "kyc": return "Refresh"
        default: return "Sync now"
        }
    }

    private func syncChannel(for key: String) -> SyncChannel? {
        switch key {
        case "imessage": return .imessage
        case "whatsapp": return .whatsapp
        case "mail": return .mail
        case "notes": return .notes
        case "calendar": return .calendar
        case "contacts": return .contacts
        case "kyc": return .kyc
        default: return nil
        }
    }

    private func syncInFlight(for key: String) -> Bool {
        guard let channel = syncChannel(for: key) else { return false }
        return service.syncInFlight.contains(channel)
    }
}

private struct DashboardSourceCard: View {
    let title: String
    let subtitle: String
    let count: Int
    let state: String
    let lastSuccessfulSync: String?
    let lastAttemptedSync: String?
    let syncTitle: String
    let syncInFlight: Bool
    let syncAction: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title.uppercased())
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(ReplyConstellationPalette.textSecondary)
                    Text("\(count)")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(ReplyConstellationPalette.textPrimary)
                }
                Spacer()
                NativeStatusPill(text: state, tint: toneColor)
            }

            Text(subtitle)
                .foregroundStyle(ReplyConstellationPalette.textSecondary)
                .lineLimit(3)

            VStack(alignment: .leading, spacing: 4) {
                if let lastSuccessfulSync, !lastSuccessfulSync.isEmpty {
                    Text("Last successful sync: \(lastSuccessfulSync)")
                }
                if let lastAttemptedSync, !lastAttemptedSync.isEmpty {
                    Text("Last attempted sync: \(lastAttemptedSync)")
                }
            }
            .font(.caption)
            .foregroundStyle(ReplyConstellationPalette.textSecondary)

            if let syncAction {
                Button(syncInFlight ? "Working..." : syncTitle, action: syncAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(syncInFlight)
            }
        }
        .replyConstellationCard()
    }

    private var toneColor: Color {
        switch state.lowercased() {
        case "ok", "online", "idle", "running", "healthy":
            return ReplyConstellationPalette.success
        case "warning", "warn", "starting", "degraded":
            return ReplyConstellationPalette.warning
        case "error", "blocked", "offline", "repair_required":
            return ReplyConstellationPalette.danger
        default:
            return ReplyConstellationPalette.textSecondary
        }
    }
}

private struct ParsedAttachment: Hashable {
    let label: String
    let symbol: String
}

private struct ParsedMessageContent {
    let body: String
    let attachments: [ParsedAttachment]

    init(text: String?) {
        let raw = text ?? ""
        let pattern = #"\[ATTACHMENTS:\s*(\[.*\])\]"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]),
              let match = regex.firstMatch(in: raw, range: NSRange(raw.startIndex..., in: raw)),
              let jsonRange = Range(match.range(at: 1), in: raw)
        else {
            body = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            attachments = []
            return
        }

        let json = String(raw[jsonRange])
        let stripped = regex.stringByReplacingMatches(in: raw, range: NSRange(raw.startIndex..., in: raw), withTemplate: "")
        body = stripped.trimmingCharacters(in: .whitespacesAndNewlines)
        attachments = Self.parseAttachments(json)
    }

    private static func parseAttachments(_ json: String) -> [ParsedAttachment] {
        guard let data = json.data(using: .utf8),
              let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else {
            return []
        }
        return array.map { item in
            let name = (item["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let mime = (item["mime"] as? String)?.lowercased() ?? ""
            let fallback = attachmentFallbackName(for: mime)
            return ParsedAttachment(
                label: (name?.isEmpty == false ? name! : fallback),
                symbol: attachmentSymbol(for: mime)
            )
        }
    }

    private static func attachmentSymbol(for mime: String) -> String {
        if mime.hasPrefix("image/") { return "photo" }
        if mime.hasPrefix("video/") { return "video" }
        if mime.hasPrefix("audio/") { return "waveform" }
        if mime == "application/pdf" { return "doc.richtext" }
        return "paperclip"
    }

    private static func attachmentFallbackName(for mime: String) -> String {
        if mime.hasPrefix("image/") { return "Image" }
        if mime.hasPrefix("video/") { return "Video" }
        if mime.hasPrefix("audio/") { return "Audio" }
        if mime == "application/pdf" { return "PDF" }
        return "Attachment"
    }
}

private struct NativeStatusPill: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text.capitalized)
            .font(.caption.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                Capsule(style: .continuous)
                    .fill(tint.opacity(0.14))
            )
    }
}
