const { Arch } = require("electron-builder");
const pkg = require("./package.json");
const fs = require("fs");
const path = require("path");
const childProcess = require("node:child_process");

// Without a Developer ID (CSC_LINK / CSC_NAME), sign the whole bundle ad-hoc so it still passes
// `codesign --verify --deep --strict`; an unsigned bundle with a modified Info.plist is reported as damaged.
const macHasDeveloperId = !!(process.env.CSC_LINK || process.env.CSC_NAME);
const releaseNotesFile = path.join(__dirname, "docs", "releases", `v${pkg.version}.md`);
const defaultLinuxTargets = ["AppImage", "deb"];
const linuxTargets = process.env.GENIETERM_LINUX_TARGETS
    ? process.env.GENIETERM_LINUX_TARGETS.split(",")
          .map((target) => target.trim())
          .filter(Boolean)
    : defaultLinuxTargets;
const githubPublishConfig = {
    provider: "github",
    owner: "Ry3nG",
    repo: "GenieTerm",
};
const genericPublishConfig = {
    provider: "generic",
    url: "https://github.com/Ry3nG/GenieTerm/releases/latest/download/",
};
const publishConfig =
    process.env.GENIETERM_ELECTRON_BUILDER_PUBLISH === "1" ? githubPublishConfig : genericPublishConfig;

