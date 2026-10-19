import Foundation

/// Decodes the `attributedBody` typedstream blob Messages uses when the plain `text` column is empty.
///
/// This is a bounds-checked reader of the one structure we need (the NSString payload), not NSUnarchiver:
/// NSUnarchiver raises an uncatchable Objective-C exception on truncated or corrupt blobs, which would crash the
/// export. Returns nil for anything that is not a well-formed attributed string.
///
/// Layout (macOS 26, verified against NSArchiver output in the tests):
///   "\x04\x0bstreamtyped" ... "NSString" 0x01 0x94 0x84 0x01 0x2b <length> <utf8 bytes> ...
/// <length> is one byte when < 0x80, 0x81 + UInt16 little endian, or 0x82 + UInt32 little endian.
public func decodeAttributedBody(_ data: Data?) -> String? {
    guard let data, data.count > 20 else { return nil }
    let bytes = [UInt8](data)
    let header: [UInt8] = [0x04, 0x0b] + Array("streamtyped".utf8)
    guard bytes.starts(with: header) else { return nil }
    let marker: [UInt8] = [0x01, 0x94, 0x84, 0x01, 0x2b]
    guard let at = firstIndex(of: marker, in: bytes, after: header.count) else { return nil }
    var i = at + marker.count
    guard i < bytes.count else { return nil }
    var length: Int
    switch bytes[i] {
    case 0x81:
        guard i + 2 < bytes.count else { return nil }
        length = Int(bytes[i + 1]) | Int(bytes[i + 2]) << 8
        i += 3
    case 0x82:
        guard i + 4 < bytes.count else { return nil }
        length = Int(bytes[i + 1]) | Int(bytes[i + 2]) << 8 | Int(bytes[i + 3]) << 16 | Int(bytes[i + 4]) << 24
        i += 5
    case let b where b < 0x80:
        length = Int(b)
        i += 1
    default:
        return nil
    }
    guard length >= 0, i + length <= bytes.count else { return nil }
    guard let s = String(bytes: bytes[i..<(i + length)], encoding: .utf8) else { return nil }
    return normalizeBody(s)
}

private func firstIndex(of needle: [UInt8], in hay: [UInt8], after start: Int) -> Int? {
    guard hay.count >= needle.count, start <= hay.count - needle.count else { return nil }
    for i in start...(hay.count - needle.count) where hay[i] == needle[0] && Array(hay[i..<(i + needle.count)]) == needle { return i }
    return nil
}

public func normalizeBody(_ value: String?) -> String {
    let raw = (value ?? "").replacingOccurrences(of: "\u{FFFC}", with: "")
    let lines = raw.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }
    return lines.joined(separator: "\n")
        .replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}
