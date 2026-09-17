param(
  [string]$BackendRoot = "",
  [string]$Python = "",
  [switch]$SkipZip,
  [string]$OutputZip = (Join-Path $env:USERPROFILE "Downloads\RippleAlert-Windows.zip")
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$defaultBackend = Join-Path $env:USERPROFILE "Cascade-Ripple-Alert\backend"
$backend = if ($BackendRoot) {
  (Resolve-Path $BackendRoot).Path
} elseif (Test-Path $defaultBackend) {
  (Resolve-Path $defaultBackend).Path
} else {
  throw "Backend not found. Pass -BackendRoot <backend-directory>."
}
$data = Join-Path (Split-Path -Parent $backend) "data"
$pythonExe = if ($Python) { (Resolve-Path $Python).Path } else {
  Join-Path $backend "venv\Scripts\python.exe"
}

if (!(Test-Path $pythonExe)) { throw "Python runtime not found: $pythonExe. Pass -Python to a project virtual environment." }
if (!(Test-Path (Join-Path $backend "main.py"))) { throw "Backend main.py not found: $backend" }
if (!(Test-Path (Join-Path $data "manipal_network.json"))) { throw "Manipal dataset not found: $data" }

$staging = Join-Path $repo ".release-staging"
$release = Join-Path $repo "release"
Remove-Item $staging,$release -Recurse -Force -ErrorAction SilentlyContinue
New-Item $staging,$release -ItemType Directory -Force | Out-Null

Push-Location $repo
try {
  npm.cmd run build
} finally { Pop-Location }

New-Item (Join-Path $staging "frontend") -ItemType Directory | Out-Null
Copy-Item (Join-Path $repo "dist\*") (Join-Path $staging "frontend") -Recurse
New-Item (Join-Path $staging "data") -ItemType Directory | Out-Null
Copy-Item (Join-Path $data "manipal_network.json") (Join-Path $staging "data\manipal_network.json")
Copy-Item (Join-Path $repo "packaging\launcher.py") (Join-Path $staging "launcher.py")

& $pythonExe -m pip install -r (Join-Path $backend "requirements.txt") --disable-pip-version-check --quiet
& $pythonExe -m pip install "pywebview==5.4" --disable-pip-version-check --quiet
& $pythonExe -m pip install pyinstaller --disable-pip-version-check --quiet
& $pythonExe -m PyInstaller --noconfirm --clean --onefile --windowed `
  --name RippleAlert `
  --paths $backend `
  --distpath $staging\dist `
  --workpath $staging\pyinstaller-build `
  --specpath $staging `
  $staging\launcher.py

Copy-Item (Join-Path $staging "dist\RippleAlert.exe") (Join-Path $release "RippleAlert.exe")
New-Item (Join-Path $release "assets") -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $staging "frontend") (Join-Path $release "assets\frontend") -Recurse -Force
Copy-Item (Join-Path $staging "data") (Join-Path $release "assets\data") -Recurse -Force
@"
RIPPLE ALERT

1. Extract the ZIP.
2. Double click RippleAlert.exe.
3. Wait for Ripple Alert to open.
4. Use the application.
5. Close the Ripple Alert window when finished.
"@ | Set-Content (Join-Path $release "README.txt") -Encoding ASCII

@(
  (Join-Path $release "RippleAlert.exe"),
  (Join-Path $release "assets\frontend\index.html"),
  (Join-Path $release "assets\data\manipal_network.json"),
  (Join-Path $release "README.txt")
) | ForEach-Object {
  if (!(Test-Path $_)) { throw "Release validation failed; required file is missing: $_" }
}

if (!$SkipZip) {
  $zip = [IO.Path]::GetFullPath($OutputZip)
  New-Item (Split-Path $zip) -ItemType Directory -Force | Out-Null
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  Compress-Archive -Path (Join-Path $release "*") -DestinationPath $zip -CompressionLevel Optimal
  if (!(Test-Path $zip) -or ((Get-Item $zip).Length -le 0)) {
    throw "ZIP validation failed: $zip"
  }
  Write-Output "Created $zip"
}