function deleteXattrRecursive(attributeName, targetPath) {
    childProcess.execFileSync("xattr", ["-dr", attributeName, targetPath], { stdio: "ignore" });
}

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const config = {
    appId: pkg.build.appId,
    productName: pkg.productName,
    executableName: pkg.productName,
    artifactName: "${productName}-${platform}-${arch}-${version}.${ext}",
    // Stable builds also write beta/alpha metadata so users on the beta channel keep receiving stable releases.
    generateUpdatesFilesForAllChannels: true,
    ...(fs.existsSync(releaseNotesFile) ? { releaseInfo: { releaseNotesFile } } : {}),
    npmRebuild: false,
    nodeGypRebuild: false,
    electronCompile: false,
    files: [
        {
            from: "./dist",
            to: "./dist",
            filter: ["**/*", "!bin/*", "bin/wavesrv.${arch}*", "bin/wsh*", "bin/genie*"],
        },
        {
            from: ".",
            to: ".",
            filter: ["package.json"],
        },
        "!node_modules", // We don't need electron-builder to package in Node modules as Vite has already bundled any code that our program is using.
    ],
    directories: {
        output: process.env.GENIETERM_BUILD_OUTPUT || "make",
    },
    asarUnpack: [
        "dist/bin/**/*", // wavesrv and wsh binaries
        "dist/schema/**/*", // schema files for Monaco editor
    ],
    mac: {
        target: [
            {
                target: "zip",
                arch: ["arm64", "x64"],
            },
            {
                target: "dmg",
                arch: ["arm64", "x64"],
            },
        ],
        category: "public.app-category.developer-tools",
        ...(macHasDeveloperId ? {} : { identity: "-" }),
        // Electron 38+ (Chromium) no longer runs on macOS 11 or earlier
        minimumSystemVersion: "12.0.0",
        mergeASARs: true,
        singleArchFiles: "**/dist/bin/wavesrv.*",
        entitlements: "build/entitlements.mac.plist",
        entitlementsInherit: "build/entitlements.mac.plist",
        extendInfo: {
            NSContactsUsageDescription: "A CLI application running in GenieTerm wants to use your contacts.",
            NSRemindersUsageDescription: "A CLI application running in GenieTerm wants to use your reminders.",
            NSLocationWhenInUseUsageDescription:
                "A CLI application running in GenieTerm wants to use your location information while active.",
            NSLocationAlwaysUsageDescription:
                "A CLI application running in GenieTerm wants to use your location information, even in the background.",
            NSCameraUsageDescription: "A CLI application running in GenieTerm wants to use the camera.",
            NSMicrophoneUsageDescription: "A CLI application running in GenieTerm wants to use your microphone.",
            NSCalendarsUsageDescription: "A CLI application running in GenieTerm wants to use Calendar data.",
            NSLocationUsageDescription:
                "A CLI application running in GenieTerm wants to use your location information.",
            NSAppleEventsUsageDescription: "A CLI application running in GenieTerm wants to use AppleScript.",
        },
    },
    linux: {
        // Linux wavesrv is built for the host architecture. Avoid builder's x86_64/amd64 filename aliases.
        artifactName: `\${productName}-linux-${process.arch}-\${version}.\${ext}`,
        // electron-builder writes this as the desktop entry's Categories: one main category (System) plus
        // TerminalEmulator, as GNOME Terminal does; desktop-file-validate flags more than one main category
        category: "System;TerminalEmulator",
        executableName: pkg.name,
        target: linuxTargets,
        synopsis: pkg.description,
        description: null,
        desktop: {
            entry: {
                Name: pkg.productName,
                Comment: pkg.description,
                Keywords: "developer;terminal;emulator;",
                StartupWMClass: pkg.productName,
            },
        },
        executableArgs: ["--enable-features", "UseOzonePlatform", "--ozone-platform-hint", "auto"], // Hint Electron to use Ozone abstraction layer for native Wayland support
    },
    deb: {
        afterInstall: "build/deb-postinstall.tpl",
        afterRemove: "build/deb-postremove.tpl",
        maintainer: `${pkg.author.name} <${pkg.author.email}>`,
        vendor: pkg.author.name,
        // Homepage is inherited from package.json by electron-builder.
        priority: "optional",
        packageCategory: "devel",
        // depends replaces (rather than extends) electron-builder's defaults.
        depends: [
            "libgtk-3-0",
            "libnotify4",
            "libnss3",
            "libxss1",
            "libxtst6",
            "xdg-utils",
            "libatspi2.0-0",
            "libuuid1",
            "libsecret-1-0",
            "libgbm1",
            "libasound2t64 | libasound2",
        ],
        // Only AppImage installs use the updater; deb packages are installed manually.
        publish: null,
    },
    win: {
        target: ["nsis", "zip"],
        forceCodeSigning: process.env.GENIETERM_REQUIRE_WINDOWS_SIGNATURE === "1",
    },
    // No appImage.license: AppRun would block the first launch on a zenity click-through of the Apache-2.0 text.
    appImage: {},
    snap: {
        base: "core22",
        confinement: "classic",
        allowNativeWayland: true,
        artifactName: "${name}_${version}_${arch}.${ext}",
    },
    rpm: {
        // this should remove /usr/lib/.build-id/ links which can conflict with other electron apps like slack
        fpm: ["--rpm-rpmbuild-define", "_build_id_links none"],
    },
    publish: publishConfig,
    afterPack: (context) => {
        if (context.electronPlatformName === "linux" && Arch[context.arch] !== process.arch) {
            throw new Error("Linux packaging requires a native runner for each architecture (including wavesrv)");
        }
        if (context.electronPlatformName === "darwin") {
            const appBundlePath = path.resolve(context.appOutDir, `${pkg.productName}.app`);
            childProcess.execFileSync("xattr", ["-cr", appBundlePath], { stdio: "ignore" });
            deleteXattrRecursive("com.apple.FinderInfo", appBundlePath);
            deleteXattrRecursive("com.apple.ResourceFork", appBundlePath);
            deleteXattrRecursive("com.apple.fileprovider.fpfs#P", appBundlePath);
        }

        // This is a workaround to restore file permissions to the wavesrv binaries on macOS after packaging the universal binary.
        if (context.electronPlatformName === "darwin" && context.arch === Arch.universal) {
            const packageBinDir = path.resolve(
                context.appOutDir,
                `${pkg.productName}.app/Contents/Resources/app.asar.unpacked/dist/bin`
            );

            // Reapply file permissions to the wavesrv binaries in the final app package
            fs.readdirSync(packageBinDir, {
                recursive: true,
                withFileTypes: true,
            })
                .filter((f) => f.isFile() && f.name.startsWith("wavesrv"))
                .forEach((f) => fs.chmodSync(path.resolve(f.parentPath ?? f.path, f.name), 0o755)); // 0o755 corresponds to -rwxr-xr-x
        }
    },
};

module.exports = config;
