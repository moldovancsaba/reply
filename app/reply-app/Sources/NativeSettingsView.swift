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

            Text("Trinity drafting roles")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ReplyConstellationPalette.textSecondary)

            TextField("Trinity generator model", text: Binding(
                get: { service.settingsDraft.ai.trinityGeneratorModel ?? "granite4:350m" },
                set: { service.settingsDraft.ai.trinityGeneratorModel = $0 }
            ))

            TextField("Trinity refiner model", text: Binding(
                get: { service.settingsDraft.ai.trinityRefinerModel ?? "mistral:latest" },
                set: { service.settingsDraft.ai.trinityRefinerModel = $0 }
            ))

            TextField("Trinity evaluator model", text: Binding(
                get: { service.settingsDraft.ai.trinityEvaluatorModel ?? "qwen2.5:7b" },
                set: { service.settingsDraft.ai.trinityEvaluatorModel = $0 }
            ))
        }
        .modifier(NativeCardStyle())
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
}

private struct NativeCardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .replyConstellationCard()
    }
}
