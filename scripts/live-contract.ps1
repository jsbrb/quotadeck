# hito-12 WU-H — live contract publish gate.
#
# Purpose: run the REAL src pipeline (request builders, ACS3 signer via the
# allowlist client, FetchTransport, parseTokenPlanUsage) against the live
# Alibaba international endpoints — the executable gate the parent runs before
# ANY publish/store decision on this feature (hermetic fixtures kept diverging
# from the gateway: WU-F origin, WU-G envelope).
#
# Credential handling: the qwen AK/SK pair is extracted from the browser's own
# extension storage on disk IN MEMORY ONLY — the latin1 byte-scan + regex over
# Local Extension Settings .log/.ldb files proven by the T1b temp probe, newest
# mtime wins. Values are NEVER printed and NEVER written to disk; they exist
# only in this process's environment for the duration of the vitest run and
# are cleared in the finally block. The minted session token lives inside the
# test and dies there.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\live-contract.ps1
# The live test skips silently in the normal suite; QUOTADECK_LIVE=1 + the two
# QWEN_AK_* variables (set by this script) are the only way it runs.
$ErrorActionPreference = 'Stop'

function Read-BytesFileShared {
    param([string]$Path)
    # FileShare.ReadWrite is MANDATORY: the LevelDB .log files stay write-open
    # while Chrome runs, and File.ReadAllBytes (share=Read only) then fails
    # with a sharing violation — the very bug this gate must not hide. Node's
    # proven T1b probe opened read-write-shared; this mirrors it exactly.
    # First-attempt failure observed 2026-10-25: pair present, scan blind.
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        $buffer = New-Object System.IO.MemoryStream
        $stream.CopyTo($buffer)
        # Unary comma keeps an EMPTY byte[] from collapsing to $null through
        # the PowerShell pipeline (zero-length .log files do exist).
        return , $buffer.ToArray()
    } finally {
        $stream.Dispose()
        $buffer.Dispose()
    }
}

function Get-QwenCredsFromBrowserStorage {
    # Scans Chrome + Edge profile storage for the stored qwen ak-sk pair
    # (chrome.storage.local serializes as plain JSON inside the LevelDB files).
    $roots = @(
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data')
    )
    $latin1 = [System.Text.Encoding]::GetEncoding(28591)
    $pattern = '"accessKeyId"\s*:\s*"(LTAI[^"]{6,})"\s*,\s*"accessKeySecret"\s*:\s*"([^"\x00]{8,})"'
    $best = $null  # newest mtime wins across every profile/extension match
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($prof in (Get-ChildItem -LiteralPath $root -Directory)) {
            $les = Join-Path $prof.FullName 'Local Extension Settings'
            if (-not (Test-Path -LiteralPath $les)) { continue }
            foreach ($extDir in (Get-ChildItem -LiteralPath $les -Directory)) {
                $candidates = Get-ChildItem -LiteralPath $extDir.FullName -File |
                    Where-Object { $_.Name -match '\.(log|ldb)$' }
                foreach ($f in $candidates) {
                    try { $bytes = Read-BytesFileShared -Path $f.FullName } catch { continue }
                    if ($null -eq $bytes -or $bytes.Length -eq 0) { continue }
                    $m = [regex]::Match($latin1.GetString($bytes), $pattern)
                    if ($m.Success -and (($null -eq $best) -or ($f.LastWriteTimeUtc -gt $best.Mtime))) {
                        $best = [pscustomobject]@{
                            Id     = $m.Groups[1].Value
                            Secret = $m.Groups[2].Value
                            Mtime  = $f.LastWriteTimeUtc
                        }
                    }
                }
            }
        }
    }
    return $best
}

$creds = Get-QwenCredsFromBrowserStorage
if ($null -eq $creds) {
    Write-Host 'creds NOT found in browser extension storage (Chrome/Edge profiles scanned; is the unpacked extension loaded with the qwen AK/SK stored?)'
    Write-Host 'PUBLISH GATE FAIL'
    exit 1
}
# Masked provenance only — the same disclosure shape as the T1b probe: partial
# id, secret LENGTH, never either value.
Write-Host ('creds-found: ak {0}...{1} | secret len {2} (held in memory only)' -f
    $creds.Id.Substring(0, 4), $creds.Id.Substring($creds.Id.Length - 4), $creds.Secret.Length)

try {
    $env:QWEN_AK_ID = $creds.Id
    $env:QWEN_AK_SECRET = $creds.Secret
    $env:QUOTADECK_LIVE = '1'

    Push-Location (Join-Path (Split-Path -Parent $PSScriptRoot) 'extension')
    # cmd-level 2>&1 keeps vitest's stderr in the captured string stream
    # without PowerShell 5.1 turning each line into an ErrorRecord.
    # --reporter=verbose is REQUIRED for the gate contract: the default
    # reporter prints only the summary when piped (non-TTY), swallowing
    # the test's single {percentage,resetAtISO} console.log line.
    $output = & cmd /c 'npx vitest run src/contract/live.contract.test.ts --reporter=verbose 2>&1'
    $vitestRc = $LASTEXITCODE
    Pop-Location
} finally {
    $env:QWEN_AK_ID = $null
    $env:QWEN_AK_SECRET = $null
    $env:QUOTADECK_LIVE = $null
    $creds = $null
    [GC]::Collect()
}

# The single contract line printed by the test itself ({percentage,resetAtISO}
# — no material), then the result tail. Neither can carry credentials: the
# pipeline never prints them, by construction (pinned across WU-B..WU-G).
$contractLine = @($output | Where-Object { $_ -match 'resetAtISO' })
if ($contractLine.Count -gt 0) {
    Write-Host '--- live quota contract ---'
    $contractLine | ForEach-Object { Write-Host $_ }
}
Write-Host '--- vitest tail ---'
$output | Select-Object -Last 25 | ForEach-Object { Write-Host $_ }

if ($vitestRc -eq 0) {
    Write-Host 'PUBLISH GATE PASS'
    exit 0
}
Write-Host 'PUBLISH GATE FAIL'
exit 1
