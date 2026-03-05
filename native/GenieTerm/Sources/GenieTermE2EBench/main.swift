import AppKit
import CGenieTerm
import CoreText
import Foundation

private struct TerminalSnapshot: Decodable {
    let rows: UInt16
    let cols: UInt16
    let cursor_row: UInt16
    let cursor_col: UInt16
    let lines: [TerminalLine]
}

private struct TerminalLine: Decodable {
    let sig: UInt64
    let spans: [TerminalSpan]
}

private struct TerminalSpan: Decodable {
    let text: String
    let fg: UInt32
    let bg: UInt32
    let bold: Bool
    let italic: Bool
    let underline: Bool
}

private struct StageStats: Encodable {
    let p50_ms: Double
    let p95_ms: Double
    let max_ms: Double
    let samples: Int
}

private struct BenchConfig: Encodable {
    let cols: UInt16
    let rows: UInt16
    let command: String
    let idle_settle_ms: Int
    let timeout_ms: Int
    let min_samples: Int
    let input_latency_samples: Int
}

private struct E2EReport: Encodable {
    let schema_version: Int
    let benchmark: String
    let commit: String
    let platform: String
    let config: BenchConfig
    let frames: Int
    let final_snapshot_lines: Int
    let final_snapshot_json_bytes: Int
    let metrics: [String: Double]
    let total_runtime_ms: Double
}

private struct StyleKey: Hashable {
    let fg: UInt32
    let bg: UInt32
    let bold: Bool
    let italic: Bool
    let underline: Bool
}

private final class CoreTextBuilder {
    private let paragraphStyle: NSParagraphStyle = {
        let style = NSMutableParagraphStyle()
        style.lineSpacing = 0
        return style
    }()

    private var fontCache: [Int: NSFont] = [:]
    private var colorCache: [UInt32: NSColor] = [:]
    private var attrCache: [StyleKey: [NSAttributedString.Key: Any]] = [:]

    func buildLines(from snapshot: TerminalSnapshot) -> Int {
        var count = 0
        for line in snapshot.lines {
            let attributed = NSMutableAttributedString()
            attributed.beginEditing()
            for span in line.spans {
                attributed.append(NSAttributedString(string: span.text, attributes: attributes(for: span)))
            }
            attributed.endEditing()
            _ = CTLineCreateWithAttributedString(attributed as CFAttributedString)
            count += 1
        }
        return count
    }

    private func attributes(for span: TerminalSpan) -> [NSAttributedString.Key: Any] {
        let key = StyleKey(
            fg: span.fg,
            bg: span.bg,
            bold: span.bold,
            italic: span.italic,
            underline: span.underline
        )
        if let cached = attrCache[key] {
            return cached
        }

        var out: [NSAttributedString.Key: Any] = [
            .foregroundColor: color(from: span.fg, fallbackLabel: true),
            .font: font(for: span),
            .paragraphStyle: paragraphStyle
        ]

        let bg = color(from: span.bg, fallbackLabel: false)
        if bg.alphaComponent > 0.01 {
            out[.backgroundColor] = bg
        }
        if span.underline {
            out[.underlineStyle] = NSUnderlineStyle.single.rawValue
        }

        attrCache[key] = out
        return out
    }

    private func font(for span: TerminalSpan) -> NSFont {
        let k = (span.bold ? 1 : 0) | (span.italic ? 2 : 0)
        if let cached = fontCache[k] {
            return cached
        }

        let base = NSFont.monospacedSystemFont(ofSize: 13, weight: span.bold ? .semibold : .regular)
        let font: NSFont
        if span.italic {
            let descriptor = base.fontDescriptor.withSymbolicTraits(.italic)
            font = NSFont(descriptor: descriptor, size: 13) ?? base
        } else {
            font = base
        }
        fontCache[k] = font
        return font
    }

    private func color(from rgba: UInt32, fallbackLabel: Bool) -> NSColor {
        if let cached = colorCache[rgba] {
            return cached
        }
        if fallbackLabel && (rgba == 0xFFFFFFFF || rgba == 0x000000FF) {
            return .labelColor
        }
        let r = CGFloat((rgba >> 24) & 0xFF) / 255.0
        let g = CGFloat((rgba >> 16) & 0xFF) / 255.0
        let b = CGFloat((rgba >> 8) & 0xFF) / 255.0
        let a = CGFloat(rgba & 0xFF) / 255.0
        let c = NSColor(srgbRed: r, green: g, blue: b, alpha: a)
        colorCache[rgba] = c
        return c
    }
}

private struct Args {
    var outputPath: String?
    var command = "seq 1 100000"
    var cols: UInt16 = 120
    var rows: UInt16 = 50
    var idleSettleMs = 350
    var timeoutMs = 15_000
    var minSamples = 40
    var inputLatencySamples = 20
}

