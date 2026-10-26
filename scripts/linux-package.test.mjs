// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { createPackage } from "@electron/asar";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { verifyDebControl, verifyLinuxDesktop, verifyLinuxTree } from "./verify-linux-package.mjs";
import { getExpectedReleaseAssets } from "./verify-release-assets.mjs";
import { getMetadataFileName, getUpdateChannels, verifyUpdateMetadata } from "./verify-update-metadata.mjs";

const Pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const TemporaryDirs = [];

function temporaryDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "genieterm-package-test-"));
  TemporaryDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of TemporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function write(file, content, executable = false) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  if (executable) {
    chmodSync(file, 0o755);
  }
}

function writeMetadata(dir, platform, arch, version = Pkg.version) {
  const prefix = platform === "mac" ? "darwin" : platform === "windows" ? "win32" : "linux";
  const extension = platform === "mac" ? "zip" : platform === "windows" ? "exe" : "AppImage";
  const arches = platform === "mac" ? ["arm64", "x64"] : [arch];
  const files = arches.map((payloadArch) => {
    const url = `${Pkg.productName}-${prefix}-${payloadArch}-${version}.${extension}`;
    const content = readFileSync(path.join(dir, url));
    return { url, size: content.length, sha512: createHash("sha512").update(content).digest("base64") };
  });
  const metadata = { version, files, path: files[0].url, sha512: files[0].sha512 };
  for (const channel of getUpdateChannels(version)) {
    write(path.join(dir, getMetadataFileName(channel, platform, arch)), YAML.stringify(metadata));
  }
  return metadata;
}

function makeReleaseAssets(includeWindows) {
  const dir = temporaryDir();
  const assets = getExpectedReleaseAssets({ productName: Pkg.productName, version: Pkg.version, includeWindows });
  for (const name of assets.required) {
    const folder = name.includes("linux-arm64")
      ? "linux-arm64"
      : name.includes("linux")
        ? "linux-x64"
        : name.includes("darwin") || name.includes("-mac")
          ? "mac"
          : "windows";
    write(path.join(dir, folder, name), "release payload fixture");
  }
  writeMetadata(path.join(dir, "mac"), "mac", "x64");
  for (const arch of ["x64", "arm64"]) {
    writeMetadata(path.join(dir, `linux-${arch}`), "linux", arch);
  }
  if (includeWindows) {
    writeMetadata(path.join(dir, "windows"), "windows", "x64");
  }
  const run = () =>
    spawnSync(process.execPath, ["scripts/verify-release-assets.mjs", dir, ...(includeWindows ? ["--windows"] : [])], {
      encoding: "utf8",
    });
  return { dir, run };
}

function desktop() {
  return `[Desktop Entry]\nName=${Pkg.productName}\nComment=${Pkg.description}\nCategories=System;TerminalEmulator;\nStartupWMClass=${Pkg.productName}\nIcon=${Pkg.name}\nKeywords=developer;terminal;emulator;\nExec=/opt/${Pkg.productName}/${Pkg.name} %U\n`;
}

function control(arch, version = Pkg.version) {
  return ` Package: genieterm\n Version: ${version.replace(/-/g, "~")}\n Architecture: ${arch === "x64" ? "amd64" : "arm64"}\n Maintainer: ${Pkg.author.name} <${Pkg.author.email}>\n Vendor: ${Pkg.author.name}\n Homepage: ${Pkg.homepage}\n Priority: optional\n Section: devel\n Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0, libgbm1, libasound2t64 | libasound2\n`;
}

