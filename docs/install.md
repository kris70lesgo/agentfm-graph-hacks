# Install Warp from source

Warp does not publish release binaries or a hosted installer yet. Build the CLI with Go 1.25 or later:

```bash
git clone https://github.com/kris70lesgo/warpg.git
cd warpg/warp-go
go install ./cmd/warp
```

The `warp` executable is placed in `$(go env GOPATH)/bin`. Make sure that directory is on your `PATH`. To build a binary in the repository instead:

```bash
go build -o build/warp ./cmd/warp
./build/warp --help
```

The CLI includes the worker, Boss, HTTP API, relay, witness, and key-generation modes. Worker mode requires Podman by default. Docker can be selected with `-runtime docker`.

For the full local FalkorDB demo, use the root [demo setup guide](falkordb-hackathon.md), which starts the database, private relay, two workers, two Boss gateways, and browser console.
