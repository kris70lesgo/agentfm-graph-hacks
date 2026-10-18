# Warp Desktop

Cross-platform Electron app for the [Warp](https://github.com/kris70lesgo/warpg) P2P agent mesh.
Browse agents, dispatch tasks, leave signed feedback, manage your reputation gate
— all in a sleek dark dev-tool aesthetic UI. Bundled backend; no terminal needed.

## FalkorDB Graph Context demo

From the repository root, run `python3 scripts/demo.py up` and open `http://127.0.0.1:5173/demo.html?apiPort=8080`. The browser console shares the Graph Context component with Electron and runs against the real private mesh. See [the setup guide](../docs/falkordb-hackathon.md).

## Screens

Core mesh and graph tools:

- **Radar** — online + offline agents with honesty, image digest, dispatch state
- **Dispatch (drawer)** — prompt → streaming output → artifact download
- **Chat** — multi-turn OpenAI-compatible conversation with auto-routing or pinned peer
- **Graph Context** — FalkorDB routing explanations, persistent task memory, task dispatch, and shared capacity reservations
- **Peer view** — full ledger history (ratings + comments) per peer
- **Activity** — every entry you've signed and broadcast
- **Status** — six dashboard cards covering backend / identity / ledger / relay / workers / trust gate
- **Settings** — relay multiaddr, reputation floor, theme, accent color, telemetry opt-in
- **Feedback modal** — signed comment + rating after a task

## Install

### From source (development)

```bash
git clone https://github.com/kris70lesgo/warpg.git
cd warpg/warp-desktop
npm install
./scripts/dev.sh
```

This auto-builds the local `warp` Go binary (if missing) and launches Electron + Vite.

### Cross-platform binaries

```bash
./scripts/build-binaries.sh    # cross-compiles darwin/arm64, darwin/amd64, linux/amd64, windows/amd64
npm run package                # produces dist/Warp-*.dmg / .AppImage / .exe
```

## First run

The app spawns a bundled `warp -mode api` on launch. On first run the backend
generates a fresh libp2p identity. Warp does not operate a public relay; provide
your own relay multiaddress in **Settings → Mesh** to connect agents across
networks. Same-LAN peers can use local discovery.

No public installer is published yet. Build the app from source using the
commands above.

## Architecture

- **Main process** (Node.js): spawns and supervises the bundled `warp` Go binary
  on `127.0.0.1:8080`. Auto-restart up to 3× in 60s before showing a backend-down overlay.
- **Renderer** (React + TanStack Query): pure HTTP/SSE client to the backend.
- **State**: TanStack Query for server state, Zustand for UI state, electron-store for
  persistence (theme, accent, relay multiaddr, reputation floor, chat sessions).
- **Streaming**: SSE for `/v1/chat/completions` and `/v1/events`; fetch + ReadableStream
  for `/api/execute` raw text streams.

## Backend additions (v1.3.1 → v1.3.2-rc)

Three new HTTP endpoints land in `warp-core` to support this UI:

- `GET /v1/about` — backend identity + uptime + ledger size
- `GET /v1/events` — SSE event stream (worker online/offline, entry appended)
- `GET /v1/peers/{id}/comments/{cid}.json` — JSON-wrapped comment body

## Keyboard shortcuts

| Key | Action |
|---|---|
| `⌘1` | Jump to Radar |
| `⌘2` | Jump to Chat |
| `⌘3` | Jump to Activity |
| `⌘4` | Jump to Status |
| `⌘5` | Jump to Settings |
| `⌘K` | Focus Radar search |
| `⌘↵` | Submit (dispatch / feedback) |
| `Esc` | Close drawers/modals |

## Known limitations (v1)

- macOS builds are unsigned and not notarized → "right-click → Open" workaround.
- Activity screen uses N+1 fan-out (one log query per known peer); fine up to ~30 peers.
- Standalone signed comments (`POST /v1/peers/{id}/comments` with client-side Ed25519) are
  scaffolded but not wired — the Feedback modal currently posts via `/api/execute` only.

## Tech stack

Electron 30 · React 18 · TypeScript 5 · Vite 5 · TailwindCSS 3 · Framer Motion 11 ·
TanStack Query 5 · Zustand 4 · react-hook-form + zod · sonner · vitest · Playwright.

## License

MIT
