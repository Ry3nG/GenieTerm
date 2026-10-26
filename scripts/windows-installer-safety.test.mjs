// Copyright 2026, GenieTerm. Apache-2.0.

import { describe, expect, it } from "vitest";
import { requireCleanWindowsInstallState } from "./windows-installer-safety.mjs";

const inventory =
  (installations = [], processes = []) =>
  () => ({
    status: 0,
    stdout: JSON.stringify({ installations, processes }),
  });

describe("Windows installer smoke safety", () => {
  it("allows a clean account without an existing install or active session", () => {
    expect(() => requireCleanWindowsInstallState("GenieTerm", inventory())).not.toThrow();
  });

  it.each(["CurrentUser/Registry32", "CurrentUser/Registry64", "LocalMachine/Registry32", "LocalMachine/Registry64"])(
    "protects an existing install registered in %s",
    (scope) => {
      expect(() => requireCleanWindowsInstallState("GenieTerm", inventory([{ name: "GenieTerm", scope }]))).toThrow(
        "requires a clean Windows account or VM"
      );
    }
  );

  it("protects an active unpacked session without an installer registration", () => {
    expect(() => requireCleanWindowsInstallState("GenieTerm", inventory([], [{ pid: 1234 }]))).toThrow(
      "Existing installs and sessions were left untouched"
    );
  });

  it.each([
    { status: 1, stderr: "Access denied" },
    { status: null, error: new Error("Timed out") },
    { status: 0, stdout: "invalid JSON" },
    { status: 0, stdout: JSON.stringify({ installations: [] }) },
    { status: 0, stdout: "null" },
  ])("refuses installer execution when discovery is incomplete: %j", (result) => {
    expect(() => requireCleanWindowsInstallState("GenieTerm", () => result)).toThrow("was not started");
  });
});
