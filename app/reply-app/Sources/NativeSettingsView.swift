import SwiftUI

struct NativeSettingsView: View {
    @ObservedObject var service: ReplyCoreService

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                aiSection
                workerSection
                healthSection
                syncSection
            }
            .padding(20)
        }
        .background(Color.clear)
        .task {
            await service.loadSettings(force: true)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Native Settings", systemImage: "gearshape.2.fill")
                    .font(.title2.weight(.semibold))
                Spacer()
                if service.isSavingSettings {
                    ProgressView()
                        .controlSize(.small)
                        .tint(ReplyConstellationPalette.accent)
                }
                Button("Reload") {
                    Task { await service.loadSettings(force: true) }
                }
                Button("Save") {
                    Task { await service.saveSettings() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(service.isSavingSettings || service.runtimeState != .online)
            }
            Text("Configure the shipped {reply} runtime directly from the native app. These controls replace the old browser-only operational settings surface.")
                .foregroundStyle(ReplyConstellationPalette.textSecondary)
            if !service.settingsLoadError.isEmpty {
                Text(service.settingsLoadError)
                    .font(.caption)
                    .foregroundStyle(ReplyConstellationPalette.danger)
            }
            if !service.settingsSaveError.isEmpty {
                Text(service.settingsSaveError)
                    .font(.caption)
                    .foregroundStyle(ReplyConstellationPalette.danger)
            }
        }
        .modifier(NativeCardStyle())
    }

    private var aiSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("AI Runtime", systemImage: "sparkles")
                .font(.headline)

            Picker("Draft runtime", selection: Binding(
                get: { service.settingsDraft.ai.draftRuntime ?? "auto" },
                set: { service.settingsDraft.ai.draftRuntime = $0 }
            )) {
                Text("Auto").tag("auto")
                Text("Ollama").tag("ollama")
            }
            .pickerStyle(.segmented)

            TextField("Ollama host", text: Binding(
                get: { service.settingsDraft.ai.ollamaHost ?? "" },
                set: { service.settingsDraft.ai.ollamaHost = $0 }
            ))

            numericField("Ollama port", value: Binding(
                get: { service.settingsDraft.ai.ollamaPort ?? 11434 },
                set: { service.settingsDraft.ai.ollamaPort = $0 }
            ))

            TextField("Primary draft model", text: Binding(
                get: { service.settingsDraft.ai.ollamaModel ?? "" },
                set: { service.settingsDraft.ai.ollamaModel = $0 }
            ))

            TextField("Annotation model", text: Binding(
                get: { service.settingsDraft.ai.annotationOllamaModel ?? "" },
                set: { service.settingsDraft.ai.annotationOllamaModel = $0 }
            ))

            TextField("Contact intelligence model", text: Binding(
                get: { service.settingsDraft.ai.kycOllamaModel ?? "" },
                set: { service.settingsDraft.ai.kycOllamaModel = $0 }
            ))

            Divider()

            Text("{trinity} drafting roles")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ReplyConstellationPalette.textSecondary)
            trinityRuntimeSummary

            TrinityRolePickerField(
                title: "{trinity} generator model",
                subtitle: "Fast draft route",
                text: Binding(
                    get: { service.settingsDraft.ai.trinityGeneratorModel ?? "granite4:350m" },
                    set: { service.settingsDraft.ai.trinityGeneratorModel = $0 }
                ),
                roleStatus: service.runtimeInfo?.trinity?.roles?.generator,
                models: service.runtimeInfo?.trinity?.availableModels ?? []
            )

            TrinityRolePickerField(
                title: "{trinity} refiner model",
                subtitle: "Writing and polish route",
                text: Binding(
                    get: { service.settingsDraft.ai.trinityRefinerModel ?? "mistral:latest" },
                    set: { service.settingsDraft.ai.trinityRefinerModel = $0 }
                ),
                roleStatus: service.runtimeInfo?.trinity?.roles?.refiner,
                models: service.runtimeInfo?.trinity?.availableModels ?? []
            )

            TrinityRolePickerField(
                title: "{trinity} evaluator model",
                subtitle: "Final judge route",
                text: Binding(
                    get: { service.settingsDraft.ai.trinityEvaluatorModel ?? "qwen2.5:7b" },
                    set: { service.settingsDraft.ai.trinityEvaluatorModel = $0 }
                ),
                roleStatus: service.runtimeInfo?.trinity?.roles?.evaluator,
                models: service.runtimeInfo?.trinity?.availableModels ?? []
            )
        }
        .modifier(NativeCardStyle())
    }

    @ViewBuilder
    private var trinityRuntimeSummary: some View {
        if let runtime = service.runtimeInfo?.trinity {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Runtime status")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    statusPill(runtime.providerStatus ?? "unknown", color: providerStatusColor(runtime.providerStatus))
                }

                HStack(spacing: 16) {
                    runtimeMetaItem("Provider", value: runtime.provider ?? "unknown")
                    runtimeMetaItem("Base URL", value: runtime.ollamaBaseURL ?? "unavailable")
                    runtimeMetaItem("Models", value: "\(runtime.availableModels?.count ?? 0)")
                }

                if let error = runtime.providerError, !error.isEmpty {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(ReplyConstellationPalette.danger)
                }
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(ReplyConstellationPalette.elevated.opacity(0.72))
            )
        } else {
            Text("Runtime inventory is loading. Save or reload after changing the provider route.")
                .font(.caption)
                .foregroundStyle(ReplyConstellationPalette.textSecondary)
        }
    }

    private var workerSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Background Worker", systemImage: "arrow.triangle.2.circlepath")
                .font(.headline)

            numericField("Poll interval (seconds)", value: Binding(
                get: { service.settingsDraft.worker.pollIntervalSeconds ?? 60 },
                set: { service.settingsDraft.worker.pollIntervalSeconds = $0 }
            ))

            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 12) {
                GridRow {
                    numericField("iMessage batch", value: Binding(
                        get: { service.settingsDraft.worker.quantities?.imessage ?? 1000 },
                        set: { service.settingsDraft.worker.quantities?.imessage = $0 }
                    ))
                    numericField("WhatsApp batch", value: Binding(
                        get: { service.settingsDraft.worker.quantities?.whatsapp ?? 500 },
                        set: { service.settingsDraft.worker.quantities?.whatsapp = $0 }
                    ))
                }
                GridRow {
                    numericField("Mail batch", value: Binding(
                        get: { service.settingsDraft.worker.quantities?.gmail ?? 500 },
                        set: { service.settingsDraft.worker.quantities?.gmail = $0 }
                    ))
                    numericField("Notes batch", value: Binding(
                        get: { service.settingsDraft.worker.quantities?.notes ?? 0 },
                        set: { service.settingsDraft.worker.quantities?.notes = $0 }
                    ))
                }
            }
        }
        .modifier(NativeCardStyle())
    }

    private var healthSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Runtime Health", systemImage: "heart.text.square")
                .font(.headline)
            numericField("Ollama probe timeout (ms)", value: Binding(
                get: { service.settingsDraft.health.ollamaProbeTimeoutMs ?? 3000 },
                set: { service.settingsDraft.health.ollamaProbeTimeoutMs = $0 }
            ))
            numericField("UI health poll interval (ms)", value: Binding(
                get: { service.settingsDraft.health.uiHealthPollIntervalMs ?? 15000 },
                set: { service.settingsDraft.health.uiHealthPollIntervalMs = $0 }
            ))
            HStack {
                Text("MDM state")
                    .foregroundStyle(ReplyConstellationPalette.textSecondary)
                Spacer()
                Text(service.managementState.label)
                    .fontWeight(.semibold)
            }
        }
        .modifier(NativeCardStyle())
    }

    private var syncSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Sync Center", systemImage: "tray.and.arrow.down.fill")
                .font(.headline)
            Text("Run source syncs without leaving the native app.")
                .foregroundStyle(ReplyConstellationPalette.textSecondary)

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 12)], spacing: 12) {
                ForEach(SyncChannel.allCases) { channel in
                    Button {
                        Task { await service.triggerSync(channel) }
                    } label: {
                        HStack {
                            if service.syncInFlight.contains(channel) {
                                ProgressView()
                                    .controlSize(.small)
                            }
                            Text(channel.title)
                            Spacer(minLength: 8)
                            Image(systemName: "arrow.clockwise")
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.bordered)
                    .disabled(service.runtimeState != .online || service.syncInFlight.contains(channel))
                }
            }
        }
        .modifier(NativeCardStyle())
    }

    private func numericField(_ title: String, value: Binding<Int>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .foregroundStyle(ReplyConstellationPalette.textSecondary)
            TextField(title, value: value, format: .number)
                .textFieldStyle(.roundedBorder)
        }
    }

    private func runtimeMetaItem(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(ReplyConstellationPalette.textSecondary)
            Text(value)
                .font(.callout.monospaced())
                .textSelection(.enabled)
        }
    }

    private func providerStatusColor(_ value: String?) -> Color {
        switch String(value ?? "").lowercased() {
        case "online":
            return ReplyConstellationPalette.success
        case "offline":
            return ReplyConstellationPalette.danger
        case "not_configured":
            return ReplyConstellationPalette.warning
        default:
            return ReplyConstellationPalette.textSecondary
        }
    }

    private func statusPill(_ label: String, color: Color) -> some View {
        Text(label.capitalized)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(
                Capsule(style: .continuous)
                    .fill(color.opacity(0.18))
            )
            .foregroundStyle(color)
    }
}

