# make-screenshot.ps1 - generates the 1280x800 Chrome Web Store listing
# screenshot (hito-11 restyle). Renders a neo-brutalist promo mirroring the
# shipped popup: warm-paper canvas, 2px ink borders, 0 radius, hard offset
# shadows, uppercase mono chips, segmented threshold bars, the QUOTAS/KEYS
# tab bar and the honest "Built by The North Code" footer. The PNG is a
# listing asset only - it never ships inside the extension zip. Windows-only
# by design (System.Drawing, zero npm deps). Run from the extension dir:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-screenshot.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$W = 1280
$H = 800
$outDir = Join-Path $PSScriptRoot '..\..\docs\store'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outPath = Join-Path $outDir 'screenshot-1280x800.png'

# DESIGN.md tokens (neo-brutalist developer instrument)
$PAPER = '#FDFDF7'; $INK = '#18181B'; $YELLOW = '#FDE047'
$GREEN = '#16A34A'; $AMBER = '#F59E0B'; $RED = '#DC2626'
$MUTED = '#52525B'; $INDIGO = '#4F46E5'; $WHITE = '#FFFFFF'
$BAND = $AMBER  # 72% hero band for the showcase (>=70 amber)
# Middle dot by codepoint - PS 5.1 reads .ps1 as ANSI, so a literal UTF-8
# middle dot in source renders as mojibake (Â·). Build it at runtime instead.
$DOT = [string][char]0xB7

function FromHex([string]$hex) {
    return [System.Drawing.Color]::FromArgb(255,
        [Convert]::ToInt32($hex.Substring(1, 2), 16),
        [Convert]::ToInt32($hex.Substring(3, 2), 16),
        [Convert]::ToInt32($hex.Substring(5, 2), 16))
}

