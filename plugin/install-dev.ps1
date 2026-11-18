# Copies the plugin into your RuneScape BETA client's dev_plugins folder, pointed at a server on THIS computer.
# Re-run after every edit, then `prl gim-companion` in the client console.
# Your config.lua (with your token) is never overwritten.
#   -Server  the API the dev copy talks to (default: the local development server)
param([string]$BetaDir = "C:\ProgramData\Jagex\RuneScape-BETA", [string]$Server = "http://localhost:3001")

$src = Join-Path $PSScriptRoot "gim-companion"
$dst = Join-Path $BetaDir "dev_plugins\gim-companion"

if (-not (Test-Path $BetaDir)) {
    throw "Beta folder not found: $BetaDir. Launch the RuneScape beta once first (see plugin/README.md)."
}

New-Item -ItemType Directory -Force $dst | Out-Null
robocopy $src $dst /E /XF config.lua | Out-Null   # exit codes 0-7 mean success

# The released manifest points at https://api.groupiron.com; the development copy points at the local server instead.
$manifest = Join-Path $dst "plugin.json"
# Written WITHOUT a byte-order mark: Windows PowerShell's "-Encoding utf8" adds one, and a BOM can stop the client reading the manifest.
$text = (Get-Content $manifest -Raw) -replace 'https://api\.groupiron\.com', $Server
[IO.File]::WriteAllText($manifest, $text, (New-Object System.Text.UTF8Encoding $false))

if (-not (Test-Path (Join-Path $dst "config.lua"))) {
    Copy-Item (Join-Path $src "config.example.lua") (Join-Path $dst "config.lua")
    Write-Host "Created $dst\config.lua - open it and paste your token."
}

Write-Host "Installed to $dst (server: $Server)"
Write-Host "In the beta client: press ALT + the key under Esc, then run:  prf   then   pon gim-companion   (prl gim-companion after edits)"
