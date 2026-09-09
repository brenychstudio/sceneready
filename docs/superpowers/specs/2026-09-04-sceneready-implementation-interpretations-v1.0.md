# SceneReady Implementation Interpretations v1.0

This document records implementation-level clarifications discovered while converting the approved SceneReady Canonical Design v1.0 into executable plans. It does not change the product thesis, authority model, scope, competition tracks, or canonical R0→R4 behavior.

## 1. Claude Sonnet 5 reasoning control

The approved design described a low-latency reasoning path and a deeper recovery-planning path. Current Amazon Bedrock documentation states that Claude Sonnet 5 uses adaptive thinking and does not expose a true “thinking disabled” mode.

Implementation decision:

- Fast Operational Path makes no model call.
- Short Reasoning Path uses the lowest supported Sonnet 5 effort and a small bounded context.
- Recovery Planning Path uses a higher bounded effort.
- Competition runtime remains pinned to `eu.anthropic.claude-sonnet-5`.
- There is no silent model failover.

This preserves the approved intent while matching the supported API.

## 2. Alexa OAuth compatibility probe

Alexa+ MCP account linking and AgentCore inbound OAuth have a potential response-contract mismatch around unauthenticated `401` responses and `WWW-Authenticate`.

Implementation decision:

1. Test direct Alexa+ → AgentCore Runtime first.
2. Record the exact compatibility verdict.
3. Add a minimal compatibility proxy only if the direct route demonstrably fails.
4. The proxy may normalize transport/auth metadata only; it cannot add business logic, authority, state mutation, or a second MCP implementation.

## 3. Shared presentation package

`packages/presentation` is added to the monorepo map so Alexa visual states and Judge Console share semantic view models and design tokens without sharing React components.

## 4. Nested Alexa visual workspace

`apps/mcp-runtime/ui` is an explicit npm workspace because Alexa MCP Apps require a separately built, hashed, self-contained `ui://` resource. The MCP runtime embeds the produced artifact by fingerprint.

## 5. Human confirmation route

The Strands/Bedrock agent tool registry contains no approval or mutation tool. The Alexa-facing registry may expose one bounded `confirm_active_proposal` route because human voice/touch approval must reach the Authority Service.

The route:

- accepts no arbitrary production mutation;
- resolves exactly one active server-side approval challenge;
- verifies authenticated `PRODUCTION_LEAD` authority;
- binds exact proposal fingerprint and graph revision;
- cannot be invoked as a Strands agent tool.
