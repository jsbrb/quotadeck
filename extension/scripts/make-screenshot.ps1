# make-screenshot.ps1 - generates the 1280x800 Chrome Web Store listing
# screenshot (hito-10 store packaging). Renders a promo graphic mirroring the
# shipped UI: toolbar badge chip + popup card with the real section copy and
# the ratified threshold colors. The PNG is a listing asset only - it never
# ships inside the extension zip. Windows-only by design (System.Drawing,
# zero npm deps). Run from the extension directory:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-screenshot.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$W = 1280
$H = 800
$outDir = Join-Path $PSScriptRoot '..\..\docs\store'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outPath = Join-Path $outDir 'screenshot-1280x800.png'

function FromHex([string]$hex) {
    return [System.Drawing.Color]::FromArgb(255,
        [Convert]::ToInt32($hex.Substring(1, 2), 16),
        [Convert]::ToInt32($hex.Substring(3, 2), 16),
        [Convert]::ToInt32($hex.Substring(5, 2), 16))
}

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $d = $r * 2
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function Draw-CenteredLine([string]$text, [float]$y, [float]$size, [bool]$bold, [string]$hex) {
    Draw-CenteredAt $text ($W / 2) $y $size $bold $hex $W
}

function Draw-CenteredAt([string]$text, [float]$cx, [float]$y, [float]$size, [bool]$bold, [string]$hex, [float]$maxw) {
    $style = [System.Drawing.FontStyle]::Regular; if ($bold) { $style = [System.Drawing.FontStyle]::Bold }
    $font = New-Object System.Drawing.Font('Segoe UI', $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush((FromHex $hex))
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(($cx - $maxw / 2), $y, $maxw, ($size * 1.7))
    $script:G.DrawString($text, $font, $brush, $rect, $format)
    $font.Dispose(); $brush.Dispose(); $format.Dispose()
}

function Draw-Left([string]$text, [float]$x, [float]$y, [float]$size, [bool]$bold, [string]$hex) {
    $style = [System.Drawing.FontStyle]::Regular; if ($bold) { $style = [System.Drawing.FontStyle]::Bold }
    $font = New-Object System.Drawing.Font('Segoe UI', $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush((FromHex $hex))
    $script:G.DrawString($text, $font, $brush, (New-Object System.Drawing.PointF($x, $y)))
    $font.Dispose(); $brush.Dispose()
}

function Draw-Chip([string]$text, [float]$x, [float]$y, [float]$w, [float]$h, [string]$bgHex, [string]$fgHex, [float]$size) {
    $p = New-RoundedPath $x $y $w $h ($h / 2)
    $b = New-Object System.Drawing.SolidBrush((FromHex $bgHex))
    $script:G.FillPath($b, $p)
    $style = [System.Drawing.FontStyle]::Bold
    $font = New-Object System.Drawing.Font('Segoe UI', $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush((FromHex $fgHex))
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF($x, $y, $w, $h)
    $script:G.DrawString($text, $font, $brush, $rect, $format)
    $p.Dispose(); $b.Dispose(); $font.Dispose(); $brush.Dispose(); $format.Dispose()
}

function Draw-Bar([float]$x, [float]$y, [float]$w, [float]$fillRatio, [string]$fillHex) {
    $track = New-RoundedPath $x $y $w 14 7
    $tb = New-Object System.Drawing.SolidBrush((FromHex '#E2E8F0'))
    $script:G.FillPath($tb, $track)
    $fw = [Math]::Max(14.0, $w * $fillRatio)
    $fill = New-RoundedPath $x $y $fw 14 7
    $fb = New-Object System.Drawing.SolidBrush((FromHex $fillHex))
    $script:G.FillPath($fb, $fill)
    $track.Dispose(); $tb.Dispose(); $fill.Dispose(); $fb.Dispose()
}

function Draw-Card([float]$x, [float]$y, [float]$w, [float]$h) {
    $p = New-RoundedPath $x $y $w $h 16
    $fill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $pen = New-Object System.Drawing.Pen((FromHex '#CBD5E1'))
    $script:G.FillPath($fill, $p)
    $script:G.DrawPath($pen, $p)
    $p.Dispose(); $fill.Dispose(); $pen.Dispose()
}

function Draw-Logo([float]$x, [float]$y, [float]$size, [float]$font) {
    $p = New-RoundedPath $x $y $size $size ($size * 0.19)
    $b = New-Object System.Drawing.SolidBrush((FromHex '#4F46E5'))
    $script:G.FillPath($b, $p)
    $fontObj = New-Object System.Drawing.Font('Segoe UI', $font, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = [System.Drawing.Brushes]::White
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF($x, $y, $size, $size)
    $script:G.DrawString('Q', $fontObj, $brush, $rect, $format)
    $p.Dispose(); $b.Dispose(); $fontObj.Dispose(); $format.Dispose()
}

$bitmap = New-Object System.Drawing.Bitmap($W, $H)
$script:G = [System.Drawing.Graphics]::FromImage($bitmap)
$script:G.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$script:G.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# Canvas background (slate-100)
$bgBrush = New-Object System.Drawing.SolidBrush((FromHex '#F1F5F9'))
$script:G.FillRectangle($bgBrush, 0, 0, $W, $H)
$bgBrush.Dispose()

# Header: logo, title, tagline
Draw-Logo ((($W - 96) / 2)) 52 96 62
Draw-CenteredLine 'quotadeck' 168 52 $true '#0F172A'
Draw-CenteredLine 'GLM Coding Plan usage, live in your toolbar' 244 26 $false '#475569'

# Card A - toolbar badge mockup
Draw-Card 90 330 500 290
$urlBar = New-RoundedPath 130 380 420 56 12
$urlBrush = New-Object System.Drawing.SolidBrush((FromHex '#F1F5F9'))
$script:G.FillPath($urlBrush, $urlBar)
Draw-Logo 148 394 28 18
Draw-Chip '72%' 196 391 72 36 '#F97316' '#FFFFFF' 20
$urlBar.Dispose(); $urlBrush.Dispose()
Draw-CenteredAt 'Toolbar badge' 340 470 24 $true '#0F172A' 460
Draw-CenteredAt 'color-coded thresholds, uncapped' 340 506 18 $false '#64748B' 460

# Card B - popup mockup
$px = 690
Draw-Card $px 330 500 290
Draw-Left 'quotadeck' ($px + 30) 350 22 $true '#0F172A'
$dot = New-Object System.Drawing.SolidBrush((FromHex '#CBD5E1'))
$script:G.FillEllipse($dot, ($px + 448), 356, 18, 18)
$dot.Dispose()
Draw-Left 'GLM Coding Plan - PRO' ($px + 30) 386 18 $true '#0F172A'
Draw-Left '5h window' ($px + 30) 418 16 $false '#64748B'
Draw-Bar ($px + 30) 442 440 0.72 '#F97316'
Draw-Left '72% - 2880 / 4000 tokens' ($px + 30) 464 18 $true '#0F172A'
Draw-Left 'resets in 1h 20m' ($px + 30) 490 16 $false '#64748B'
$divider = New-Object System.Drawing.Pen((FromHex '#E2E8F0'))
$script:G.DrawLine($divider, ($px + 30), 520, ($px + 470), 520)
$divider.Dispose()
Draw-Left 'Weekly window' ($px + 30) 530 16 $false '#64748B'
Draw-Bar ($px + 30) 554 440 0.42 '#22C55E'
Draw-Left '42% - 5040 / 12000 tokens' ($px + 30) 576 18 $true '#0F172A'

# Bottom trust line
Draw-CenteredLine 'Uncapped percentages  -  refreshes every minute  -  your key never leaves your device' 700 20 $false '#64748B'

$bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$script:G.Dispose()
$bitmap.Dispose()
Write-Output "wrote $outPath"
