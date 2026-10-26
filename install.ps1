$ErrorActionPreference = 'Stop'
$pluginRoot = $PSScriptRoot
if (Test-Path -LiteralPath (Join-Path $pluginRoot 'node_modules/qrcode/package.json')) {
  Write-Host 'Runtime dependencies are included. Import this folder in DSH plugin settings:'
  Write-Host $pluginRoot
  exit 0
}
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($nodeCommand -and $npmCommand) {
  Push-Location -LiteralPath $pluginRoot
  try { & $npmCommand.Source ci --omit=dev --ignore-scripts --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Dependency preparation failed' } }
  finally { Pop-Location }
} else {
  $bootstrap = Join-Path $env:LOCALAPPDATA 'dsh-qq-whale/bootstrap'
  New-Item -ItemType Directory -Path $bootstrap -Force | Out-Null
  $releases = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
  $release = $releases | Where-Object { $_.lts -and $_.version -match '^v22\.' } | Select-Object -First 1
  if (!$release) { throw 'Unable to find official Node.js LTS' }
  $name = 'node-' + $release.version + '-win-x64'
  $archive = Join-Path $bootstrap ($name + '.zip')
  $base = 'https://nodejs.org/dist/' + $release.version + '/'
  Invoke-WebRequest ($base + $name + '.zip') -OutFile $archive -UseBasicParsing
  $checksums = (Invoke-WebRequest ($base + 'SHASUMS256.txt') -UseBasicParsing).Content
  $line = $checksums -split "`n" | Where-Object { $_.Trim().EndsWith($name + '.zip') } | Select-Object -First 1
  $expected = ($line -split '\s+')[0]
  if (!$expected -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower() -ne $expected.ToLower()) { throw 'Official Node.js checksum mismatch' }
  Expand-Archive -LiteralPath $archive -DestinationPath $bootstrap -Force
  $nodeDir = Join-Path $bootstrap $name
  Push-Location -LiteralPath $pluginRoot
  $previousPath = $env:PATH
  try {
    $env:PATH = $nodeDir + ';' + $env:PATH
    & (Join-Path $nodeDir 'node.exe') (Join-Path $nodeDir 'node_modules/npm/bin/npm-cli.js') ci --omit=dev --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency preparation failed' }
  } finally { $env:PATH = $previousPath; Pop-Location }
}
Write-Host 'Ready. Import this folder in DSH plugin settings, then open Tool Setup:'
Write-Host $pluginRoot
