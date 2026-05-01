// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ReplyApp",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "reply", targets: ["ReplyApp"]),
        .executable(name: "reply-helper", targets: ["ReplyHelper"])
    ],
    targets: [
        .executableTarget(
            name: "ReplyApp",
            path: "Sources",
            exclude: ["ReplyHelper"]
        ),
        .executableTarget(
            name: "ReplyHelper",
            path: "Sources/ReplyHelper"
        )
    ]
)
