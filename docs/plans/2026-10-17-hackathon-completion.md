# Warp Graph Hacks Completion Plan

**Goal:** Deliver a reproducible local demonstration of graph-based worker selection and persistent memory shared by independent Boss nodes.

**Architecture:** FalkorDB holds mesh-scoped workers, capabilities, trust edges, execution reservations, and task outcomes. The existing libp2p transport and trust gate execute real container tasks. Docker and Podman are supported so the demo works on a fresh machine with either runtime.

**Tech Stack:** Go, libp2p, FalkorDB, Docker/Podman, React, Electron, Python demo agents.

## Completion criteria

- [x] Real FalkorDB integration checks cover worker updates, route learning, persistence, isolation, and concurrent reservations.
- [x] A private local mesh starts with one command and executes actual agent containers without paid APIs.
- [x] Two gateway instances share outcomes and coordinate worker capacity through FalkorDB.
- [x] The desktop graph view shows worker relationships, routing factors, shared memory, and active reservations.
- [x] Focused Go tests, desktop type checks, builds, and a live API scenario pass.
- [x] The repository contains a submission description, architecture explanation, demo walkthrough, and recorded local demo.

## Implementation sequence

1. Exercise `warp-go/internal/falkor/store.go` against the running database; fix Cypher, scoping, and response issues discovered by runtime checks.
2. Add graph reservations and release them when OpenAI-compatible tasks finish or fail. Include lease expiry for interrupted Boss nodes.
3. Support an explicit container runtime in the worker and add small deterministic demo agents. Add a private-mesh launcher with readiness checks, logs, and cleanup.
4. Finish Graph Context interaction and coordination visibility. Correct desktop build/type-check or API catalog issues encountered.
5. Run the live demonstration, record evidence, and finish `docs/falkordb-hackathon.md` and submission materials.

## Verification

- `FALKORDB_TEST_ADDR=127.0.0.1:6380 go test -race ./internal/falkor ./internal/boss ./internal/worker ./cmd/warp`
- `npm run typecheck`, `npm test`, and `npm run build` in `warp-desktop`.
- Start the isolated demo mesh; dispatch real tasks through both gateways; inspect shared memory, ranking changes, active reservations, and persistence after gateway restart.

## Scope

The local demo uses deterministic container agents and needs no API key. Existing user-provided agent images continue to supply real LLM inference. Registration, account identity, and final submission remain actions for the entrant.
