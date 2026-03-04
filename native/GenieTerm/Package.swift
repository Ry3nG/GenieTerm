// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "GenieTerm",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "GenieTerm", targets: ["GenieTerm"]),
    ],
    targets: [
        .systemLibrary(
            name: "CGenieTerm",
            path: "Sources/CGenieTerm"
        ),
        .executableTarget(
            name: "GenieTerm",
            dependencies: ["CGenieTerm"],
            path: "Sources/GenieTerm",
            resources: [
                .process("Resources")
            ],
            linkerSettings: [
                .unsafeFlags([
                    "-L../../target/debug",
                    "-L../../target/release",
                    "-lgenieterm_ffi",
                ]),
            ]
        ),
    ]
)
