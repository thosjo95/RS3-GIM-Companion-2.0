# Builds plugin\submission\listing-image.png (1280x720, 16:9) for the mod.io listing from client\public\logo.png.
# Dark background in the dashboard's colours, the logo in the middle, one line of text underneath.
Add-Type -AssemblyName System.Drawing
$root = Split-Path (Split-Path $PSScriptRoot)
$logo = [Drawing.Image]::FromFile((Join-Path $root "client\public\logo.png"))
$W = 1280; $H = 720
$bmp = New-Object Drawing.Bitmap $W, $H
$g = [Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.TextRenderingHint = 'AntiAliasGridFit'

# background: warm dark radial glow (dashboard --bg-panel) fading to --bg-root
$g.Clear([Drawing.Color]::FromArgb(13, 11, 8))
$path = New-Object Drawing.Drawing2D.GraphicsPath
$path.AddEllipse(-200, -260, $W + 400, $H + 520)
$glow = New-Object Drawing.Drawing2D.PathGradientBrush $path
$glow.CenterColor = [Drawing.Color]::FromArgb(48, 34, 18)
$glow.SurroundColors = @([Drawing.Color]::FromArgb(13, 11, 8))
$g.FillRectangle($glow, 0, 0, $W, $H)

# thin gold frame (dashboard --gold-dark)
$pen = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(154, 114, 48)), 2
$g.DrawRectangle($pen, 24, 24, $W - 49, $H - 49)

# logo, 1040 px wide, centred with the tagline
$lw = 1040; $lh = [int]($logo.Height * $lw / $logo.Width)
$g.DrawImage($logo, [int](($W - $lw) / 2), 100, $lw, $lh)

# tagline (dashboard --gold-light)
$font = New-Object Drawing.Font "Georgia", 30, ([Drawing.FontStyle]::Regular), ([Drawing.GraphicsUnit]::Pixel)
$brush = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(232, 192, 90))
$fmt = New-Object Drawing.StringFormat; $fmt.Alignment = 'Center'
$g.DrawString("Your group's banks, storage, quests, kills and drops on one dashboard", $font, $brush, (New-Object Drawing.RectangleF 0, 545, $W, 50), $fmt)

$out = Join-Path $PSScriptRoot "listing-image.png"
$bmp.Save($out, [Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $logo.Dispose()
Write-Host "Saved $out"
