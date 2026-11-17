# Copies the plugin into your RuneScape BETA client's dev_plugins folder.
# Re-run after every edit, then `prl gim-companion` in the client console.
# Your config.lua (with your token) is never overwritten.
param([string]$BetaDir = "C:\ProgramData\Jagex\RuneScape-BETA")

$src = Join-Path $PSScriptRoot "gim-companion"
$dst = Join-Path $BetaDir "dev_plugins\gim-companion"

if (-not (Test-Path $BetaDir)) {
    throw "Beta folder not found: $BetaDir. Launch the RuneScape beta once first (see plugin/README.md)."
}

New-Item -ItemType Directory -Force $dst | Out-Null
robocopy $src $dst /E /XF config.lua | Out-Null   # exit codes 0-7 mean success

if (-not (Test-Path (Join-Path $dst "config.lua"))) {
    Copy-Item (Join-Path $src "config.example.lua") (Join-Path $dst "config.lua")
    Write-Host "Created $dst\config.lua - open it and paste your token."
}

Write-Host "Installed to $dst"
Write-Host "In the beta client: press ALT + the key under Esc, then run:  prf   then   pon gim-companion   (prl gim-companion after edits)"
