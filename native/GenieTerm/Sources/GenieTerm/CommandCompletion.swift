import Foundation

/// Handles command and path completion
class CommandCompletion {
    /// Get completion suggestions for the current input
    static func getCompletions(for input: String, workingDirectory: String) -> [String] {
        // Parse the input to find what we're completing
        let tokens = input.split(separator: " ", omittingEmptySubsequences: false)

        guard let lastToken = tokens.last else {
            return []
        }

        let partialPath = String(lastToken)

        // If it's the first token, try command completion
        if tokens.count == 1 {
            return getCommandCompletions(for: partialPath) + getPathCompletions(for: partialPath, in: workingDirectory)
        } else {
            // Otherwise, try path completion
            return getPathCompletions(for: partialPath, in: workingDirectory)
        }
    }

    /// Complete common shell commands
    private static func getCommandCompletions(for partial: String) -> [String] {
        let commonCommands = [
            "cd", "ls", "pwd", "mkdir", "rm", "cp", "mv", "cat", "echo",
            "grep", "find", "chmod", "chown", "touch", "nano", "vim",
            "git", "npm", "yarn", "cargo", "python", "node", "swift"
        ]

        return commonCommands.filter { $0.hasPrefix(partial) }
    }

    /// Complete file and directory paths
    private static func getPathCompletions(for partial: String, in workingDirectory: String) -> [String] {
        let fileManager = FileManager.default

        // Determine the directory to search and the prefix to match
        let (searchDir, prefix) = parsePartialPath(partial, workingDirectory: workingDirectory)

        guard let contents = try? fileManager.contentsOfDirectory(atPath: searchDir) else {
            return []
        }

        // Filter items that match the prefix
        let matches = contents.filter { item in
            prefix.isEmpty || item.hasPrefix(prefix)
        }

        // Build full paths and add trailing slash for directories
        return matches.compactMap { item in
            let fullPath = (searchDir as NSString).appendingPathComponent(item)
            var isDirectory: ObjCBool = false

            guard fileManager.fileExists(atPath: fullPath, isDirectory: &isDirectory) else {
                return nil
            }

            // Return the completion relative to what was typed
            if partial.contains("/") {
                let basePath = (partial as NSString).deletingLastPathComponent
                let completion = (basePath as NSString).appendingPathComponent(item)
                return isDirectory.boolValue ? completion + "/" : completion
            } else {
                return isDirectory.boolValue ? item + "/" : item
            }
        }.sorted()
    }

    /// Parse a partial path into (directory to search, prefix to match)
    private static func parsePartialPath(_ partial: String, workingDirectory: String) -> (String, String) {
        if partial.isEmpty {
            return (workingDirectory, "")
        }

        // Handle absolute paths
        if partial.hasPrefix("/") {
            let dir = (partial as NSString).deletingLastPathComponent
            let prefix = (partial as NSString).lastPathComponent
            return (dir.isEmpty ? "/" : dir, prefix)
        }

        // Handle home directory
        if partial.hasPrefix("~") {
            let homeDir = FileManager.default.homeDirectoryForCurrentUser.path
            let withoutTilde = String(partial.dropFirst())

            if withoutTilde.isEmpty || withoutTilde == "/" {
                return (homeDir, "")
            }

            let fullPath = (homeDir as NSString).appendingPathComponent(withoutTilde)
            let dir = (fullPath as NSString).deletingLastPathComponent
            let prefix = (fullPath as NSString).lastPathComponent
            return (dir, prefix)
        }

        // Handle relative paths
        if partial.contains("/") {
            let dir = (workingDirectory as NSString).appendingPathComponent((partial as NSString).deletingLastPathComponent)
            let prefix = (partial as NSString).lastPathComponent
            return (dir, prefix)
        }

        // Just a filename prefix in current directory
        return (workingDirectory, partial)
    }

    /// Apply a completion to the input string
    static func applyCompletion(_ completion: String, to input: String) -> String {
        let tokens = input.split(separator: " ", omittingEmptySubsequences: false)

        guard !tokens.isEmpty else {
            return completion
        }

        var newTokens = tokens.dropLast().map(String.init)
        newTokens.append(completion)

        return newTokens.joined(separator: " ")
    }

    /// Find common prefix among completions for auto-completion
    static func commonPrefix(of completions: [String]) -> String? {
        guard !completions.isEmpty else { return nil }
        guard completions.count > 1 else { return completions.first }

        let first = completions[0]
        var commonLength = first.count

        for completion in completions.dropFirst() {
            commonLength = min(commonLength, completion.count)

            for i in 0..<commonLength {
                let idx = first.index(first.startIndex, offsetBy: i)
                let compIdx = completion.index(completion.startIndex, offsetBy: i)

                if first[idx] != completion[compIdx] {
                    commonLength = i
                    break
                }
            }
        }

        guard commonLength > 0 else { return nil }
        let endIdx = first.index(first.startIndex, offsetBy: commonLength)
        return String(first[..<endIdx])
    }
}
