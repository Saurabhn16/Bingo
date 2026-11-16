$ErrorActionPreference = "Stop"
$ProjectRoot = (Get-Location).Path
if (!(Test-Path (Join-Path $ProjectRoot "server.js"))) {
  throw "Run this script from your GameZone project root (the folder containing server.js)."
}
$Public = Join-Path $ProjectRoot "public"
if (!(Test-Path $Public)) { throw "public folder not found." }

$PatchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Files = @("tictactoe.html","tictactoe.css","tictactoe.js")
foreach ($File in $Files) {
  $Source = Join-Path (Join-Path $PatchRoot "public") $File
  if (!(Test-Path $Source)) { throw "Patch is incomplete: $Source not found." }
}

$ServerPath = Join-Path $ProjectRoot "server.js"
$Server = Get-Content -LiteralPath $ServerPath -Raw
$Marker = "// ================= TICTACTOE MULTIPLAYER ADDON ================="
if ($Server.Contains($Marker)) {
  throw "Tic-Tac-Toe backend addon already appears to be installed. No changes made."
}
$PortMarker = "const PORT = process.env.PORT || 3000;"
if (!$Server.Contains($PortMarker)) {
  throw "Could not find the server PORT marker. No files changed."
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Backup = Join-Path $ProjectRoot "backup-tictactoe-$Stamp"
New-Item -ItemType Directory -Path $Backup | Out-Null
Copy-Item $ServerPath (Join-Path $Backup "server.js")
foreach ($File in $Files) {
  $Target = Join-Path $Public $File
  if (Test-Path $Target) { Copy-Item $Target (Join-Path $Backup $File) -Force }
}

$AddonPath = Join-Path $PatchRoot "tictactoe-server-addon.js"
$Addon = Get-Content -LiteralPath $AddonPath -Raw
$Server = $Server.Replace($PortMarker, $Addon + "`r`n" + $PortMarker)
Set-Content -LiteralPath $ServerPath -Value $Server -Encoding UTF8

foreach ($File in $Files) {
  Copy-Item (Join-Path (Join-Path $PatchRoot "public") $File) (Join-Path $Public $File) -Force
}

Write-Host "Tic-Tac-Toe files installed. Existing Bingo files were not replaced." -ForegroundColor Green
Write-Host "Backup created at: $Backup"
Write-Host "Next: node --check .\server.js"
Write-Host "Then run: npm run dev"
