// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "GenieTerm",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "GenieTerm", targets: ["GenieTerm"]),
        .executable(name: "GenieTermE2EBench", targets: ["GenieTermE2EBench"]),
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
        .executableTarget(
            name: "GenieTermE2EBench",
            dependencies: ["CGenieTerm"],
            path: "Sources/GenieTermE2EBench",
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
