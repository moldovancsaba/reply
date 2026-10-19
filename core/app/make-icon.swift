import AppKit

// Draws the {r} icon (a rounded square with the mark in white) into a PNG: swift make-icon.swift out.png
let size: CGFloat = 1024
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
let rect = NSRect(x: 100, y: 100, width: size - 200, height: size - 200)
let path = NSBezierPath(roundedRect: rect, xRadius: 185, yRadius: 185)
NSGradient(colors: [NSColor(red: 0.30, green: 0.20, blue: 0.85, alpha: 1), NSColor(red: 0.45, green: 0.30, blue: 0.95, alpha: 1)])!.draw(in: path, angle: -90)
let style = NSMutableParagraphStyle(); style.alignment = .center
let font = NSFont.systemFont(ofSize: 430, weight: .bold)
let text = NSAttributedString(string: "{r}", attributes: [.font: font, .foregroundColor: NSColor.white, .paragraphStyle: style])
let h = text.size().height
text.draw(in: NSRect(x: 100, y: 100 + (rect.height - h) / 2 + 20, width: rect.width, height: h))
image.unlockFocus()
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
