# Launch an isolated Extension Development Host for EYRA.
# Uses the 8.3 short path so Chromium does not truncate at spaces in
# "Antigravity project". Prefer F5 ("Run EYRA Extension") from the
# project workspace when working inside Cursor or VS Code.
param(
  [string]$Fixture = ""
)

$ErrorActionPreference = "Stop"
$extensionLong = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$fso = New-Object -ComObject Scripting.FileSystemObject
$extension = $fso.GetFolder($extensionLong).ShortPath
if (-not $Fixture) {
  $Fixture = Join-Path $extensionLong "fixtures\phase8"
}
$fixture = $fso.GetFolder((Resolve-Path $Fixture).Path).ShortPath
$userData = Join-Path $env:TEMP ("eyra-edh-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force -Path $userData | Out-Null
$code = @(
  "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe",
  "$env:ProgramFiles\Microsoft VS Code\Code.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $code) {
  throw "VS Code Code.exe was not found."
}

Write-Host "extensionDevelopmentPath=$extension"
Write-Host "workspace=$fixture"
Write-Host "userData=$userData"
Start-Process -FilePath $code -ArgumentList @(
  "--user-data-dir=$userData",
  "--extensions-dir=$(Join-Path $userData 'exts')",
  "--extensionDevelopmentPath=$extension",
  "--disable-workspace-trust",
  "--new-window",
  $fixture
)
