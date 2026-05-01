// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "reply-app",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "reply", targets: ["replyshell"]),
        .executable(name: "reply-helper", targets: ["replyhelper"])
    ],
    targets: [
        .executableTarget(
            name: "replyshell",
            path: "Sources",
            exclude: ["ReplyHelper"]
        ),
        .executableTarget(
            name: "replyhelper",
            path: "Sources/ReplyHelper"
        )
    ]
)
