import SwiftUI

struct ContentView: View {
    @ObservedObject var service: ReplyCoreService
    @StateObject private var workspaceStore = ReplyWorkspaceStore()

    var body: some View {
        ReplyConstellationShell {
            replyPane
                .frame(minWidth: 1180, minHeight: 760)
        }
    }

    private var replyPane: some View {
        Group {
            if service.baseURL != nil || workspaceStore.webView.url != nil {
                ReplyWebView(webView: workspaceStore.webView, url: service.baseURL)
            } else {
                VStack {
                    VStack(spacing: 16) {
                        Image(systemName: "desktopcomputer.trianglebadge.exclamationmark")
                            .font(.system(size: 44))
                            .foregroundStyle(ReplyConstellationPalette.textSecondary)
                        Text("reply runtime is not connected")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(ReplyConstellationPalette.textPrimary)
                        Text("Launch the local runtime from this app, then the reply interface will appear here.")
                            .multilineTextAlignment(.center)
                            .foregroundStyle(ReplyConstellationPalette.textSecondary)
                            .frame(maxWidth: 420)
                        HStack {
                            Button("Launch reply") {
                                service.launchReply()
                            }
                            .keyboardShortcut("r", modifiers: [.command, .shift])
                            Button("Refresh Status") {
                                Task { await service.refreshHealth() }
                            }
                        }
                    }
                    .replyConstellationCard()
                    .frame(maxWidth: 540)
                    .padding(24)
                    Spacer()
                        .frame(height: 1)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.clear)
            }
        }
    }
}
