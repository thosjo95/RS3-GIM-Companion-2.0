# Builds the zip that is submitted on mod.io:  plugin\dist\gim-companion-<version>.zip  (version without dots, e.g. 100)
# Jagex requires main.lua and plugin.json at the TOP LEVEL of the zip. config.lua (a personal token) is never included.
$src = Join-Path $PSScriptRoot "gim-companion"
$manifest = Get-Content (Join-Path $src "plugin.json") -Raw | ConvertFrom-Json
$version = $manifest.version
if ($version -notmatch '^[0-9]+(\.[0-9]+)*$') { throw "The version must be numbers and dots only, found '$version'." }
if ($manifest.urls.gim -notmatch '^https://') { throw "plugin.json urls.gim must be an https address, found '$($manifest.urls.gim)'." }

$out = Join-Path $PSScriptRoot "dist"
New-Item -ItemType Directory -Force $out | Out-Null
$zip = Join-Path $out ("gim-companion-" + ($version -replace '\.', '') + ".zip")
if (Test-Path $zip) { Remove-Item $zip }

$files = "main.lua", "plugin.json", "json.lua" | ForEach-Object { Join-Path $src $_ }
Compress-Archive -Path $files -DestinationPath $zip
Write-Host "Built $zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::OpenRead($zip).Entries | ForEach-Object { Write-Host ("  " + $_.FullName) }
