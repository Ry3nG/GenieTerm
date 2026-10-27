# We source this file with -NoExit -File; it runs in script scope, so anything that must outlive it is Global:
$env:PATH = {{.WSHBINDIR_PWSH}} + "{{.PATHSEP}}" + $env:PATH

# Source dynamic script from genie token
$waveterm_swaptoken_output = {{.HELPERCMD}} token $env:WAVETERM_SWAPTOKEN pwsh 2>$null | Out-String
if ($waveterm_swaptoken_output -and $waveterm_swaptoken_output -ne "") {
    Invoke-Expression $waveterm_swaptoken_output
}
Remove-Variable -Name waveterm_swaptoken_output
Remove-Item Env:WAVETERM_SWAPTOKEN -ErrorAction SilentlyContinue

# Load GenieTerm completions
{{.HELPERCMD}} completion powershell | Out-String | Invoke-Expression

if ($PSVersionTable.PSVersion.Major -ge 7) {
    if ($PSStyle.FileInfo.Directory -eq "$([char]27)[44;1m") {
        $PSStyle.FileInfo.Directory = "$([char]27)[34;1m"
    }
}

if ($Host.Name -ne "ConsoleHost" -or (Test-Path Variable:Global:_WAVETERM_SI_LOADED)) {
    return
}

# shell integration (must stay Windows PowerShell 5.1 compatible: no backtick-e escape, ??, ternary, &&)
$Global:_WAVETERM_SI_LOADED = $true
$Global:_WAVETERM_SI_ESC = [string][char]27
$Global:_WAVETERM_SI_BEL = [string][char]7
$Global:_WAVETERM_SI_VT = $false
try { $Global:_WAVETERM_SI_VT = [bool]$Host.UI.SupportsVirtualTerminal } catch { }
# without PSReadLine there is no reliable command-start hook; A/D alone would leave the UI stuck in running-command
$Global:_WAVETERM_SI_INTEGRATION = $Global:_WAVETERM_SI_VT -and (Test-Path Function:\PSConsoleHostReadLine) -and ($null -ne (Get-Module -Name PSReadLine))
$Global:_WAVETERM_SI_FIRSTPROMPT = $true
$Global:_WAVETERM_SI_ARMED = $false
$Global:_WAVETERM_SI_INCMD = $false
$Global:_WAVETERM_SI_INREADLINE = $false
$Global:_WAVETERM_SI_PROMPTRAN = $false
$Global:_WAVETERM_SI_LECATC = $null
$Global:_WAVETERM_SI_ERRATC = $null
$Global:_WAVETERM_SI_ORIGPROMPT = $null

function Global:_waveterm_si_blocked {
    # Check if we're in tmux or screen
    return ($env:TMUX -or $env:STY -or $env:TERM -like "tmux*" -or $env:TERM -like "screen*")
}

function Global:_waveterm_si_osc([string]$body) {
    if (-not $Global:_WAVETERM_SI_VT -or (_waveterm_si_blocked)) { return }
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT -and $body.StartsWith("16162;")) {
        # ConPTY passes unknown OSC through before pending screen output. OSC 633 synchronously
        # flushes its renderer, keeping our command markers at the correct buffer positions.
        [Console]::Write($Global:_WAVETERM_SI_ESC + "]633;P;GenieTermFlush=1" + $Global:_WAVETERM_SI_BEL)
    }
    # [Console]::Write bypasses $PSStyle.OutputRendering / NO_COLOR stripping that can affect Write-Host
    [Console]::Write($Global:_WAVETERM_SI_ESC + "]" + $body + $Global:_WAVETERM_SI_BEL)
}

function Global:_waveterm_si_osc7 {
    if ($PWD.Provider.Name -ne "FileSystem") { return }
    # Percent-encode the raw path as-is (handles UNC, drive letters, etc.)
    $encoded_pwd = [System.Uri]::EscapeDataString($PWD.ProviderPath)
    _waveterm_si_osc ("7;file://localhost/" + $encoded_pwd)
}

