import AppKit
import SwiftUI

enum ReplyConstellationPalette {
    static let chrome = adaptiveReplyColor(light: NSColor(red: 0.97, green: 0.98, blue: 1.0, alpha: 1), dark: NSColor(red: 0.06, green: 0.07, blue: 0.09, alpha: 1))
    static let canvas = adaptiveReplyColor(light: NSColor(red: 0.92, green: 0.95, blue: 0.99, alpha: 1), dark: NSColor(red: 0.08, green: 0.10, blue: 0.12, alpha: 1))
    static let panel = adaptiveReplyColor(light: NSColor.white.withAlphaComponent(0.94), dark: NSColor(red: 0.13, green: 0.15, blue: 0.18, alpha: 0.98))
    static let elevated = adaptiveReplyColor(light: NSColor(red: 0.89, green: 0.93, blue: 0.98, alpha: 1), dark: NSColor(red: 0.17, green: 0.20, blue: 0.24, alpha: 1))
    static let border = adaptiveReplyColor(light: NSColor(red: 0.76, green: 0.83, blue: 0.92, alpha: 1), dark: NSColor(red: 0.26, green: 0.30, blue: 0.35, alpha: 1))
    static let textPrimary = adaptiveReplyColor(light: NSColor(red: 0.08, green: 0.14, blue: 0.24, alpha: 1), dark: NSColor(red: 0.95, green: 0.94, blue: 0.92, alpha: 1))
    static let textSecondary = adaptiveReplyColor(light: NSColor(red: 0.28, green: 0.37, blue: 0.50, alpha: 1), dark: NSColor(red: 0.76, green: 0.74, blue: 0.70, alpha: 1))
    static let accent = adaptiveReplyColor(light: NSColor(red: 0.20, green: 0.43, blue: 0.96, alpha: 1), dark: NSColor(red: 0.36, green: 0.63, blue: 1.0, alpha: 1))
    static let success = adaptiveReplyColor(light: NSColor(red: 0.16, green: 0.48, blue: 0.28, alpha: 1), dark: NSColor(red: 0.31, green: 0.77, blue: 0.48, alpha: 1))
    static let warning = adaptiveReplyColor(light: NSColor(red: 0.66, green: 0.42, blue: 0.0, alpha: 1), dark: NSColor(red: 0.88, green: 0.63, blue: 0.20, alpha: 1))
    static let danger = adaptiveReplyColor(light: NSColor(red: 0.69, green: 0.23, blue: 0.18, alpha: 1), dark: NSColor(red: 0.89, green: 0.40, blue: 0.35, alpha: 1))
}

private func adaptiveReplyColor(light: NSColor, dark: NSColor) -> Color {
    Color(
        nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
        }
    )
}

struct ReplyConstellationShell<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    ReplyConstellationPalette.chrome,
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
