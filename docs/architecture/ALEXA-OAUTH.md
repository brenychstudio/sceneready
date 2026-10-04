# Alexa OAuth

SceneReady SR-05 defines the Cognito identity boundary. It does not decide
whether Alexa+ can complete account linking directly against AgentCore.

## Clients

The identity stack keeps two clients:

- a confidential machine client with a generated secret and the
  `client_credentials` grant
- a public user client with no secret, the authorization-code grant, and PKCE
  `S256`

Both clients are limited to:

- `sceneready/service`
- `sceneready/production.read`
- `sceneready/replay.approve`
- `sceneready/live.approve`

## Token handling

OAuth access tokens are not written to the ledger, logs, traces, or browser
local storage. The metadata builder returns discovery fields only. It does not
accept or retain an access token.

## SR-06 hard probe

Alexa+ MCP account linking and AgentCore inbound OAuth may disagree about an
unauthenticated `401` and the `WWW-Authenticate` challenge. SR-06 must probe
that contract directly:

1. Send an unauthenticated Alexa+ request to the AgentCore MCP runtime.
2. Record the status and `WWW-Authenticate` header exactly.
3. Compare that response with the Alexa+ account-linking requirement.
4. Add a compatibility proxy only if that direct route fails.

The proxy, if it is ever added, may normalize transport and authentication
metadata only. It cannot add business logic, authority, state mutation, or a
second MCP implementation. This tranche does not add that proxy.
