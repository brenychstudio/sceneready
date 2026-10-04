$ErrorActionPreference = 'Continue'
$env:AWS_PROFILE = 'qualor-dev'
$env:AWS_REGION = 'eu-west-1'
$env:AWS_DEFAULT_REGION = 'eu-west-1'
$env:AWS_PAGER = ''

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Invoke-AwsText {
  param([scriptblock]$Action)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $raw = & $Action 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previous
  return @{ Exit = $exitCode; Text = $raw }
}

function Invoke-AwsProbe {
  param(
    [string]$Name,
    [scriptblock]$Action
  )
  $result = Invoke-AwsText $Action
  $raw = $result.Text
  $exitCode = $result.Exit
  $errorName = 'none'
  if ($exitCode -ne 0) {
    if ($raw -match 'An error occurred \(([^)]+)\)') {
      $errorName = $Matches[1]
    } elseif ($raw -match 'Could not connect|UnknownEndpoint|Could not resolve|not available in') {
      $errorName = 'EndpointUnavailable'
    } else {
      $errorName = 'UnknownAwsFailure'
    }
  }
  return "service=$Name|$exitCode|$errorName"
}

$lines = New-Object System.Collections.Generic.List[string]
$identity = Invoke-AwsText { aws sts get-caller-identity --profile qualor-dev --region eu-west-1 --output json }
if ($identity.Exit -eq 0) {
  $lines.Add('identity=resolved')
} else {
  $lines.Add('identity=unresolved')
}

$profileResult = Invoke-AwsText { aws bedrock get-inference-profile --profile qualor-dev --region eu-west-1 --inference-profile-identifier eu.anthropic.claude-sonnet-5 --query '{id:inferenceProfileId,type:type,status:status}' --output json }
if ($profileResult.Exit -eq 0 -and $profileResult.Text -match '\{[\s\S]*\}') {
  $profile = $Matches[0] | ConvertFrom-Json
  $profileId = [string]$profile.id
  $profileType = [string]$profile.type
  $profileStatus = [string]$profile.status
  if ($profileId -notmatch '^\S+$' -or $profileType -notmatch '^[A-Za-z0-9_]+$' -or $profileStatus -notmatch '^[A-Za-z0-9_]+$') {
    throw 'inference profile probe returned an unexpected shape'
  }
  $lines.Add("profile=$profileId|$profileType|$profileStatus")
} else {
  $lines.Add('profile=absent')
}

$foundationResult = Invoke-AwsText { aws bedrock get-foundation-model --profile qualor-dev --region eu-west-1 --model-identifier eu.anthropic.claude-sonnet-5 --query modelDetails.modelId --output text }
if ($foundationResult.Exit -eq 0 -and $foundationResult.Text.Trim() -eq 'eu.anthropic.claude-sonnet-5') {
  $lines.Add('foundation=eu.anthropic.claude-sonnet-5')
} else {
  $lines.Add('foundation=absent')
}

$lines.Add((Invoke-AwsProbe 'agentcore' { aws bedrock-agentcore-control list-agent-runtimes --profile qualor-dev --region eu-west-1 --max-results 1 --output json }))
$lines.Add((Invoke-AwsProbe 'location' { aws location list-maps --profile qualor-dev --region eu-west-1 --max-results 1 --output json }))
$lines.Add((Invoke-AwsProbe 'routes' { aws geo-routes calculate-routes --profile qualor-dev --region eu-west-1 --origin 2.17 41.38 --destination 2.18 41.39 --travel-mode Pedestrian --output json }))
$lines.Add((Invoke-AwsProbe 'ecr' { aws ecr describe-repositories --profile qualor-dev --region eu-west-1 --max-results 1 --output json }))
$lines.Add((Invoke-AwsProbe 'dynamodb' { aws dynamodb list-tables --profile qualor-dev --region eu-west-1 --limit 1 --output json }))
$lines.Add((Invoke-AwsProbe 'cognito' { aws cognito-idp list-user-pools --profile qualor-dev --region eu-west-1 --max-results 1 --output json }))
$lines.Add((Invoke-AwsProbe 'lambda' { aws lambda list-functions --profile qualor-dev --region eu-west-1 --max-items 1 --output json }))
$lines.Add((Invoke-AwsProbe 'sqs' { aws sqs list-queues --profile qualor-dev --region eu-west-1 --max-results 1 --output json }))
$lines.Add((Invoke-AwsProbe 's3' { aws s3api list-buckets --profile qualor-dev --region eu-west-1 --output json }))
$lines.Add((Invoke-AwsProbe 'eventbridge' { aws events list-rules --profile qualor-dev --region eu-west-1 --limit 1 --output json }))
$lines.Add((Invoke-AwsProbe 'cloudwatch' { aws cloudwatch describe-alarms --profile qualor-dev --region eu-west-1 --max-records 1 --output json }))
$lines.Add((Invoke-AwsProbe 'logs' { aws logs describe-log-groups --profile qualor-dev --region eu-west-1 --limit 1 --output json }))

$probePath = Join-Path $env:TEMP 'sceneready-aws-preflight-probes.txt'
[System.IO.File]::WriteAllLines($probePath, $lines)
npx tsx infrastructure/cdk/src/preflight.ts --write-report $probePath --report-path artifacts/local/aws-preflight.json
exit $LASTEXITCODE
