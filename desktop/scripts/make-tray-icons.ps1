# Generates the 4 threshold-band tray icons (WU-M): a legible blue disc with
# a white "Q" (the QuotaDeck initial), plus a corner band dot matching the
# extension badgeBackgroundColor bands (no dot <50, orange >=50, deep >=80,
# red >=90). The old flat light-slate "neutral" circle was illegible on the
# dark Windows tray.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$bands = [ordered]@{
  neutral = $null
  orange  = '#F97316'
  deep    = '#EA580C'
  red     = '#DC2626'
}
$baseBlue = '#2563EB'
$outDir = Join-Path $PSScriptRoot "..\src-tauri\icons\tray"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

foreach ($entry in $bands.GetEnumerator()) {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $baseBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($baseBlue))
  $g.FillEllipse($baseBrush, 1, 1, 30, 30)

  $font = New-Object System.Drawing.Font ('Segoe UI', 15, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF (0, -1, 32, 32)
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $g.DrawString('Q', $font, $white, $rect, $fmt)

  if ($entry.Value -ne $null) {
    $dotBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($entry.Value))
    $g.FillEllipse($dotBrush, 19, 19, 12, 12)
    $g.DrawEllipse([System.Drawing.Pen]::new([System.Drawing.Color]::White, 1.5), 19, 19, 12, 12)
  }

  $g.Dispose()
  $bmp.Save((Join-Path $outDir "$($entry.Key).png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
Write-Output "tray band icons (blue Q + band dots) written to $outDir"
