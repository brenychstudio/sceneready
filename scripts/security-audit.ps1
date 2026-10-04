$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

npm run audit:security
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
