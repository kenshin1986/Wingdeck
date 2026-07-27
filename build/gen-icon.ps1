# Genera el icono de Wingdeck (cuadrado redondeado + par de alas en chevron) en varios tamaños.
Add-Type -AssemblyName System.Drawing

$sizes = 16, 32, 48, 64, 128, 256
$bg = [System.Drawing.Color]::FromArgb(255, 0x0a, 0x0e, 0x14)
$wingPrimary = [System.Drawing.Color]::FromArgb(255, 0x7a, 0xa2, 0xf7)
$wingSecondary = [System.Drawing.Color]::FromArgb(255, 0xe0, 0xaf, 0x68)

function New-RoundedPath($x, $y, $w, $h, $radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Chevron($size, $cx, $cyTip, $halfSpan, $depth) {
  # Ala en forma de "^" ancho: dos puntas abajo, un ápice arriba.
  $sx = { param($v) $v * $size / 100.0 }
  $x1 = & $sx ($cx - $halfSpan)
  $x2 = $cx * $size / 100.0
  $x3 = & $sx ($cx + $halfSpan)
  $y1 = & $sx ($cyTip + $depth)
  $y2 = & $sx $cyTip
  $y3 = & $sx ($cyTip + $depth)
  return @(
    (New-Object System.Drawing.PointF($x1, $y1)),
    (New-Object System.Drawing.PointF($x2, $y2)),
    (New-Object System.Drawing.PointF($x3, $y3))
  )
}

$outDir = $PSScriptRoot
foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $radius = [Math]::Max(2, [int]($size * 0.22))
  $bgPath = New-RoundedPath 0 0 $size $size $radius
  $bgBrush = New-Object System.Drawing.SolidBrush $bg
  $g.FillPath($bgBrush, $bgPath)
  $bgBrush.Dispose()
  $bgPath.Dispose()

  # Ala principal: chevron ancho y grueso, azul.
  $penWidth1 = [Math]::Max(1.6, $size * 0.135)
  $pen1 = New-Object System.Drawing.Pen($wingPrimary, $penWidth1)
  $pen1.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen1.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen1.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $pts1 = New-Chevron $size 50 30 30 30
  $g.DrawLines($pen1, $pts1)
  $pen1.Dispose()

  # Ala trasera: chevron más chico y bajo, ámbar — sugiere profundidad/formación.
  $penWidth2 = [Math]::Max(1.2, $size * 0.095)
  $pen2 = New-Object System.Drawing.Pen($wingSecondary, $penWidth2)
  $pen2.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen2.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen2.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $pts2 = New-Chevron $size 61 46 19 18
  $g.DrawLines($pen2, $pts2)
  $pen2.Dispose()

  $bmp.Save("$outDir\icon-$size.png", [System.Drawing.Imaging.ImageFormat]::Png)
  if ($size -eq 32) { $bmp.Save("$outDir\tray.png", [System.Drawing.Imaging.ImageFormat]::Png) }
  $g.Dispose()
  $bmp.Dispose()
  Write-Output "icon-$size.png ok"
}
