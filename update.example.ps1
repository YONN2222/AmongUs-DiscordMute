$amongUsRoot = "C:\Path\To\Your\Among Us Folder"

$repoRoot = $PSScriptRoot
$discordBotPath = Join-Path $repoRoot "DiscordBot"
$dllPath = Join-Path $repoRoot "DLL"
$binPath = Join-Path $dllPath "bin"
$objPath = Join-Path $dllPath "obj"
$builtDllPath = Join-Path $dllPath "bin\Release\net6.0\DiscordMute.dll"
$pluginsPath = Join-Path $amongUsRoot "BepInEx\plugins"
$oldDllPath = Join-Path $pluginsPath "DiscordMute.dll"
$amongUsExePath = Join-Path $amongUsRoot "Among Us.exe"

function Stop-WithMessage($message) {
    Write-Host $message
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not (Test-Path $amongUsRoot -PathType Container)) {
    Stop-WithMessage "Among Us folder not found. Check `$amongUsRoot at the top of update.ps1."
}

if (-not (Test-Path $amongUsExePath -PathType Leaf)) {
    Stop-WithMessage "Among Us.exe not found. `$amongUsRoot must point to your Among Us folder, not the DiscordBot folder."
}

if (-not (Test-Path $pluginsPath -PathType Container)) {
    Stop-WithMessage "BepInEx plugins folder not found. Install BepInEx first or check `$amongUsRoot."
}

Set-Location $discordBotPath
bun run build
if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage "Error in bun build"
}

if (Test-Path $binPath) {
    Remove-Item $binPath -Recurse -Force
    Write-Host "Deleted bin folder"
}

if (Test-Path $objPath) {
    Remove-Item $objPath -Recurse -Force
    Write-Host "Deleted obj folder"
}

if (Test-Path $oldDllPath) {
    Remove-Item $oldDllPath -Force
    Write-Host "Deleted old DLL"
}

Set-Location $dllPath
dotnet build -c Release -f net6.0
if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage "Error in dotnet build"
}

if (-not (Test-Path $builtDllPath -PathType Leaf)) {
    Stop-WithMessage "Built DLL not found after build."
}

try {
    Copy-Item $builtDllPath $pluginsPath -Force -ErrorAction Stop
}
catch {
    Stop-WithMessage "Failed to copy DiscordMute.dll to the BepInEx plugins folder: $($_.Exception.Message)"
}

Write-Host "Done"

$answer = Read-Host "Open Among Us? (y/N)"
if ($answer -eq "y" -or $answer -eq "Y") {
    Start-Process $amongUsExePath
}

$answer2 = Read-Host "Open folder in Explorer? (y/N)"
if ($answer2 -eq "y" -or $answer2 -eq "Y") {
    Start-Process "explorer.exe" $amongUsRoot
}

Read-Host "Press Enter to exit"
