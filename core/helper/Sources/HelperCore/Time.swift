import Foundation

let appleEpochOffsetSeconds: Int64 = 978_307_200

/// Messages stores Apple-epoch dates as nanoseconds (modern) or seconds (old rows). Zero or negative maps to 0
/// so the service can quarantine rows without a real timestamp.
public func appleToUnixMs(_ raw: Int64) -> Int64 {
    if raw <= 0 { return 0 }
    let seconds = raw > 100_000_000_000_000 ? raw / 1_000_000_000 : raw
    return (seconds + appleEpochOffsetSeconds) * 1000
}
