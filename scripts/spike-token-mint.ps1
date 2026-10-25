# hito-12 T1b spike: prove the AK/SK path can mint a bailian CLI access token
# WITHOUT any browser device-flow (the only auth route an MV3 extension can
# reproduce). Runs the official bl CLI so the vendor's own ACS3-HMAC-SHA256
# signing is exercised verbatim; --verbose echoes the request with masked AK.
#
# Secrets stay local: they are typed at the prompts, never written to files by
# this script, and passed to bl as process arguments only. The CLI itself then
# stores the AK/SK pair in ~/.bailian/config.json (openapi section); to remove
# it afterwards run:  bl auth logout --open-api
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\spike-token-mint.ps1
$ErrorActionPreference = 'Stop'

$configPath = Join-Path $env:USERPROFILE '.bailian\config.json'
if (Test-Path -LiteralPath $configPath) {
    Copy-Item -LiteralPath $configPath -Destination "$configPath.spike.bak" -Force
    Write-Host 'config backed up to config.json.spike.bak'
}

Write-Host 'Enter the SAME Alibaba Cloud AK/SK pair you stored in quotadeck for Qwen.'
$akId = Read-Host 'AccessKeyId'
$akSecretPlain = [Runtime.InteropServices.Marshal]::PtrToStringUni(
    [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode(
        (Read-Host 'AccessKeySecret' -AsSecureString)))

try {
    Write-Host "`n--- 1. mint via AK/SK (no browser) ---"
    & bl auth login --open-api --access-key-id $akId --access-key-secret $akSecretPlain --verbose
    $mintRc = $LASTEXITCODE

    Write-Host "`n--- 2. quota call must still work, token now AK/SK-minted ---"
    & bl usage token-plan --output json --verbose
    $usageRc = $LASTEXITCODE
} finally {
    $akSecretPlain = $null
    [GC]::Collect()
}

Write-Host "`nmint exit=$mintRc usage exit=$usageRc"
if ($mintRc -eq 0 -and $usageRc -eq 0) {
    Write-Host 'T1b RESULT: AK/SK mint works headlessly. Extension path PROVEN.'
} else {
    Write-Host 'T1b RESULT: failure above is the evidence - report the error text.'
}
