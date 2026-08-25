// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "FeedReader",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "FeedReaderCore", targets: ["FeedReaderCore"]),
        .library(name: "FeedReaderUI", targets: ["FeedReaderUI"]),
        .executable(name: "FeedReaderApp", targets: ["FeedReaderApp"]),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "6.29.0"),
        .package(url: "https://github.com/scinfu/SwiftSoup.git", from: "2.7.0"),
        .package(url: "https://github.com/pointfreeco/swift-snapshot-testing.git", from: "1.17.0"),
    ],
    targets: [
        .target(
            name: "FeedReaderCore",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
                "SwiftSoup",
            ]
        ),
        .target(
            name: "FeedReaderUI",
            dependencies: ["FeedReaderCore", .product(name: "GRDB", package: "GRDB.swift")]
        ),
        .executableTarget(
            name: "FeedReaderApp",
            dependencies: ["FeedReaderCore", "FeedReaderUI"]
        ),
        .target(name: "TestSupport", path: "Sources/TestSupport"),
        .testTarget(
            name: "FeedReaderCoreTests",
            dependencies: ["FeedReaderCore", "TestSupport"]
        ),
        .testTarget(
            name: "FeedReaderUITests",
            dependencies: [
                "FeedReaderUI", "FeedReaderCore", "TestSupport",
                .product(name: "SnapshotTesting", package: "swift-snapshot-testing"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
