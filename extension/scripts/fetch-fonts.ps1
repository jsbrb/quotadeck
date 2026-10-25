# fetch-fonts.ps1 - one-time fetcher for the popup's local woff2 fonts
# (hito-11 popup restyle, WU1). The MV3 popup CSP forbids remote font URLs,
# so the two design-system families (Space Grotesk + JetBrains Mono, weights
# 500/600/700, latin subset, OFL-licensed) are downloaded ONCE and committed
# as static assets under public/fonts/. Re-run only to refresh the assets.
#
# The Google Fonts css2 API gates the served format on the User-Agent: a
# modern Chrome UA is required to receive woff2 URLs at all. Each downloaded
# file is verified to carry the wOF2 magic bytes before it is kept.
#
# Windows PowerShell 5.1 compatible. Run from the extension directory:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fetch-fonts.ps1
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$CssUrl = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap'
$UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
$OutDir = Join-Path $PSScriptRoot '..\public\fonts'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Output "requesting css2 (woff2-gated UA)..."
$css = (Invoke-WebRequest -Uri $CssUrl -Headers @{ 'User-Agent' = $UserAgent } -UseBasicParsing).Content

# Every `/* latin */`-commented @font-face block, in order. A modern UA may
# yield one static file per weight OR (as observed 2026-10) one VARIABLE file
# per family whose URL repeats across the requested weights. Both shapes are
# handled: families served by a single URL are stored once as
# `<family>-latin.woff2` (declare `font-weight: 500 700` in @font-face);
# families served per-weight become `<family>-<weight>-latin.woff2`.
$blocks = [regex]::Matches($css, '(?sm)/\* latin \*/.*?@font-face\s*\{(?<body>[^}]*)\}')
if ($blocks.Count -eq 0) {
    throw 'no /* latin */ @font-face blocks found in the css2 response'
}

$parsed = foreach ($block in $blocks) {
    $body = $block.Groups['body'].Value
    $family = [regex]::Match($body, "font-family:\s*'([^']+)'").Groups[1].Value
    $weight = [regex]::Match($body, 'font-weight:\s*([^;]+);').Groups[1].Value.Trim()
    $url = [regex]::Match($body, "src:\s*url\((\S+?)\)\s*format\('woff2'\)").Groups[1].Value
    if (-not $family -or -not $weight -or -not $url) {
        throw "latin block missing family/weight/woff2 src: $body"
    }
    [pscustomobject]@{ Family = $family; Weight = $weight; Url = $url }
}

$downloads = @{}
foreach ($group in ($parsed | Group-Object Family)) {
    $slug = ($group.Name.ToLower() -replace '[^a-z0-9]+', '-')
    $urls = @($group.Group.Url | Select-Object -Unique)
    if ($urls.Count -eq 1) {
        # Variable file covering the requested range — one asset per family.
        $downloads["$slug-latin.woff2"] = $urls[0]
    } else {
        foreach ($item in $group.Group) {
            $weightSlug = ($item.Weight -replace '\s+', '-')
            $downloads["$slug-$weightSlug-latin.woff2"] = $item.Url
        }
    }
}

foreach ($entry in ($downloads.GetEnumerator() | Sort-Object Name)) {
    $outPath = Join-Path $OutDir $entry.Name
    Write-Output "downloading $($entry.Name) <- $($entry.Value)"
    Invoke-WebRequest -Uri $entry.Value -Headers @{ 'User-Agent' = $UserAgent } -OutFile $outPath -UseBasicParsing

    # wOF2 magic bytes (offset 0) — reject HTML error pages masquerading as fonts.
    $head = [System.IO.File]::ReadAllBytes($outPath)[0..3]
    $magic = [System.Text.Encoding]::ASCII.GetString($head)
    if ($magic -ne 'wOF2') {
        Remove-Item -LiteralPath $outPath -Force
        throw "$($entry.Name) is not a woff2 file (magic '$magic')"
    }
}

Write-Output ""
Write-Output "fetched $($downloads.Count) latin woff2 files into public/fonts/:"
foreach ($name in $downloads.Keys | Sort-Object) {
    $item = Get-Item -LiteralPath (Join-Path $OutDir $name)
    Write-Output ("  {0}  {1:N0} bytes" -f $item.Name, $item.Length)
}
