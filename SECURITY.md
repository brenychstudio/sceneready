# Security Policy

SceneReady must contain no secrets or active credentials in the repository.

Report suspected vulnerabilities privately through the private security-reporting channel provided by the project's hosting platform or maintainers. Do not disclose vulnerability details publicly before maintainers have had a reasonable opportunity to investigate and respond.

Never publish active credentials, access tokens, passwords, API keys, or other secrets in issues, discussions, pull requests, logs, or fixtures. Revoke and rotate any credential that may have been exposed.

Public fixtures must not contain real production personal data, customer data, or client data. Use purpose-built fictional data only when fixtures are added in a future task.

Security-sensitive design and implementation should follow least-privilege principles and fail closed when authorization, validation, or policy checks cannot be completed safely.
