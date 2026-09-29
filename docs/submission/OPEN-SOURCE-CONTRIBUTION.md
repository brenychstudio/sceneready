# Open-Source Contribution

SceneReady is the primary clean-room open-source hackathon project.

`packages/mcp-human-authority/` is a standalone reusable MCP human-authority package. It implements deterministic canonicalization and a SHA-256 fingerprint of the exact execution-significant proposal. It can create an approval challenge. `LIVE` and `REPLAY` are distinct authority namespaces, and creating a challenge is not approval.

`BoundApprovalClaims` is the single-use claims contract. `ApprovalSigner` is a port only. The package does not confirm approval, mutate production, or depend on AWS, Alexa, Strands, or React. Authenticated approval, token issuance, execution, and communications remain outside this package.
