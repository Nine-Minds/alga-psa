// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "RemoteDesktopAgent",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "RemoteDesktopAgent",
            targets: ["RemoteDesktopAgent"]
        )
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "RemoteDesktopAgent",
            dependencies: ["RDAgentLib"],
            path: "RemoteDesktopAgent/Sources",
            swiftSettings: [
                .unsafeFlags(["-import-objc-header", "RemoteDesktopAgent/Sources/BridgingHeader.h"])
            ]
        ),
        .systemLibrary(
            name: "RDAgentLib",
            path: "RDAgentLib",
            pkgConfig: nil,
            providers: []
        )
    ]
)
