import SwiftUI

private enum ReplyThemeMode: String, CaseIterable {
    case system
    case light
    case dark

    var label: String {
        switch self {
        case .system: "Follow System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    var preferredColorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

@main
struct ReplyDesktopApp: App {
    @Environment(\.openWindow) private var openWindow
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var service = ReplyCoreService()
    @AppStorage("reply.theme.mode") private var themeModeRawValue = ReplyThemeMode.system.rawValue

    private var themeMode: ReplyThemeMode {
        get { ReplyThemeMode(rawValue: themeModeRawValue) ?? .system }
        set { themeModeRawValue = newValue.rawValue }
    }

    init() {
        let runtimeService = ReplyCoreService()
        _service = StateObject(wrappedValue: runtimeService)
        runtimeService.startMonitoring()
        Task {
            await runtimeService.refreshHealth()
        }
    }

    var body: some Scene {
        Window("reply", id: "workspace") {
            ContentView(service: service)
                .preferredColorScheme(themeMode.preferredColorScheme)
        }
        .defaultSize(width: 1380, height: 900)

        Window("Control Center", id: "control-center") {
            SystemStatusView(service: service)
                .preferredColorScheme(themeMode.preferredColorScheme)
                .frame(minWidth: 920, minHeight: 760)
        }
        .defaultSize(width: 980, height: 820)

        Settings {
            NativeSettingsView(service: service)
                .preferredColorScheme(themeMode.preferredColorScheme)
                .frame(minWidth: 760, minHeight: 720)
        }
        .commands {
            CommandGroup(replacing: .appInfo) {
                Button("About {reply}") {
                    NSApp.orderFrontStandardAboutPanel(nil)
                }
            }
            CommandGroup(after: .appInfo) {
                Button("Show Workspace") {
                    openWindow(id: "workspace")
                    NSApp.activate(ignoringOtherApps: true)
                }
                .keyboardShortcut("1", modifiers: [.command, .shift])

                Button("Show Control Center") {
                    openWindow(id: "control-center")
                    NSApp.activate(ignoringOtherApps: true)
                }
                .keyboardShortcut("2", modifiers: [.command, .shift])

                Divider()

                Button("Refresh Status") {
                    Task { await service.refreshHealth() }
                }
                .keyboardShortcut("r", modifiers: [.command, .shift])

                Button("Launch {reply} runtime") {
                    service.launchReply()
                }

                Button("Restart {reply} runtime") {
                    service.restartReply()
                }

                Button("Stop {reply} runtime") {
                    service.stopReply()
                }

                Divider()

                Button("Open Logs") {
                    service.openLogs()
                }
            }

            CommandMenu("Theme") {
                ForEach(ReplyThemeMode.allCases, id: \.rawValue) { mode in
                    Button(mode.label) {
                        themeModeRawValue = mode.rawValue
                    }
                }
            }
        }
    }
}
