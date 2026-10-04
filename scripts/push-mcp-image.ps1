param(
  [switch]$ConfirmPush,
  [string]$RepositoryUri
)

$ErrorActionPreference = 'Stop'

if (-not $ConfirmPush) {
  Write-Error 'Refusing to push the MCP image. SR-05 does not push to ECR.'
  exit 2
}

if ([string]::IsNullOrWhiteSpace($RepositoryUri)) {
  Write-Error 'RepositoryUri is required.'
  exit 2
}

$env:AWS_PROFILE = 'qualor-dev'
$env:AWS_REGION = 'eu-west-1'
$env:AWS_DEFAULT_REGION = 'eu-west-1'
$env:AWS_PAGER = ''

$registry = ($RepositoryUri -split '/')[0]
aws ecr get-login-password --profile qualor-dev --region eu-west-1 | docker login --username AWS --password-stdin $registry
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

docker tag sceneready-mcp:local "${RepositoryUri}:local"
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

docker push "${RepositoryUri}:local"
exit $LASTEXITCODE
