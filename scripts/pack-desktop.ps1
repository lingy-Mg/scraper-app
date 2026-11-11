param(
  [switch]$NoBuild,
  [string]$Name
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'src-tauri\target\release\app.exe'

# Avoid non-ASCII literals so Windows PowerShell 5.1 (ANSI) reads this file correctly.
if (-not $Name) {
  $Name = (-join ([char[]](0x522E, 0x524A, 0x5668))) + '.exe'
}

if (-not $NoBuild) {
  Push-Location $root
  # Keep build temp files inside the project; some sandboxed shells block
  # deleting esbuild temp files under the user Temp directory.
  $buildTemp = Join-Path $root '.build-temp'
  New-Item -ItemType Directory -Force $buildTemp | Out-Null
  $previousTemp = $env:TEMP
  $previousTmp = $env:TMP
  $env:TEMP = $buildTemp
  $env:TMP = $buildTemp
  try {
    Write-Host 'Building release executable (no installer bundles)...'
    npx tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE" }
  } finally {
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
    Remove-Item $buildTemp -Recurse -Force -ErrorAction SilentlyContinue
    Pop-Location
  }
}

if (-not (Test-Path $exe)) {
  throw "Release executable not found: $exe"
}

$desktop = [Environment]::GetFolderPath('Desktop')
$target = Join-Path $desktop $Name

# Stop a running copy so the file can be replaced.
Get-CimInstance Win32_Process |
  Where-Object { $_.ExecutablePath -eq $target } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Antivirus/Explorer may briefly lock the target after it is closed.
for ($attempt = 1; $attempt -le 6; $attempt++) {
  try {
    Copy-Item $exe $target -Force
    break
  } catch {
    if ($attempt -eq 6) { throw }
    Start-Sleep -Milliseconds 800
  }
}

$size = [math]::Round((Get-Item $target).Length / 1MB, 1)
Write-Host "Done: $target (${size} MB)"
