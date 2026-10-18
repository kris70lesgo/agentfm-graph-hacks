# Development

## Repo layout

```
warp-core/
├── warp-go/         # Core Go daemon (single warp binary)
│   ├── cmd/warp/    # Multi-mode dispatcher (boss/worker/relay/witness/api/test/genkey)
│   ├── internal/boss/  # HTTP gateway + TUI + auth + OpenAI translation
│   ├── internal/worker/    # Sandbox runner + telemetry
│   ├── internal/network/   # libp2p plumbing + protocol constants
│   ├── internal/metrics/   # Prometheus registry
│   ├── internal/obs/       # slog setup
│   └── test/integration/   # End-to-end over real libp2p TCP
├── warp-python/     # Official Python SDK (mypy --strict clean)
├── agent-example/      # Reference agents
└── docs/               # Operator + API documentation
```

## Testing

```bash
cd warp-go
make test              # Unit tests
make test-integration  # End-to-end scenarios over real libp2p
make test-race         # Everything under -race
```

Every test must:
- Pass under `-race`
- Clean up via `t.Cleanup`
- Bound network calls with `context.WithTimeout`
- Use **real** libp2p hosts (`testutil.NewHost`) — not mocknet, which silently bypasses `SetDeadline`

Python SDK:

```bash
cd warp-python
pip install -e ".[dev]"
pytest && ruff check src/ tests/ && mypy --strict src/warp/
```

## Coding standards

Authoritative reference: [`CLAUDE.md`](../CLAUDE.md) at the repo root.

Highlights:
- Every libp2p stream needs `SetDeadline` immediately after open/accept; `Reset` on error, `Close` on success.
- DHT lookups + PubSub publishes must be wrapped in `context.WithTimeout`.
- Wrap stream readers with `io.LimitReader` before any decode.
- No naked goroutines — every `go func()` must have a guaranteed exit path.
- `sync.RWMutex` for shared maps that are read-heavy.
- Wrap errors with `%w`; use `errors.Is` / `errors.As`.
- `panic()` only for unrecoverable startup errors.
- Subprocesses always use `exec.CommandContext` so a dead stream SIGKILLs the container.

## Wire-protocol invariants

The four protocol strings in `warp-go/internal/network/constants.go` (`warp-telemetry-v1`, `/warp/task/1.0.0`, `/warp/feedback/1.0.0`, `/warp/artifacts/1.0.0`) are load-bearing. Any change requires bumping the version suffix AND coordinating rebuilds across every node in the mesh. Treat as a release-gating event.

## Contributor workflow

Full contributor / branching / PR conventions: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Related

- [Architecture](architecture.md) — what the code is implementing
- [Installation](install.md) — getting the binaries
- [Observability](observability.md) — debugging a running mesh
