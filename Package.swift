// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "SimpleMail",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "SimpleMail", path: "Sources/SimpleMail")
    ]
)