private func parseArgs() -> Args {
    var args = Args()
    let values = CommandLine.arguments
    var i = 1
    while i < values.count {
        switch values[i] {
        case "--output":
            if i + 1 < values.count {
                args.outputPath = values[i + 1]
                i += 1
            }
        case "--command":
            if i + 1 < values.count {
                args.command = values[i + 1]
                i += 1
            }
        case "--cols":
            if i + 1 < values.count, let v = UInt16(values[i + 1]) {
                args.cols = max(v, 10)
                i += 1
            }
        case "--rows":
            if i + 1 < values.count, let v = UInt16(values[i + 1]) {
                args.rows = max(v, 5)
                i += 1
            }
        case "--idle-settle-ms":
            if i + 1 < values.count, let v = Int(values[i + 1]) {
                args.idleSettleMs = max(50, v)
                i += 1
            }
        case "--timeout-ms":
            if i + 1 < values.count, let v = Int(values[i + 1]) {
                args.timeoutMs = max(1000, v)
                i += 1
            }
        case "--min-samples":
            if i + 1 < values.count, let v = Int(values[i + 1]) {
                args.minSamples = max(5, v)
                i += 1
            }
        case "--input-latency-samples":
            if i + 1 < values.count, let v = Int(values[i + 1]) {
                args.inputLatencySamples = max(5, v)
                i += 1
            }
        default:
            break
        }
        i += 1
    }
    return args
}

private func monotonicMs() -> Double {
    Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000.0
}

private func percentile(_ values: [Double], _ p: Double) -> Double {
    guard !values.isEmpty else { return 0 }
    let sorted = values.sorted()
    let idx = Int((Double(sorted.count - 1) * p).rounded())
    return sorted[min(max(idx, 0), sorted.count - 1)]
}

private func stageStats(_ samples: [Double]) -> StageStats {
    StageStats(
        p50_ms: percentile(samples, 0.50),
        p95_ms: percentile(samples, 0.95),
        max_ms: samples.max() ?? 0,
        samples: samples.count
    )
}

private func run() throws {
    let args = parseArgs()
    let startMs = monotonicMs()

    guard let handle = genieterm_create(args.cols, args.rows) else {
        throw NSError(domain: "GenieTermE2EBench", code: 1, userInfo: [
            NSLocalizedDescriptionKey: "failed to create terminal handle"
        ])
    }
    defer { genieterm_destroy(handle) }

    args.command.withCString { cStr in
        genieterm_send_command(handle, cStr)
    }

    let decoder = JSONDecoder()
    let coreTextBuilder = CoreTextBuilder()

    var pollSamples: [Double] = []
    var decodeSamples: [Double] = []
    var buildSamples: [Double] = []
    var frameSamples: [Double] = []
    var latestSnapshot = TerminalSnapshot(rows: 0, cols: 0, cursor_row: 0, cursor_col: 0, lines: [])
    var latestPayloadBytes = 0
    var frames = 0

    var lastVersion: UInt64 = 0
    var lastChangeAt = monotonicMs()
    let deadline = startMs + Double(args.timeoutMs)

    while monotonicMs() < deadline {
        let version = genieterm_snapshot_version(handle)
        let settled = frames > 0 && (monotonicMs() - lastChangeAt) >= Double(args.idleSettleMs)
        let hasVersionChange = version != lastVersion
        let needsMoreSamples = frames > 0 && frames < args.minSamples

        if hasVersionChange {
            lastVersion = version
            lastChangeAt = monotonicMs()
        } else if settled && !needsMoreSamples {
            break
        } else if !needsMoreSamples {
            usleep(5_000)
            continue
        }

        let frameStart = monotonicMs()

        let pollStart = monotonicMs()
        guard let cString = genieterm_poll_snapshot_json(handle) else {
            continue
        }
        let payload = String(cString: cString)
        genieterm_free_string(cString)
        let pollEnd = monotonicMs()

        let decodeStart = pollEnd
        guard let data = payload.data(using: .utf8) else {
            continue
        }
        let snapshot = try decoder.decode(TerminalSnapshot.self, from: data)
        let decodeEnd = monotonicMs()

        let buildStart = decodeEnd
        _ = coreTextBuilder.buildLines(from: snapshot)
        let buildEnd = monotonicMs()

        latestSnapshot = snapshot
        latestPayloadBytes = payload.utf8.count
        frames += 1

        pollSamples.append(pollEnd - pollStart)
        decodeSamples.append(decodeEnd - decodeStart)
        buildSamples.append(buildEnd - buildStart)
        frameSamples.append(buildEnd - frameStart)
    }

    if frames == 0 {
        throw NSError(domain: "GenieTermE2EBench", code: 2, userInfo: [
            NSLocalizedDescriptionKey: "no frames captured before timeout"
        ])
    }

    let pollStats = stageStats(pollSamples)
    let decodeStats = stageStats(decodeSamples)
    let buildStats = stageStats(buildSamples)
    let frameStats = stageStats(frameSamples)

    let report = E2EReport(
        schema_version: 1,
        benchmark: "swift_e2e_bench",
        commit: ProcessInfo.processInfo.environment["GIT_COMMIT"] ?? "unknown",
        platform: "\(ProcessInfo.processInfo.operatingSystemVersionString) (\(ProcessInfo.processInfo.hostName))",
        config: BenchConfig(
            cols: args.cols,
            rows: args.rows,
            command: args.command,
            idle_settle_ms: args.idleSettleMs,
            timeout_ms: args.timeoutMs,
            min_samples: args.minSamples,
            input_latency_samples: args.inputLatencySamples
        ),
        frames: frames,
        final_snapshot_lines: latestSnapshot.lines.count,
        final_snapshot_json_bytes: latestPayloadBytes,
        metrics: [
            "e2e_poll_json_ms_p50": pollStats.p50_ms,
            "e2e_poll_json_ms_p95": pollStats.p95_ms,
            "e2e_decode_ms_p50": decodeStats.p50_ms,
            "e2e_decode_ms_p95": decodeStats.p95_ms,
            "e2e_coretext_build_ms_p50": buildStats.p50_ms,
            "e2e_coretext_build_ms_p95": buildStats.p95_ms,
            "e2e_frame_total_ms_p50": frameStats.p50_ms,
            "e2e_frame_total_ms_p95": frameStats.p95_ms
        ],
        total_runtime_ms: monotonicMs() - startMs
    )

    let inputLatency = measureInputToRenderLatency(
        cols: args.cols,
        rows: args.rows,
        samples: args.inputLatencySamples,
        timeoutMs: 2_000
    )
    var enrichedMetrics = report.metrics
    enrichedMetrics["e2e_input_to_render_ms_p50"] = percentile(inputLatency, 0.50)
    enrichedMetrics["e2e_input_to_render_ms_p95"] = percentile(inputLatency, 0.95)
    enrichedMetrics["e2e_input_to_render_timeout_count"] = Double(inputLatency.filter { $0 >= 2_000.0 }.count)
    let enrichedReport = E2EReport(
        schema_version: report.schema_version,
        benchmark: report.benchmark,
        commit: report.commit,
        platform: report.platform,
        config: report.config,
        frames: report.frames,
        final_snapshot_lines: report.final_snapshot_lines,
        final_snapshot_json_bytes: report.final_snapshot_json_bytes,
        metrics: enrichedMetrics,
        total_runtime_ms: report.total_runtime_ms
    )

    let outData = try JSONEncoder.pretty.encode(enrichedReport)
    if let output = args.outputPath {
        let url = URL(fileURLWithPath: output)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try outData.write(to: url)
    }
    FileHandle.standardOutput.write(outData)
    FileHandle.standardOutput.write(Data([0x0A]))
}

