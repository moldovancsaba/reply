// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "reply-core-helper",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "reply-core-helper", targets: ["reply-core-helper"])],
    targets: [
        .target(name: "HelperCore", swiftSettings: [.swiftLanguageMode(.v5)]),
        .executableTarget(
            name: "reply-core-helper",
            dependencies: ["HelperCore"],
            exclude: ["Info.plist"],
            swiftSettings: [.swiftLanguageMode(.v5)],
            // Embeds Info.plist so macOS can show the Contacts consent prompt for a command-line tool.
            linkerSettings: [.unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "Sources/reply-core-helper/Info.plist"])]
        ),
        .testTarget(name: "HelperCoreTests", dependencies: ["HelperCore"], swiftSettings: [.swiftLanguageMode(.v5)]),
    ]
)