async function makeTree(root, arch) {
  const elf = Buffer.alloc(64);
  elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  elf.writeUInt16LE(arch === "x64" ? 62 : 183, 18);
  write(path.join(root, "genieterm"), elf, true);
  write(path.join(root, "chrome-sandbox"), "sandbox fixture", true);
  const bin = path.join(root, "resources/app.asar.unpacked/dist/bin");
  write(path.join(bin, `wavesrv.${arch}`), elf, true);
  for (const helper of ["genie", "wsh"]) {
    for (const platform of [
      "linux.x64",
      "linux.arm64",
      "linux.mips",
      "linux.mips64",
      "darwin.x64",
      "darwin.arm64",
      "windows.x64.exe",
      "windows.arm64.exe",
    ]) {
      write(path.join(bin, `${helper}-${Pkg.version}-${platform}`), "helper fixture", true);
    }
  }
  const source = temporaryDir();
  write(path.join(source, "package.json"), JSON.stringify(Pkg));
  await createPackage(source, path.join(root, "resources/app.asar"));
  write(
    path.join(root, "resources/app-update.yml"),
    YAML.stringify({ provider: "generic", url: "https://github.com/Ry3nG/GenieTerm/releases/latest/download/" })
  );
}

describe.skipIf(process.platform === "win32")("Linux packages", () => {
  it("keeps the deb fallback link on upgrade and removes it on uninstall", () => {
    const root = temporaryDir();
    const link = path.join(root, "usr/bin/genieterm");
    const executable = path.join(root, "opt/GenieTerm/genieterm");
    const sandbox = path.join(root, "opt/GenieTerm/chrome-sandbox");
    const chmodLog = path.join(root, "chmod.log");
    write(executable, "fixture");
    write(sandbox, "fixture");
    mkdirSync(path.dirname(link), { recursive: true });
    const runScript = (name, action) => {
      const script = readFileSync(new URL(`../build/${name}`, import.meta.url), "utf8")
        .replaceAll("/usr/bin/genieterm", link)
        .replaceAll("/opt/GenieTerm/", `${root}/opt/GenieTerm/`);
      // Test the setuid request without requiring permission to create setuid files on the test host.
      const functions =
        'chmod() { printf "%s\\n" "$*" >> "$GENIETERM_TEST_CHMOD_LOG"; command chmod 755 "$2"; }; update-alternatives() { return 1; }; update-mime-database() { return 0; }; update-desktop-database() { return 0; };\n';
      return spawnSync("bash", ["-c", functions + script, "fixture", action], {
        encoding: "utf8",
        env: { ...process.env, GENIETERM_TEST_CHMOD_LOG: chmodLog },
      });
    };
    expect(runScript("deb-postinstall.tpl", "configure").status).toBe(0);
    expect(readlinkSync(link)).toBe(executable);
    expect(statSync(sandbox).mode & 0o777).toBe(0o755);
    expect(readFileSync(chmodLog, "utf8").trim()).toBe(`4755 ${sandbox}`);
    expect(runScript("deb-postremove.tpl", "upgrade").status).toBe(0);
    expect(readlinkSync(link)).toBe(executable);
    expect(runScript("deb-postremove.tpl", "remove").status).toBe(0);
    expect(existsSync(link)).toBe(false);
    expect(runScript("deb-postremove.tpl", "purge").status).toBe(0);
  });

  it.each(["x64", "arm64"])("checks extracted %s binaries, archive version and all helper platforms", async (arch) => {
    const root = temporaryDir();
    await makeTree(root, arch);
    expect(() => verifyLinuxTree(root, arch)).not.toThrow();
    expect(() => verifyLinuxTree(root, arch === "x64" ? "arm64" : "x64")).toThrow("architecture");
    expect(() => verifyLinuxTree(root, arch, { ...Pkg, version: "0.0.0" })).toThrow("version mismatch");
    const helper = path.join(root, "resources/app.asar.unpacked/dist/bin", `genie-${Pkg.version}-darwin.arm64`);
    rmSync(helper);
    expect(() => verifyLinuxTree(root, arch)).toThrow();
  });

  it("rejects stale helpers and missing executable permissions", async () => {
    const root = temporaryDir();
    await makeTree(root, "x64");
    const stale = path.join(root, "resources/app.asar.unpacked/dist/bin/genie-0.0.0-linux.x64");
    write(stale, "stale");
    expect(() => verifyLinuxTree(root, "x64")).toThrow("stale helper");
    rmSync(stale);
    chmodSync(path.join(root, "genieterm"), 0o644);
    if (process.platform !== "win32") {
      expect(() => verifyLinuxTree(root, "x64")).toThrow("not executable");
    }
  });

  it.each(["x64", "arm64"])("checks deb %s identity, dependencies and prerelease ordering", (arch) => {
    expect(() => verifyDebControl(control(arch), arch)).not.toThrow();
    expect(() =>
      verifyDebControl(control(arch, "1.2.3-beta.1"), arch, { ...Pkg, version: "1.2.3-beta.1" })
    ).not.toThrow();
    for (const mutation of [
      control(arch).replace("genieterm", "waveterm"),
      control(arch).replace("libgbm1, ", ""),
      control(arch).replace("libasound2t64 | libasound2", "libasound2"),
      control(arch).replace(Pkg.homepage, "https://wrong.invalid"),
    ]) {
      expect(() => verifyDebControl(mutation, arch)).toThrow();
    }
  });

  it("validates the desktop identity, categories, executable and sandbox flags", () => {
    expect(() => verifyLinuxDesktop(desktop())).not.toThrow();
    expect(() => verifyLinuxDesktop(desktop().replace("/opt/GenieTerm/genieterm", "/opt/Wave/waveterm"))).toThrow(
      "install path"
    );
    expect(() => verifyLinuxDesktop(desktop().replace("%U", "--no-sandbox %U"))).toThrow("sandbox");
    expect(() => verifyLinuxDesktop(desktop().replace("StartupWMClass=GenieTerm", "StartupWMClass=wave"))).toThrow(
      "StartupWMClass"
    );
  });

  it.skipIf(process.platform === "win32")(
    "runs the Linux verifier CLI against extracted-package fixtures",
    async () => {
      const dir = temporaryDir();
      const fixtures = path.join(dir, "fixtures");
      const output = path.join(dir, "make");
      const shimDir = path.join(dir, "tools");
      for (const arch of ["x64", "arm64"]) {
        await makeTree(path.join(fixtures, arch), arch);
        write(path.join(fixtures, `${arch}.control`), control(arch));
        write(path.join(fixtures, "genieterm.desktop"), desktop());
        const prefix = path.join(output, `GenieTerm-linux-${arch}-${Pkg.version}`);
        write(
          `${prefix}.AppImage`,
          `#!/usr/bin/env node\nconst fs = require("node:fs"); const path = require("node:path"); if (process.argv[2] !== "--appimage-extract") process.exit(2); fs.cpSync(path.join(process.env.GENIETERM_TEST_FIXTURES, "${arch}"), "squashfs-root", { recursive: true });\n`,
          true
        );
        write(`${prefix}.deb`, "deb fixture");
        writeMetadata(output, "linux", arch);
      }
      write(
        path.join(shimDir, "dpkg-deb"),
        `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const [mode, file, dest] = process.argv.slice(2);
const fixtures = process.env.GENIETERM_TEST_FIXTURES;
const arch = file.includes("-arm64-") ? "arm64" : "x64";
if (mode === "-I") console.log(fs.readFileSync(path.join(fixtures, arch + ".control"), "utf8"));
else if (mode === "-c") console.log("-rwxr-xr-x root/root 100 ./opt/GenieTerm/genieterm\\n-rw-r--r-- root/root 100 ./usr/share/applications/genieterm.desktop\\n-rw-r--r-- root/root 100 ./usr/share/icons/hicolor/256x256/apps/genieterm.png");
else if (mode === "-x") {
  fs.cpSync(path.join(fixtures, arch), path.join(dest, "opt/GenieTerm"), { recursive: true });
  fs.mkdirSync(path.join(dest, "usr/share/applications"), { recursive: true });
  fs.copyFileSync(path.join(fixtures, "genieterm.desktop"), path.join(dest, "usr/share/applications/genieterm.desktop"));
} else process.exit(2);
`,
        true
      );
      const result = spawnSync(
        process.execPath,
        ["scripts/verify-linux-package.mjs", output, "--require-arch", "x64,arm64"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${shimDir}${path.delimiter}${process.env.PATH}`,
            GENIETERM_TEST_FIXTURES: fixtures,
          },
        }
      );
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("verified AppImage and deb for arm64");
    }
  );
});

describe("Linux update metadata and release assets", () => {
  it.each(["1.0.1", "1.0.2-beta.1", "1.0.2-alpha.1"])("verifies separate architecture feeds for %s", (version) => {
    const dir = temporaryDir();
    for (const arch of ["x64", "arm64"]) {
      write(path.join(dir, `GenieTerm-linux-${arch}-${version}.AppImage`), `payload ${arch}`);
      writeMetadata(dir, "linux", arch, version);
    }
    const options = { dir, platform: "linux", productName: "GenieTerm", version, requiredArches: ["x64", "arm64"] };
    expect(() => verifyUpdateMetadata(options)).not.toThrow();
    const metadataFile = path.join(dir, getMetadataFileName(getUpdateChannels(version)[0], "linux", "arm64"));
    const metadata = YAML.parse(readFileSync(metadataFile, "utf8"));
    metadata.files[0].sha512 = "wrong";
    write(metadataFile, YAML.stringify(metadata));
    expect(() => verifyUpdateMetadata(options)).toThrow("sha512");
  });

  it("rejects absent channels, wrong sizes and metadata mixing architectures or deb payloads", () => {
    const dir = temporaryDir();
    write(path.join(dir, `GenieTerm-linux-x64-${Pkg.version}.AppImage`), "x64 payload");
    write(path.join(dir, `GenieTerm-linux-arm64-${Pkg.version}.AppImage`), "arm64 payload");
    const options = { dir, platform: "linux", productName: "GenieTerm", version: Pkg.version, requiredArches: ["x64"] };
    const metadata = writeMetadata(dir, "linux", "x64");
    const file = path.join(dir, getMetadataFileName(getUpdateChannels(Pkg.version)[0], "linux"));
    rmSync(file);
    expect(() => verifyUpdateMetadata(options)).toThrow("missing update metadata");
    write(file, YAML.stringify({ ...metadata, files: [{ ...metadata.files[0], size: 0 }] }));
    expect(() => verifyUpdateMetadata(options)).toThrow("size");
    const arm = writeMetadata(dir, "linux", "arm64");
    write(file, YAML.stringify(arm));
    expect(() => verifyUpdateMetadata(options)).toThrow("does not list");
    write(file, YAML.stringify({ ...metadata, files: [{ ...metadata.files[0], url: "GenieTerm.deb" }] }));
    expect(() => verifyUpdateMetadata(options)).toThrow("expected only .AppImage");
  });

  it.each([false, true])("checks the exact release CLI asset set (Windows=%s)", (includeWindows) => {
    const { dir, run } = makeReleaseAssets(includeWindows);
    expect(run().status).toBe(0);
    write(path.join(dir, "unexpected.rpm"), "unexpected");
    expect(run().stderr).toContain("unexpected release assets");
    rmSync(path.join(dir, "unexpected.rpm"));
    rmSync(path.join(dir, "linux-arm64", `GenieTerm-linux-arm64-${Pkg.version}.deb`));
    expect(run().stderr).toContain("missing release assets");
  });
});

describe("Windows stable release assets", () => {
  it.each([
    `GenieTerm-win32-x64-${Pkg.version}.exe`,
    `GenieTerm-win32-x64-${Pkg.version}.zip`,
    "latest.yml",
    "beta.yml",
    "alpha.yml",
  ])("refuses a stable release missing %s", (name) => {
    const { dir, run } = makeReleaseAssets(true);
    rmSync(path.join(dir, "windows", name));
    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`missing release assets: ${name}`);
  });

  it.each(["latest.yml", "beta.yml", "alpha.yml"])("rejects a corrupt Windows installer in %s", (name) => {
    const { dir, run } = makeReleaseAssets(true);
    const file = path.join(dir, "windows", name);
    const metadata = YAML.parse(readFileSync(file, "utf8"));
    metadata.files[0].sha512 = "wrong";
    write(file, YAML.stringify(metadata));
    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${name} sha512`);
  });

  it("rejects an installer left over from a different release", () => {
    const { dir, run } = makeReleaseAssets(true);
    write(path.join(dir, "windows", "GenieTerm-win32-x64-0.0.1.exe"), "stale installer");
    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unexpected release assets: GenieTerm-win32-x64-0.0.1.exe");
  });
});
