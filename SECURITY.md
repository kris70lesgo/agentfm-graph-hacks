# Security Policy

Warp is a hackathon-stage project. The repository does not currently publish versioned releases or promise a support window.

## Reporting a vulnerability

Please do not disclose exploitable details in a public issue. Use the repository's **Security → Advisories → Report a vulnerability** flow on [GitHub](https://github.com/kris70lesgo/warpg/security/advisories/new) when private vulnerability reporting is available. If GitHub does not offer that flow, contact the repository owner through GitHub before sharing sensitive details.

Include the affected component, impact, reproduction steps, and relevant environment details. Do not include real customer prompts, credentials, private keys, or production data.

## Scope

The most security-sensitive areas are the HTTP gateway, container worker runtime, peer identity and signatures, relay/network discovery, and task artifact handling. The local demo uses deterministic agents and is intended for loopback development; review and configure authentication, network exposure, and container limits before adapting it for deployment.