private func snapshotContains(_ marker: String, in snapshot: TerminalSnapshot) -> Bool {
    for line in snapshot.lines {
        for span in line.spans where span.text.contains(marker) {
            return true
        }
    }
    return false
}

private func measureInputToRenderLatency(
    cols: UInt16,
    rows: UInt16,
    samples: Int,
    timeoutMs: Int
) -> [Double] {
    guard let handle = genieterm_create(cols, rows) else {
        return Array(repeating: Double(timeoutMs), count: samples)
    }
    defer { genieterm_destroy(handle) }

    let decoder = JSONDecoder()
    let builder = CoreTextBuilder()

    "cat".withCString { cStr in
        genieterm_send_command(handle, cStr)
    }
    usleep(120_000)

    var results: [Double] = []
    results.reserveCapacity(samples)

    var lastVersion = genieterm_snapshot_version(handle)

    for i in 0..<samples {
        let marker = "GT_LAT_\(i)_\(Int(monotonicMs()))"
        let payload = Array((marker + "\n").utf8)
        payload.withUnsafeBufferPointer { buf in
            guard let base = buf.baseAddress else { return }
            genieterm_send_input(handle, base, buf.count)
        }

        let start = monotonicMs()
        let deadline = start + Double(timeoutMs)
        var matched = false

        while monotonicMs() < deadline {
            let version = genieterm_snapshot_version(handle)
            if version == lastVersion {
                usleep(1_000)
                continue
            }
            lastVersion = version

            guard let cString = genieterm_poll_snapshot_json(handle) else {
                continue
            }
            let payload = String(cString: cString)
            genieterm_free_string(cString)
            guard let data = payload.data(using: .utf8),
                  let snapshot = try? decoder.decode(TerminalSnapshot.self, from: data)
            else {
                continue
            }
            _ = builder.buildLines(from: snapshot)
            if snapshotContains(marker, in: snapshot) {
                results.append(monotonicMs() - start)
                matched = true
                break
            }
        }

        if !matched {
            results.append(Double(timeoutMs))
        }
    }

    return results
}

extension JSONEncoder {
    static var pretty: JSONEncoder {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        return enc
    }
}

do {
    try run()
} catch {
    fputs("GenieTermE2EBench error: \(error)\n", stderr)
    exit(1)
}