function Global:_waveterm_si_metadata {
    $shell = "pwsh"
    if ($PSVersionTable.PSEdition -ne "Core") { $shell = "powershell" }
    $uname = ""
    try {
        $uname = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription + " " + [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    } catch { }
    $meta = [ordered]@{
        shell        = $shell
        shellversion = $PSVersionTable.PSVersion.ToString()
        uname        = $uname.Trim()
        integration  = [bool]$Global:_WAVETERM_SI_INTEGRATION
    }
    _waveterm_si_osc ("16162;M;" + ($meta | ConvertTo-Json -Compress))
}

function Global:_waveterm_si_exitcode([bool]$ok, $lastExit) {
    if ($ok) { return 0 }
    # $LASTEXITCODE is sticky across cmdlet failures; only trust it if it changed during this command
    # or the failure produced no new error record (a native exit with the same code as last time)
    if ($lastExit -is [int] -and $lastExit -ne 0) {
        $newErr = ($global:Error.Count -gt 0) -and (-not [object]::ReferenceEquals($global:Error[0], $Global:_WAVETERM_SI_ERRATC))
        if (($lastExit -ne $Global:_WAVETERM_SI_LECATC) -or (-not $newErr)) { return $lastExit }
    }
    return 1
}

function Global:_waveterm_si_onprompt([bool]$ok, $lastExit) {
    if ($Global:_WAVETERM_SI_FIRSTPROMPT) {
        $Global:_WAVETERM_SI_FIRSTPROMPT = $false
        _waveterm_si_metadata
    } elseif ($Global:_WAVETERM_SI_INCMD) {
        _waveterm_si_osc ("16162;D;{`"exitcode`":" + (_waveterm_si_exitcode $ok $lastExit) + "}")
    }
    $Global:_WAVETERM_SI_INCMD = $false
    _waveterm_si_osc7
    if (-not $Global:_WAVETERM_SI_INTEGRATION) { return }
    _waveterm_si_osc "16162;A"
    $Global:_WAVETERM_SI_ARMED = $true
}

function Global:_waveterm_si_installprompt {
    Set-StrictMode -Off
    $Global:_WAVETERM_SI_ORIGPROMPT = ${function:prompt}
    if ($null -eq $Global:_WAVETERM_SI_ORIGPROMPT) {
        $Global:_WAVETERM_SI_ORIGPROMPT = { "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) " }
    }
    function Global:prompt {
        # capturing $? must be the first statement; anything else resets it
        $wsiOk = $global:?
        Set-StrictMode -Off
        # __waveterm_si_prompt_sentinel__ (lets the readline hook tell whether this wrapper is still installed)
        # transient-prompt handlers re-invoke prompt from inside ReadLine; emitting A there would split the block
        if (-not $Global:_WAVETERM_SI_INREADLINE) {
            $Global:_WAVETERM_SI_PROMPTRAN = $true
            if ($nestedPromptLevel -eq 0) {
                try { $null = _waveterm_si_onprompt $wsiOk $global:LASTEXITCODE } catch { }
            }
        }
        # re-establish $? = $false so starship/oh-my-posh still render the failure state
        if (-not $wsiOk) { Write-Error "failure" -ErrorAction Ignore }
        & $Global:_WAVETERM_SI_ORIGPROMPT
    }
}

function Global:_waveterm_si_oncommand([string]$line) {
    if (-not $Global:_WAVETERM_SI_PROMPTRAN -and -not ${function:prompt}.ToString().Contains("__waveterm_si_prompt_sentinel__")) {
        # prompt was replaced after startup (e.g. `oh-my-posh init pwsh | iex`); re-wrap so A/D resume next prompt
        _waveterm_si_installprompt
    }
    $Global:_WAVETERM_SI_PROMPTRAN = $false
    if (-not $Global:_WAVETERM_SI_ARMED -or [string]::IsNullOrWhiteSpace($line)) { return }
    $Global:_WAVETERM_SI_ARMED = $false
    $Global:_WAVETERM_SI_INCMD = $true
    $Global:_WAVETERM_SI_LECATC = $global:LASTEXITCODE
    $Global:_WAVETERM_SI_ERRATC = $null
    if ($global:Error.Count -gt 0) { $Global:_WAVETERM_SI_ERRATC = $global:Error[0] }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($line)
    if ($bytes.Length -gt 8192) {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("# command too large (" + $bytes.Length + " bytes)")
    }
    _waveterm_si_osc ("16162;C;{`"cmd64`":`"" + [Convert]::ToBase64String($bytes) + "`"}")
}

_waveterm_si_installprompt

if ($Global:_WAVETERM_SI_INTEGRATION) {
    $Global:_WAVETERM_SI_ORIGREADLINE = ${function:PSConsoleHostReadLine}
    function Global:PSConsoleHostReadLine {
        # PSReadLine reads $? on entry (error-colored prompt), so carry the user's status through
        $wsiOk = $global:?
        Set-StrictMode -Off
        $Global:_WAVETERM_SI_INREADLINE = $true
        try {
            if (-not $wsiOk) { Write-Error "failure" -ErrorAction Ignore }
            $wsiLine = & $Global:_WAVETERM_SI_ORIGREADLINE
        } finally {
            $Global:_WAVETERM_SI_INREADLINE = $false
        }
        try { $null = _waveterm_si_oncommand $wsiLine } catch { }
        $wsiLine
    }
}
