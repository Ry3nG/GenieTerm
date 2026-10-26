// Copyright 2026, GenieTerm. Apache-2.0.

import { spawnSync } from "node:child_process";

const InspectInstallState = String.raw`
$ErrorActionPreference = 'Stop'
$productName = $env:GENIETERM_SMOKE_PRODUCT_NAME
$installations = @()
foreach ($registryHive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
    foreach ($registryView in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
        $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($registryHive, $registryView)
        try {
            $uninstallKey = $baseKey.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')
            if ($null -eq $uninstallKey) { continue }
            try {
                foreach ($keyName in $uninstallKey.GetSubKeyNames()) {
                    $appKey = $uninstallKey.OpenSubKey($keyName)
                    if ($null -eq $appKey) { continue }
                    try {
                        $displayName = [string]$appKey.GetValue('DisplayName')
                        if ($displayName -eq $productName -or $displayName.StartsWith($productName + ' ', [StringComparison]::OrdinalIgnoreCase)) {
                            $installations += @{ name = $displayName; scope = "$registryHive/$registryView" }
                        }
                    } finally { $appKey.Dispose() }
                }
            } finally { $uninstallKey.Dispose() }
        } finally { $baseKey.Dispose() }
    }
}
$processes = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq ($productName + '.exe') } | ForEach-Object { @{ pid = $_.ProcessId } })
@{ installations = @($installations); processes = @($processes) } | ConvertTo-Json -Depth 4 -Compress
`;

export function requireCleanWindowsInstallState(productName, run = spawnSync) {
  // NSIS uses the production app's registry keys even when /D points at a temporary directory.
  const result = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", InspectInstallState], {
    env: { ...process.env, GENIETERM_SMOKE_PRODUCT_NAME: productName },
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `[verify-windows-package] Cannot inspect existing Windows installations; installer smoke was not started: ${result.error?.message || result.stderr?.trim() || result.status}`
    );
  }
  let state;
  try {
    state = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error("[verify-windows-package] Invalid Windows install inventory; installer smoke was not started");
  }
  if (!Array.isArray(state?.installations) || !Array.isArray(state?.processes)) {
    throw new Error("[verify-windows-package] Incomplete Windows install inventory; installer smoke was not started");
  }
  if (state.installations.length > 0 || state.processes.length > 0) {
    throw new Error(
      `[verify-windows-package] Installer smoke requires a clean Windows account or VM: found ${state.installations.length} registered ${productName} installation(s) and ${state.processes.length} running process(es). Existing installs and sessions were left untouched; use --window-smoke alone on this account.`
    );
  }
}
