import AppKit
import Foundation

let outputPath = CommandLine.arguments.dropFirst().first

guard let outputPath else {
    fputs("usage: swift generate_app_icon.swift /path/to/output.png\n", stderr)
    exit(1)
}

let size = CGSize(width: 1024, height: 1024)
let image = NSImage(size: size)

image.lockFocus()

guard let context = NSGraphicsContext.current?.cgContext else {
    fputs("failed to acquire graphics context\n", stderr)
    exit(1)
}

let bounds = CGRect(origin: .zero, size: size)
let backgroundPath = NSBezierPath(
    roundedRect: bounds.insetBy(dx: 24, dy: 24),
    xRadius: 224,
    yRadius: 224
)
backgroundPath.addClip()

let colorSpace = CGColorSpaceCreateDeviceRGB()
let backgroundGradient = CGGradient(
    colorsSpace: colorSpace,
    colors: [
        NSColor(calibratedRed: 0.45, green: 0.71, blue: 1.0, alpha: 1.0).cgColor,
        NSColor(calibratedRed: 0.15, green: 0.39, blue: 0.92, alpha: 1.0).cgColor,
        NSColor(calibratedRed: 0.08, green: 0.23, blue: 0.61, alpha: 1.0).cgColor,
    ] as CFArray,
    locations: [0.0, 0.55, 1.0]
)!

context.drawLinearGradient(
    backgroundGradient,
    start: CGPoint(x: 132, y: 92),
    end: CGPoint(x: 888, y: 940),
    options: []
)

let glowGradient = CGGradient(
    colorsSpace: colorSpace,
    colors: [
        NSColor.white.withAlphaComponent(0.28).cgColor,
        NSColor.white.withAlphaComponent(0.0).cgColor,
    ] as CFArray,
    locations: [0.0, 1.0]
)!

context.saveGState()
let glowPath = NSBezierPath(roundedRect: bounds.insetBy(dx: 24, dy: 24), xRadius: 224, yRadius: 224)
glowPath.addClip()
context.drawRadialGradient(
    glowGradient,
    startCenter: CGPoint(x: 290, y: 814),
    startRadius: 0,
    endCenter: CGPoint(x: 290, y: 814),
    endRadius: 589,
    options: []
)
context.restoreGState()

NSColor.white.withAlphaComponent(0.06).setFill()
NSBezierPath(roundedRect: CGRect(x: 122, y: 736, width: 780, height: 166), xRadius: 44, yRadius: 44).fill()

context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: -34), blur: 56, color: NSColor(calibratedWhite: 0.02, alpha: 0.22).cgColor)

let plateRect = CGRect(x: 240, y: 260, width: 544, height: 544)
let platePath = NSBezierPath(roundedRect: plateRect, xRadius: 148, yRadius: 148)

let plateGradient = CGGradient(
    colorsSpace: colorSpace,
    colors: [
        NSColor.white.cgColor,
        NSColor(calibratedRed: 0.92, green: 0.95, blue: 1.0, alpha: 1.0).cgColor,
    ] as CFArray,
    locations: [0.0, 1.0]
)!

context.saveGState()
platePath.addClip()
context.drawLinearGradient(
    plateGradient,
    start: CGPoint(x: 512, y: 804),
    end: CGPoint(x: 512, y: 260),
    options: []
)
context.restoreGState()

NSColor.white.withAlphaComponent(0.55).setStroke()
platePath.lineWidth = 8
platePath.stroke()
context.restoreGState()

let monogram = NSMutableParagraphStyle()
monogram.alignment = .center

let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 272, weight: .bold),
    .foregroundColor: NSColor(calibratedRed: 0.09, green: 0.36, blue: 1.0, alpha: 1.0),
    .paragraphStyle: monogram,
]

context.saveGState()
context.setShadow(
    offset: CGSize(width: 0, height: -22),
    blur: 44,
    color: NSColor.black.withAlphaComponent(0.28).cgColor
)
let text = NSAttributedString(string: "{0}", attributes: attributes)
text.draw(in: CGRect(x: 120, y: 390, width: 784, height: 280))
context.restoreGState()

let accentBar = NSBezierPath(
    roundedRect: CGRect(x: 304, y: 306, width: 416, height: 28),
    xRadius: 14,
    yRadius: 14
)
NSColor(calibratedRed: 0.28, green: 0.60, blue: 1.0, alpha: 0.95).setFill()
accentBar.fill()

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
    fputs("failed to create PNG representation\n", stderr)
    exit(1)
}

let outputURL = URL(fileURLWithPath: outputPath)
try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
try png.write(to: outputURL)
