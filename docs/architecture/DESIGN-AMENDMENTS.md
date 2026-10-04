# Design Amendments

These notes record implementation constraints discovered while binding the
accepted SceneReady design to current AWS APIs. They do not replace the
checksum-frozen Canonical Design v1.0, Competition Brief v1.0, or
Implementation Interpretations v1.0.

## Claude Sonnet 5 reasoning

Claude Sonnet 5 adaptive thinking remains enabled.
Reasoning paths use the lowest supported effort rather than disabling thinking.

The lowest supported effort on this model is `low`. The short reasoning path
sends adaptive thinking with `output_config.effort = low`. Recovery planning
uses the next bounded effort, `medium`. Neither path sends `thinking.type =
disabled`, and neither path may switch away from
`eu.anthropic.claude-sonnet-5`.
