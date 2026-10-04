$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$context = Join-Path $repoRoot 'apps\mcp-runtime'
$image = 'sceneready-mcp:local'

docker build --platform linux/arm64 -f (Join-Path $context 'Dockerfile') -t $image $context
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$architecture = docker image inspect $image --format '{{.Architecture}}'
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Output "architecture=$architecture"
if ($architecture.Trim() -ne 'arm64') {
  exit 1
}
