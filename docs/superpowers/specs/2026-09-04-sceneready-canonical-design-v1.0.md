# SceneReady Canonical Design v1.0

## Status

**SCENEREADY-DESIGN-01 - Canonical Design v1.0 / Competition Architecture Freeze**

Date: 4 September 2026  
Primary track: Alexa+  
Mini challenges: AWS Builder + Open Source  
Owner: Brenych Studio

## Product thesis

SceneReady is an Alexa+ production-readiness agent for professional photo/video teams. A deterministic Production Readiness Graph turns fragmented evidence into readiness, causal risk intelligence and shadow-simulated recovery. Bedrock explains and composes bounded interventions; only an authorized Production Lead can approve exact mutations.

## Canonical architecture

`Evidence -> Typed Production Graph -> Hard Gates / Domain Health -> Causal Risk -> Readiness + Confidence -> Shadow Simulation -> Proposal -> Explicit Human Approval -> Atomic Execution -> Evidence Receipt`

## Competition

Deadline: 23 Oct 2026 12:00 PM PDT. Alexa+ accepts self-hosted MCP 2025-11-25+ over Streamable HTTP or a rules-permitted simulated Alexa+ path. Public OSS repo + <3 min English video required.

## Decision register

1. **Primary persona** - Producer-photographer / production lead of a small professional creative studio.
2. **Canonical production** - Fashion/editorial campaign in Barcelona: exterior -> transfer -> studio.
3. **Authority loop** - Analyze -> Prepare Proposal -> Human Approval -> Execute -> Evidence.
4. **Hybrid evidence** - Controlled production dataset + real external signals + deterministic fallback.
5. **Bounded real execution** - Approved changes mutate SceneReady state and trigger AWS-native sandbox side effects with receipts.
6. **Deterministic truth + AI reasoning** - Readiness/dependency truth is deterministic; Bedrock interprets, proposes and converses.
7. **Readiness model** - Hard Gates + Dependency Risk Score + causal impact graph.
8. **Typed Production Readiness Graph** - Typed nodes/edges with deterministic risk propagation are the core operational model.
9. **Six production domains** - People; Location; Time & Environment; Equipment; Documents & Rights; Logistics.
10. **Evidence Trust State** - LIVE / CONFIRMED / RECORDED / FALLBACK / STALE / MISSING.
11. **Shadow Graph Simulation** - Material proposals are simulated on a shadow graph before approval.
12. **MVP scope** - Preflight + Contingency.
13. **Bound Approval Token** - Approval cryptographically/deterministically binds exact proposal fingerprint and graph revision.
14. **Atomic execution** - Atomic Production Revision + durable idempotent Outbox + truthful partial-completion evidence.
15. **AI orchestration** - Strands Agent + Bedrock reasoning + bounded deterministic SceneReady tools; no multi-agent MVP.
16. **Integration architecture** - Provider-neutral Core + standards-based MCP Gateway + Alexa+ adapter + bounded Judge Console.
17. **Dual surface UX** - Voice for intent/explanation/approval; visual surface for evidence/consequences/simulations/receipts.
18. **Risk Watch** - Event-driven Risk Watch + persisted risk deltas + Alexa surfacing on next interaction.
19. **Live signals** - Weather + Solar/Daylight + Travel.
20. **Signal sources** - Weather Provider Adapter + deterministic Solar Engine + Amazon Location Routes V2.
21. **MCP tool surface** - Task-oriented read/analyze/simulate/propose/evidence tools; approval and execution absent from agent surface.
22. **Authenticated authority** - OAuth-linked identity + production role + Authenticated Authority Session; only PRODUCTION_LEAD approves.
23. **State history** - Versioned Production State + append-only Evidence Ledger; no full event sourcing.
24. **Two metrics** - Readiness Score and Evidence Confidence Score are independent; Hard Gates override both.
25. **Recovery planning** - Bounded Intervention Primitives + Bedrock composition + deterministic feasibility/simulation.
26. **Recovery ranking** - Constraint-first Multi-objective Ranking + explicit Production Priority Profile.
27. **Demo priority profile** - Creative-first: preserve exterior intent/daylight first, then studio, delay, crew convenience, cost.
28. **Five Critical Production Gates** - Location Access; Critical Talent; Rights; Critical Capture Kit; Studio Availability.
29. **Risk severity** - LOW / MEDIUM / HIGH / CRITICAL; CRITICAL is not the same as BLOCKED.
30. **Dataset boundary** - Real Barcelona geography + fully synthetic production data.
31. **Exterior geography** - Two full exterior locations: Gothic Quarter + Eixample, then studio.
32. **Time/demo mode** - Live Operational Mode + Canonical Deterministic Replay Mode.
33. **Crew model** - Eight-person boutique production team.
34. **Timeline model** - Activity-level Production Timeline + FIXED / CRITICAL_WINDOW / TARGET / FLEXIBLE / DEPENDENT constraints.
35. **Deliverables** - Typed Campaign Deliverables with CRITICAL / HIGH / MEDIUM importance and explicit dependencies.
36. **Equipment readiness** - Critical Path + Primary/Backup Equipment + operational state + evidence trust.
37. **Documents & rights** - Scoped Rights & Access Model with validity, usage, time/location constraints and deliverable coverage.
38. **Location model** - Production Location Profile for Gothic and Eixample with visual intent/access/environment/logistics.
39. **Creative intent** - Look-level Creative Intent Envelope for key exterior looks.
40. **Canonical contingency** - Compound Production Drift: weather-window compression + travel/load-in delay.
41. **Demo vs resilience** - Winning Narrative + separate Judge Resilience Scenario.
42. **Judge Console** - Evidence-first console: Production State / Causal Graph / Shadow Simulation / Authority & Execution / Resilience Lab.
43. **Alexa visual states** - Production Pulse / Causal Impact / Risk Change / Recovery Simulation / Approval & Execution Receipt.
44. **AWS runtime** - AgentCore Runtime-first MCP + Strands/Bedrock + DynamoDB + EventBridge/Lambda + Location + SQS/Lambda + S3 + Cognito.
45. **Tiered intelligence** - Fast deterministic path + Bedrock reasoning path + bounded recovery planning; stateless MCP runtime.
46. **Evaluation** - Scenario Evaluation Matrix + System Invariants + separate deterministic-core and Bedrock-reasoning evals.
47. **Performance/degradation** - Path-specific SLOs + Progressive Response + Graceful Degradation.
48. **Public security boundary** - Public-by-design zero-secret repo + synthetic data + least-privilege IAM + reproducible IaC.
49. **Clean-room OSS** - Clean-room hackathon provenance + reusable MCP Human Authority Gate; no private BDB source copied.
50. **Hackathon provenance** - Continuous Hackathon Provenance Ledger from first commit.
51. **Replay state machine** - Canonical Replay State Machine R0 -> R1 -> R2 -> Shadow -> R3 -> R4 + deterministic reset.
52. **Scoring** - Baseline Domain Health + Deliverable-weighted causal penalties + deduplication; same live/shadow scoring.
53. **Readiness certification** - Operational BLOCKED/AT RISK/READY separated from CERTIFIED/DEGRADED/INSUFFICIENT evidence assessment.
54. **Grounded AI** - Evidence-grounded Reasoning Contract + Grounding Validator.
55. **Dual provenance** - Append-only Evidence Ledger + End-to-End OpenTelemetry Trace Spine.
56. **Trust boundaries** - Explicit Trust Zones + deterministic policy enforcement + deny-by-default MCP surface.
57. **Privacy/isolation** - Production-scoped Data Isolation + Data Minimization + Ephemeral Authority Data.
58. **Concurrency** - Revision-bound Optimistic Concurrency + Single Authoritative Mutation Lane.
59. **Recovery semantics** - Forward Recovery + Compensating Revisions + explicit reversibility semantics.
60. **Crew communications** - Impact-derived Audience + Bounded Message Draft + Exact Payload Approval.
61. **Voice approval safety** - Context-bound Explicit Approval Challenge + no inferred authority.
62. **Judge authority** - Replay-scoped Judge Authority + isolated disposable demo namespace.
63. **Demo abuse control** - Bounded Demo Budget + Abuse Guardrails + TTL cleanup.
64. **Release integrity** - Environment Separation + Immutable Competition Release + Certified Replay Binding.
65. **Multimodal parity** - Input-Parity Multimodal Contract + Accessibility by Construction.
66. **Decision escalation** - Decision Escalation + No Fake Resolution.
67. **Model strategy** - Pinned Claude Sonnet 5 + Path-specific Reasoning Mode + No Silent Model Failover.
68. **Repo/IaC** - Clean TypeScript Monorepo + Pure Domain Core + Adapter Boundaries + Stable AWS CDK IaC.
69. **Visual system** - Operational Editorial System + Evidence Hierarchy.
70. **Demo narrative** - Proof-first Three-Act Demo.
71. **Competition scoring** - Judging-Criteria Traceability + Competition Acceptance Gates + Friction Bonus Discipline.
72. **Production intake** - Validated Production Pack -> Deterministic Graph Activation.
73. **Decision policy** - Versioned Production Decision Policy + eval-driven threshold calibration.
74. **Time semantics** - Zoned Production Time Contract + deterministic Replay Clock.
75. **Outcome metrics** - Evidence-backed Operational Outcome Metrics + Optional Bounded Cost Model.
76. **Crew acknowledgements** - Impact-aware Crew Acknowledgement Semantics.
77. **Production lifecycle** - Explicit Production Phase State Machine + Phase-bound Action Validity.
78. **Evidence conflicts** - Typed Evidence Authority + Scope-aware Conflict Resolution + Conflict Quarantine.
79. **Provider evidence** - Normalized External Evidence Envelope + Content Fingerprint + Capture-to-Replay.
80. **Human corrections** - Typed Human Evidence Assertions + Controlled Operational Overrides + Versioned Priority Changes.
81. **Scope freeze** - Canonical Competition MVP + Feature Admission Gate + explicit Post-MVP Boundary.
82. **Milestone exit** - Evidence-backed Milestone Exit Gates: implementation + validation + live proof + competition evidence.
83. **Submission integrity** - Submission Truth & Rights Chain with OSS license, asset/dependency provenance and Claim-to-Evidence Matrix.

## Implementation staging

SR-00 Bootstrap -> SR-01 Production Pack -> SR-02 Graph/Readiness -> SR-03 Shadow/Recovery -> SR-04 Authority/Execution -> SR-05 AWS Runtime -> SR-06 Alexa+ -> SR-07 Judge Console -> SR-08 Evals/Replay -> SR-09 Submission Certification.

## Official sources

- Amazon Developer Hackathon - Official Rules: https://amazonappdev2026.devpost.com/rules
- Amazon Developer Hackathon - Overview: https://amazonappdev2026.devpost.com/
- Amazon Developer Hackathon - Resources: https://amazonappdev2026.devpost.com/resources
- Alexa+ MCP QuickStart: https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html
- Alexa+ MCP Authentication: https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-authentication.html
- Amazon Bedrock AgentCore - Deploy MCP servers: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html
- Amazon Bedrock AgentCore - MCP protocol contract: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp-protocol-contract.html
