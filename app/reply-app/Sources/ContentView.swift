import SwiftUI

struct ContentView: View {
    @ObservedObject var service: ReplyCoreService

    var body: some View {
        ReplyConstellationShell {
            ReplyNativeWorkspaceView(service: service)
                .frame(minWidth: 1180, minHeight: 760)
        }
    }
}