function Draw-Text([string]$text, [float]$x, [float]$y, [float]$size, [bool]$bold, [string]$hex, [string]$family) {
    if (-not $family) { $family = 'Segoe UI' }
    $style = [System.Drawing.FontStyle]::Regular; if ($bold) { $style = [System.Drawing.FontStyle]::Bold }
    $font = New-Object System.Drawing.Font($family, $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush((FromHex $hex))
    $script:G.DrawString($text, $font, $brush, (New-Object System.Drawing.PointF($x, $y)))
    $font.Dispose(); $brush.Dispose()
}

function Draw-TextCentered([string]$text, [float]$cx, [float]$y, [float]$size, [bool]$bold, [string]$hex, [string]$family) {
    if (-not $family) { $family = 'Segoe UI' }
    $style = [System.Drawing.FontStyle]::Regular; if ($bold) { $style = [System.Drawing.FontStyle]::Bold }
    $font = New-Object System.Drawing.Font($family, $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush((FromHex $hex))
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(($cx - 500), $y, 1000, ($size * 1.7))
    $script:G.DrawString($text, $font, $brush, $rect, $fmt)
    $font.Dispose(); $brush.Dispose(); $fmt.Dispose()
}

# Hard-offset-shadow panel: ink rect behind, filled card + 2px ink border on top.
function Draw-Panel([float]$x, [float]$y, [float]$w, [float]$h, [string]$fillHex, [float]$off) {
    $sh = New-Object System.Drawing.SolidBrush((FromHex $INK))
    $script:G.FillRectangle($sh, ($x + $off), ($y + $off), $w, $h)
    $sh.Dispose()
    $fill = New-Object System.Drawing.SolidBrush((FromHex $fillHex))
    $script:G.FillRectangle($fill, $x, $y, $w, $h)
    $fill.Dispose()
    $pen = New-Object System.Drawing.Pen((FromHex $INK), 2)
    $script:G.DrawRectangle($pen, $x, $y, $w, $h)
    $pen.Dispose()
}

# Square chip with 2px ink border + mono uppercase label centered.
function Draw-Chip([string]$text, [float]$x, [float]$y, [float]$w, [float]$h, [string]$bgHex, [string]$fgHex, [float]$size) {
    $b = New-Object System.Drawing.SolidBrush((FromHex $bgHex))
    $script:G.FillRectangle($b, $x, $y, $w, $h)
    $b.Dispose()
    $pen = New-Object System.Drawing.Pen((FromHex $INK), 2)
    $script:G.DrawRectangle($pen, $x, $y, $w, $h)
    $pen.Dispose()
    $font = New-Object System.Drawing.Font('Consolas', $size, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush((FromHex $fgHex))
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $script:G.DrawString($text, $font, $brush, (New-Object System.Drawing.RectangleF($x, $y, $w, $h)), $fmt)
    $font.Dispose(); $brush.Dispose(); $fmt.Dispose()
}

# Segmented threshold bar: bordered track, solid fill, 2px ink ticks at 25/50/75/90%.
function Draw-SegBar([float]$x, [float]$y, [float]$w, [float]$ratio, [string]$fillHex) {
    $h = 20
    $t = New-Object System.Drawing.SolidBrush((FromHex $WHITE))
    $script:G.FillRectangle($t, $x, $y, $w, $h); $t.Dispose()
    $fw = [Math]::Max(0, [Math]::Min(1.0, $ratio) * ($w - 4))
    if ($fw -gt 0) {
        $f = New-Object System.Drawing.SolidBrush((FromHex $fillHex))
        $script:G.FillRectangle($f, ($x + 2), ($y + 2), $fw, ($h - 4)); $f.Dispose()
    }
    $pen = New-Object System.Drawing.Pen((FromHex $INK), 2)
    $script:G.DrawRectangle($pen, $x, $y, $w, $h)
    foreach ($tick in @(0.25, 0.5, 0.75, 0.9)) {
        $tx = $x + ($w * $tick)
        $script:G.DrawLine($pen, $tx, $y, $tx, ($y + $h))
    }
    $pen.Dispose()
}

function Draw-Logo([float]$x, [float]$y, [float]$size, [float]$font, [float]$off) {
    $sh = New-Object System.Drawing.SolidBrush((FromHex $INK))
    $script:G.FillRectangle($sh, ($x + $off), ($y + $off), $size, $size); $sh.Dispose()
    $b = New-Object System.Drawing.SolidBrush((FromHex $INDIGO))
    $script:G.FillRectangle($b, $x, $y, $size, $size); $b.Dispose()
    $pen = New-Object System.Drawing.Pen((FromHex $INK), 2)
    $script:G.DrawRectangle($pen, $x, $y, $size, $size); $pen.Dispose()
    $fontObj = New-Object System.Drawing.Font('Segoe UI', $font, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $script:G.DrawString('Q', $fontObj, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF($x, $y, $size, $size)), $fmt)
    $fontObj.Dispose(); $fmt.Dispose()
}

$bitmap = New-Object System.Drawing.Bitmap($W, $H)
$script:G = [System.Drawing.Graphics]::FromImage($bitmap)
$script:G.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$script:G.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# Canvas (warm paper) + a thin ink frame for the brutalist feel
$bg = New-Object System.Drawing.SolidBrush((FromHex $PAPER))
$script:G.FillRectangle($bg, 0, 0, $W, $H); $bg.Dispose()
$frame = New-Object System.Drawing.Pen((FromHex $INK), 4)
$script:G.DrawRectangle($frame, 2, 2, ($W - 4), ($H - 4)); $frame.Dispose()

# Header
Draw-Logo 64 48 88 56 5
Draw-Text 'quotadeck' 176 60 54 $true $INK $null
Draw-Text 'GLM Coding Plan usage, live in your toolbar' 180 128 24 $false $MUTED $null

# ---- Left panel: toolbar badge mockup ----
Draw-Panel 64 200 520 470 $WHITE 8
Draw-Chip 'TOOLBAR BADGE' 96 232 190 34 $INK $YELLOW 15
Draw-Panel 96 292 456 78 $PAPER 0
Draw-Logo 116 312 38 24 3
Draw-Chip '72%' 172 314 74 36 $AMBER $INK 20
Draw-Text "uncapped  $DOT  refreshes every minute" 116 392 18 $false $MUTED 'Consolas'
# threshold legend
Draw-Chip '32%' 96 452 64 30 $GREEN $INK 15
Draw-Text '< 70%' 176 456 16 $false $MUTED 'Consolas'
Draw-Chip '72%' 96 494 64 30 $AMBER $INK 15
Draw-Text '70-89%' 176 498 16 $false $MUTED 'Consolas'
Draw-Chip '95%' 96 536 64 30 $RED $INK 15
Draw-Text '>= 90%' 176 540 16 $false $MUTED 'Consolas'
Draw-Chip "PLAN $DOT PRO" 96 604 150 34 $YELLOW $INK 15

# ---- Right panel: popup mockup ----
$px = 636
Draw-Panel $px 200 580 470 $WHITE 8
$cx = $px + 32
# popup header
Draw-Text 'quotadeck' $cx 232 26 $true $INK $null
Draw-Chip "PLAN $DOT PRO" ($cx + 200) 236 150 30 $YELLOW $INK 14
$gear = New-Object System.Drawing.Pen((FromHex $INK), 2)
$script:G.DrawRectangle($gear, ($px + 528), 232, 24, 24); $gear.Dispose()
$hr = New-Object System.Drawing.Pen((FromHex $INK), 2)
$script:G.DrawLine($hr, $cx, 276, ($px + 552), 276); $hr.Dispose()
# 5h window: dual hero + segmented bar
Draw-Text '72%' $cx 292 60 $true $BAND 'Consolas'
Draw-Text '5H ROLLING WINDOW' ($cx + 150) 306 16 $true $MUTED 'Consolas'
Draw-Chip 'RESETS 1H 20M' ($cx + 380) 300 150 28 $PAPER $INK 13
Draw-SegBar $cx 372 500 0.72 $BAND
Draw-Text '2,880 / 4,000 tokens' $cx 400 16 $false $MUTED 'Consolas'
# weekly window
Draw-Text 'WEEKLY BATCH' $cx 440 16 $true $MUTED 'Consolas'
Draw-SegBar $cx 464 500 0.42 $GREEN
Draw-Text "42%  $DOT  5,040 / 12,000 tokens" $cx 492 16 $false $MUTED 'Consolas'
# MCP
Draw-Text 'MCP: 3 / 60' $cx 528 18 $true $INK 'Consolas'
Draw-Chip 'MONTHLY' ($cx + 150) 526 108 24 $PAPER $INK 12
Draw-Text "search_web $DOT 1      fetch_url $DOT 2" $cx 560 15 $false $MUTED 'Consolas'

# tab bar (QUOTAS active / KEYS)
Draw-Chip 'QUOTAS' $cx 592 240 44 $YELLOW $INK 16
Draw-Chip 'KEYS' ($cx + 256) 592 240 44 $WHITE $INK 16

# honest footer
Draw-Text "v0.3.0  $DOT  Built by The North Code" $cx 648 15 $false $MUTED 'Consolas'

# Bottom trust line across the canvas
Draw-TextCentered "Local-only key  $DOT  zero remote code  $DOT  no analytics  $DOT  uncapped thresholds" ($W / 2) 716 20 $true $INK 'Consolas'

$bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$script:G.Dispose()
$bitmap.Dispose()
Write-Output "wrote $outPath"
