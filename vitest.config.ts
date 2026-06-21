import { UserConfig, configDefaults, defineConfig, mergeConfig } from "vitest/config";
import electronViteConfig from "./electron.vite.config";

export default mergeConfig(
    electronViteConfig.renderer as UserConfig,
    defineConfig({
        test: {
            // Leftover git worktrees hold full copies of the repo's test files, so
            // without these excludes vitest runs each test 5-6 times.
            exclude: [...configDefaults.exclude, "**/.worktrees/**", "**/.claude/worktrees/**"],
            reporters: ["verbose", "junit"],
            outputFile: {
                junit: "test-results.xml",
            },
            coverage: {
                provider: "istanbul",
                reporter: ["lcov"],
                reportsDirectory: "./coverage",
            },
            typecheck: {
                tsconfig: "tsconfig.json",
            },
        },
    })
);
