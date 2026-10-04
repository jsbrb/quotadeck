# make-icons.ps1 - one-time generator for the Chrome Web Store icon set
# (hito-10 store packaging). Produces public/icons/icon{16,32,48,128}.png:
# an indigo (#4F46E5) rounded square (corner radius ~19% of the size) with a
# white bold "Q" centered. Windows-only by design (System.Drawing, zero npm
# deps). Run from the extension directory:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sizes = @(16, 32, 48, 128)
$outDir = Join-Path $PSScriptRoot '..\public\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null | Out-Null

foreach ($size in $sizes) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)

    # Rounded indigo square: corner radius ~19% of the size (3px at 16).
    $radius = [int][Math]::Round($size * 0.19)
    $diameter = $radius * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
    $path.AddArc($size - $diameter, 0, $diameter, $diameter, 270, 90)
    $path.AddArc($size - $diameter, $size - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc(0, $size - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    $fill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 79, 70, 229))
    $graphics.FillPath($fill, $path)

    # White bold "Q" centered (Segoe UI Bold, ~66% of the size).
    $font = New-Object System.Drawing.Font(
        'Segoe UI',
        ($size * 0.66),
        [System.Drawing.FontStyle]::Bold,
        [System.Drawing.GraphicsUnit]::Pixel
    )
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $bounds = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $graphics.DrawString('Q', $font, [System.Drawing.Brushes]::White, $bounds, $format)

    $pngPath = Join-Path $outDir ("icon{0}.png" -f $size)
    $bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $graphics.Dispose()
    $bitmap.Dispose()
    $path.Dispose()
    $fill.Dispose()
    $font.Dispose()
    $format.Dispose()
    Write-Output "wrote $pngPath ($($size)x$($size))"
}
