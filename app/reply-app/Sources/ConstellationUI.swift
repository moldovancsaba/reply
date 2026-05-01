import SwiftUI

enum ReplyConstellationPalette {
    static let canvas = Color(red: 0.07, green: 0.08, blue: 0.10)
    static let panel = Color(red: 0.11, green: 0.13, blue: 0.15)
    static let elevated = Color(red: 0.14, green: 0.16, blue: 0.19)
    static let border = Color(red: 0.23, green: 0.25, blue: 0.29)
    static let textPrimary = Color(red: 0.96, green: 0.94, blue: 0.91)
    static let textSecondary = Color(red: 0.78, green: 0.74, blue: 0.69)
    static let accent = Color(red: 0.86, green: 0.45, blue: 0.25)
    static let success = Color(red: 0.31, green: 0.77, blue: 0.48)
    static let warning = Color(red: 0.88, green: 0.63, blue: 0.20)
    static let danger = Color(red: 0.89, green: 0.40, blue: 0.35)
}

struct ReplyConstellationShell<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.06, green: 0.07, blue: 0.09),
                    ReplyConstellationPalette.canvas
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .overlay(
                RadialGradient(
                    colors: [ReplyConstellationPalette.accent.opacity(0.16), .clear],
                    center: .topLeading,
                    startRadius: 20,
                    endRadius: 420
                )
            )
            .ignoresSafeArea()

            content
        }
        .tint(ReplyConstellationPalette.accent)
    }
}

struct ReplyConstellationCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(ReplyConstellationPalette.panel.opacity(0.96))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(ReplyConstellationPalette.border, lineWidth: 1)
            )
    }
}

extension View {
    func replyConstellationCard() -> some View {
        modifier(ReplyConstellationCard())
    }
}