private struct NativeCardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .replyConstellationCard()
    }
}

private struct TrinityRolePickerField: View {
    let title: String
    let subtitle: String
    @Binding var text: String
    let roleStatus: TrinityRoleStatus?
    let models: [TrinityAvailableModel]

    @State private var suggestionsVisible = false

    private var filteredModels: [TrinityAvailableModel] {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let source = models.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        if query.isEmpty {
            return Array(source.prefix(8))
        }
        let prefixMatches = source.filter { $0.name.lowercased().hasPrefix(query) }
        let containsMatches = source.filter {
            !prefixMatches.contains($0) && $0.name.lowercased().contains(query)
        }
        return Array((prefixMatches + containsMatches).prefix(10))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(ReplyConstellationPalette.textSecondary)
                }
                Spacer()
                roleStatusBadge
            }

            HStack(spacing: 8) {
                TextField(title, text: $text)
                    .textFieldStyle(.roundedBorder)
                    .onTapGesture {
                        suggestionsVisible = true
                    }
                Button {
                    suggestionsVisible.toggle()
                } label: {
                    Image(systemName: suggestionsVisible ? "chevron.up.circle.fill" : "chevron.down.circle")
                }
                .buttonStyle(.plain)
                .foregroundStyle(ReplyConstellationPalette.accent)
                .help("Show installed model suggestions")
            }

            if suggestionsVisible {
                VStack(alignment: .leading, spacing: 6) {
                    if filteredModels.isEmpty {
                        Text("No installed models match the current input.")
                            .font(.caption)
                            .foregroundStyle(ReplyConstellationPalette.textSecondary)
                    } else {
                        ForEach(filteredModels) { model in
                            Button {
                                text = model.name
                                suggestionsVisible = false
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(model.name)
                                            .font(.callout.monospaced())
                                            .foregroundStyle(ReplyConstellationPalette.textPrimary)
                                        if let modifiedAt = model.modifiedAt, !modifiedAt.isEmpty {
                                            Text(modifiedAt)
                                                .font(.caption2)
                                                .foregroundStyle(ReplyConstellationPalette.textSecondary)
                                        }
                                    }
                                    Spacer()
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(ReplyConstellationPalette.success)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 8)
                                .background(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .fill(ReplyConstellationPalette.elevated.opacity(0.72))
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            if let roleStatus {
                HStack(spacing: 12) {
                    Text("Selected")
                        .font(.caption)
                        .foregroundStyle(ReplyConstellationPalette.textSecondary)
                    Text(roleStatus.model ?? text)
                        .font(.caption.monospaced())
                    Spacer()
                    Text("keep-alive \(roleStatus.keepAlive ?? "n/a")")
                        .font(.caption)
                        .foregroundStyle(ReplyConstellationPalette.textSecondary)
                }
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(ReplyConstellationPalette.elevated.opacity(0.48))
        )
    }

    @ViewBuilder
    private var roleStatusBadge: some View {
        let installed = roleStatus?.installed ?? false
        let color = installed ? ReplyConstellationPalette.success : ReplyConstellationPalette.warning
        let label = installed ? "Installed" : "Missing"
        Text(label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(
                Capsule(style: .continuous)
                    .fill(color.opacity(0.18))
            )
            .foregroundStyle(color)
    }
}
