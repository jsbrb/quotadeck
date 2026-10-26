# autotest-desktop.ps1 - WU-O gate: launches the debug binary in AUTOTEST
# mode, waits for the self-check report in prefs, prints verdicts, and exits
# non-zero if any scenario the user reported fails. ASCII only (PS 5.1).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$exe = Join-Path $root "desktop\src-tauri\target\debug\quotadeck-desktop.exe"
if (-not (Test-Path $exe)) { Write-Error "build first: cargo build --features custom-protocol"; exit 2 }

$prefsPath = Join-Path $env:APPDATA "es.thenorthcode.quotadeck.desktop\prefs.json"

Get-Process -Name "quotadeck-desktop" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
if (Test-Path $prefsPath) {
  $prefs = Get-Content $prefsPath -Raw | ConvertFrom-Json
  if ($prefs.PSObject.Properties.Name -contains "qd:autotest") {
    $prefs.PSObject.Properties.Remove("qd:autotest")
    [System.IO.File]::WriteAllText($prefsPath, ($prefs | ConvertTo-Json -Depth 30 -Compress), (New-Object System.Text.UTF8Encoding($false)))
  }
}

$env:QUOTADECK_AUTOTEST = "1"
$proc = Start-Process -FilePath $exe -PassThru
Remove-Item Env:\QUOTADECK_AUTOTEST

$deadline = (Get-Date).AddSeconds(120)
$report = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  if (-not (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)) {
    Write-Host "AUTOTEST process died early (crash?)" -ForegroundColor Red
    break
  }
  try {
    $current = (Get-Content $prefsPath -Raw | ConvertFrom-Json)."qd:autotest"
  } catch { continue }
  if ($null -ne $current -and $current.finishedAt) { $report = $current; break }
}

Get-Process -Name "quotadeck-desktop" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

if ($null -eq $report) {
  Write-Host "AUTOTEST FAIL: no report produced (hang, crash, or prefs unavailable)" -ForegroundColor Red
  exit 1
}

Write-Host "--- autotest report ---"
$report | ConvertTo-Json -Depth 10 | Write-Host

$verdicts = $report.verdicts
$failed = @()
foreach ($prop in $verdicts.PSObject.Properties) {
  $ok = [bool]$prop.Value
  if ($ok) {
    Write-Host ("{0,-28} PASS" -f $prop.Name) -ForegroundColor Green
  } else {
    Write-Host ("{0,-28} FAIL" -f $prop.Name) -ForegroundColor Red
    $failed += $prop.Name
  }
}

if ($failed.Count -gt 0) {
  Write-Host ("AUTOTEST FAIL: {0}" -f ($failed -join ", ")) -ForegroundColor Red
  exit 1
}
Write-Host "AUTOTEST PASS" -ForegroundColor Green
exit 0
