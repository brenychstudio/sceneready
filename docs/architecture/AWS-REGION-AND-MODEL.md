# AWS Region and Model Pin

SceneReady competition runtime is pinned to one region and one Bedrock target.
Preflight may record the official target type Bedrock returns. It must not
replace the pinned model when that target is missing or inactive.

## Pin

| Setting            | Value                           |
| ------------------ | ------------------------------- |
| Region             | `eu-west-1`                     |
| Canonical model id | `eu.anthropic.claude-sonnet-5`  |
| Project tag        | `SceneReady`                    |
| Environments       | `DEV`, `STAGING`, `COMPETITION` |

`competitionConfig` throws `PINNED_BEDROCK_MODEL_UNAVAILABLE_OR_CHANGED` when a
caller supplies any other model id. There is no silent failover.

## How the target is resolved

Read-only preflight calls the current Bedrock control-plane APIs:

- `GetInferenceProfile` for `eu.anthropic.claude-sonnet-5`
- `GetFoundationModel` for the same identifier

The first exact match wins. An inference profile records the API `type` value,
including `SYSTEM_DEFINED` and `APPLICATION`. A foundation-model match records
`FOUNDATION_MODEL`. Any other exact official id is recorded as the type string
Bedrock returns. A nearby or newer model id is not selected.

The invoke identifier is written only when it is exactly the canonical public
id. Account-specific identifiers are omitted.

Availability requires an `ACTIVE` inference profile, or an exact foundation-model
match. An inactive profile is unavailable.

## Read-only service check

`scripts/aws-preflight.ps1` uses the `qualor-dev` profile in `eu-west-1`. It
checks STS, the pinned Bedrock target, AgentCore, Amazon Location and Routes,
ECR, DynamoDB, Cognito, Lambda, SQS, S3, EventBridge, and CloudWatch.

A regional endpoint that answers `AccessDenied` or `AccessDeniedException` is
available: the service accepted the request and denied this caller's list or
calculate action. Connection failures, unknown endpoints, and region errors are
unavailable. AgentCore unavailability stops the tranche with
`AGENTCORE_UNAVAILABLE_IN_EU_WEST_1`.

The script writes a redacted report to `artifacts/local/aws-preflight.json`.
That directory is gitignored. The report must not contain an account id, ARN,
access key, secret, session token, or private endpoint.
