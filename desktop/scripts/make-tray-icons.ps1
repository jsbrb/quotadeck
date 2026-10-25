# Generates the 4 threshold-band tray icons - same hito-10 palette as the
# extension badgeBackgroundColor bands (neutral <50, orange >=50, deep >=80,
# red >=90). A filled circle reads cleanly at the 16px tray size.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$bands = [ordered]@{
  neutral = '#E2E8F0'
  orange  = '#F97316'
  deep    = '#EA580C'
  red     = '#DC2626'
}
$outDir = Join-Path $PSScriptRoot "..\src-tauri\icons\tray"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

foreach ($entry in $bands.GetEnumerator()) {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($entry.Value))
  $g.FillEllipse($brush, 2, 2, 28, 28)
  $g.Dispose()
  $bmp.Save((Join-Path $outDir "$($entry.Key).png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
Write-Output "tray band icons written to $outDir"
