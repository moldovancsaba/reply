import AppKit
import Foundation
import CoreText

public struct MenubarCore {
    public static func loadFont(name: String, primaryPath: String, fallbackPath: String) -> NSFont? {
        let primaryURL = URL(fileURLWithPath: primaryPath)
        let fallbackURL = URL(fileURLWithPath: fallbackPath)
        
        if FileManager.default.fileExists(atPath: primaryURL.path) {
            CTFontManagerRegisterFontsForURL(primaryURL as CFURL, .process, nil)
        } else if FileManager.default.fileExists(atPath: fallbackURL.path) {
            CTFontManagerRegisterFontsForURL(fallbackURL as CFURL, .process, nil)
        }
        
        return NSFont(name: name, size: 18)
    }

    public static func makeGlyphImage(font: NSFont, glyphName: String, color: NSColor, size: NSSize = NSSize(width: 18, height: 18)) -> NSImage {
        let image = NSImage(size: size)
        image.lockFocus()
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: color
        ]
        let glyph = NSString(string: glyphName)
        let textSize = glyph.size(withAttributes: attrs)
        let rect = NSRect(
            x: (size.width - textSize.width) / 2.0,
            y: (size.height - textSize.height) / 2.0 - 0.5,
            width: textSize.width,
            height: textSize.height
        )
        glyph.draw(in: rect, withAttributes: attrs)
        image.unlockFocus()
        image.isTemplate = false
        return image
    }

    @discardableResult
    public static func runShellCapture(_ command: String, workingDirectory: String) -> String {
        let process = Process()
        let out = Pipe()
        let err = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = ["-lc", "cd \"\(workingDirectory)\" && \(command)"]
        process.standardOutput = out
        process.standardError = err

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return ""
        }

        let data = out.fileHandleForReading.readDataToEndOfFile()
        let errData = err.fileHandleForReading.readDataToEndOfFile()
        let stdout = String(data: data, encoding: .utf8) ?? ""
        let stderr = String(data: errData, encoding: .utf8) ?? ""
        return stdout + (stderr.isEmpty ? "" : "\n" + stderr)
    }

    public static func runShell(_ command: String, workingDirectory: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = ["-lc", "cd \"\(workingDirectory)\" && \(command)"]
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        try? process.run()
    }
}
