import AppKit
import SwiftUI

enum ReplyConstellationPalette {
    static let canvas = adaptiveReplyColor(light: NSColor(red: 0.93, green: 0.96, blue: 1.0, alpha: 1), dark: NSColor(red: 0.07, green: 0.08, blue: 0.10, alpha: 1))
    static let panel = adaptiveReplyColor(light: NSColor.white.withAlphaComponent(0.92), dark: NSColor(red: 0.11, green: 0.13, blue: 0.15, alpha: 0.96))
    static let elevated = adaptiveReplyColor(light: NSColor(red: 0.88, green: 0.92, blue: 0.98, alpha: 1), dark: NSColor(red: 0.14, green: 0.16, blue: 0.19, alpha: 1))
    static let border = adaptiveReplyColor(light: NSColor(red: 0.77, green: 0.83, blue: 0.93, alpha: 1), dark: NSColor(red: 0.23, green: 0.25, blue: 0.29, alpha: 1))
    static let textPrimary = adaptiveReplyColor(light: NSColor(red: 0.09, green: 0.16, blue: 0.28, alpha: 1), dark: NSColor(red: 0.96, green: 0.94, blue: 0.91, alpha: 1))
    static let textSecondary = adaptiveReplyColor(light: NSColor(red: 0.27, green: 0.36, blue: 0.49, alpha: 1), dark: NSColor(red: 0.78, green: 0.74, blue: 0.69, alpha: 1))
    static let accent = adaptiveReplyColor(light: NSColor(red: 0.15, green: 0.39, blue: 0.92, alpha: 1), dark: NSColor(red: 0.30, green: 0.59, blue: 1.0, alpha: 1))
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
