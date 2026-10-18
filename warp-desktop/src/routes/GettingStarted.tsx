import { useState } from 'react'
import { Copy, Check, Rocket, Globe, Lock, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '../components/primitives/Card'

function Cmd({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true)
        toast.success('Copied')
        setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => toast.error('Copy failed'))
  }
  return (
    <div className="relative group/cmd my-2">
      <pre className="console-well mono-console p-3 pr-10 overflow-x-auto text-xs leading-[1.55] whitespace-pre">
        {code}
      </pre>
      <button
        onClick={copy}
        title="Copy"
        className="absolute top-2.5 right-2.5 p-1.5 rounded-ctl text-text-2 hover:text-accent hover:bg-accent/10 transition-colors active:scale-[0.98]"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3.5">
      <div className="shrink-0 w-4 h-4 rounded-full bg-bg-well border border-border-0 text-text-1 font-mono text-2xs font-medium tabular-nums grid place-items-center mt-0.5">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-0 mb-1">{title}</div>
        <div className="text-sm text-text-1 leading-[1.55]">{children}</div>
      </div>
    </div>
  )
}

interface Flag {
  flag: string
  desc: string
  def?: string
}

function FlagTable({ title, flags }: { title?: string; flags: Flag[] }) {
  return (
    <div className="mb-4 last:mb-0">
      {title && (
        <div className="text-2xs font-medium text-text-2 mb-1.5">
          {title}
        </div>
      )}
      <div className="border border-border-0 overflow-hidden">
        <table className="w-full text-xs font-mono">
          <tbody>
            {flags.map((f) => (
              <tr key={f.flag} className="border-b border-border-0 last:border-b-0">
                <td className="align-top py-1 px-3 font-mono text-accent whitespace-nowrap">{f.flag}</td>
                <td className="align-top py-1 px-3 font-sans text-text-1 leading-[1.5]">{f.desc}</td>
                <td className="align-top py-1 px-3 font-mono text-text-2 tabular-nums whitespace-nowrap text-right">
                  {f.def ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface Mode {
  key: string
  purpose: string
  example: string
  flags?: Flag[]
}

const MODES: Mode[] = [
  {
    key: 'worker',
    purpose: 'Runs your agent in a Podman sandbox and advertises it on the mesh.',
    example: `warp -mode worker \\
  -agentdir ./my-agent -image my-agent:v1 \\
  -agent "My Agent" -desc "Summarizes docs with citations." \\
  -capability "research" -model llama3.2 \\
  -maxtasks 4 -maxcpu 80 -maxgpu 70`,
    flags: [
      { flag: '-agent', desc: 'Display name (seeds the stable identity key).', def: 'required' },
      { flag: '-image', desc: 'Podman/Docker image to run for each task.', def: 'required' },
      { flag: '-agentdir', desc: 'Directory with the agent code / Containerfile.', def: 'required' },
      { flag: '-desc', desc: 'One-line description shown on the Radar card.', def: '""' },
      { flag: '-model', desc: 'Engine the agent runs (e.g. llama3.2).', def: '""' },
      { flag: '-capability', desc: 'Kebab-case tag (research, code-review).', def: 'kebab(-agent)' },
      { flag: '-author', desc: 'Who published the agent.', def: 'Anonymous' },
      { flag: '-maxtasks', desc: 'Max concurrent tasks before it reports full.', def: '1' },
      { flag: '-maxcpu / -maxgpu', desc: 'Reject new tasks above this CPU / GPU-VRAM %.', def: '80 / 80' },
    ],
  },
  {
    key: 'api',
    purpose: 'Headless HTTP + OpenAI-compatible gateway. This is what the desktop app runs under the hood.',
    example: `warp -mode api -apiport 8080 -reputation-floor -0.3`,
    flags: [
      { flag: '-apiport', desc: 'Gateway port.', def: '8080' },
      { flag: '-api-bind', desc: 'Bind host; 0.0.0.0 exposes off-host (needs a key).', def: '127.0.0.1' },
      { flag: '-ledger-path', desc: 'Override the trust-ledger SQLite path.', def: '~/.warp/api_ledger.db' },
      { flag: '-reputation-floor', desc: 'Refuse dispatch below this honesty score.', def: '-0.5' },
    ],
  },
  {
    key: 'boss',
    purpose: 'Interactive terminal (pterm) dispatcher, the CLI alternative to this desktop app.',
    example: `warp -mode boss`,
    flags: [
      { flag: '-reputation-floor', desc: 'Refuse dispatch below this honesty score.', def: '-0.5' },
      { flag: '-ledger-path', desc: 'Override the trust-ledger SQLite path.', def: '~/.warp/boss_ledger.db' },
    ],
  },
  {
    key: 'relay',
    purpose: 'Permanent lighthouse: Circuit Relay v2 (infinite limits) + DHT server + telemetry routing + archive ledger.',
    example: `warp -mode relay -port 4001 -swarmkey ./swarm.key`,
    flags: [
      { flag: '-port', desc: 'Listen port (use 4001 for a stable lighthouse).', def: '0' },
      { flag: '-identity', desc: 'Persistent key; keeps the multiaddr stable across restarts.', def: '~/.warp/relay_identity.key' },
    ],
  },
  {
    key: 'genkey',
    purpose: 'Generate a private-swarm key (a shared secret you distribute out-of-band).',
    example: `warp -mode genkey        # writes ./swarm.key`,
  },
]

const COMMON_FLAGS: Flag[] = [
  { flag: '-swarmkey', desc: 'Join a private, isolated swarm (PSK).', def: '""' },
  { flag: '-bootstrap', desc: 'Relay multiaddr to dial (required for a private swarm).', def: '""' },
  { flag: '-prom-listen', desc: 'Prometheus /metrics address (empty disables).', def: 'per-mode' },
  { flag: '-log-format / -log-level', desc: 'json | console | auto  /  debug | info | warn | error.', def: 'auto / info' },
]

function ModeBlock({ mode }: { mode: Mode }) {
  return (
    <div className="mb-5 last:mb-0">
      <code className="text-xs font-mono font-semibold text-accent">warp -mode {mode.key}</code>
      <p className="text-xs text-text-2 mt-1 mb-1 leading-[1.5]">{mode.purpose}</p>
      <Cmd code={mode.example} />
      {mode.flags && mode.flags.length > 0 && <FlagTable flags={mode.flags} />}
    </div>
  )
}

export default function GettingStarted() {
  return (
    <div className="p-4 max-w-4xl">
      <h1 className="text-lg font-semibold text-text-0">Run your agents</h1>
      <p className="text-sm text-text-1 mt-1.5 mb-4 leading-[1.55]">
        This app is your <b>Boss</b>, it discovers agents, dispatches tasks, and collects results.
        To put an agent <i>on</i> the mesh you run a <b>worker</b> from the terminal. It advertises
        itself, and it shows up here on the Radar within seconds.
      </p>

      <Card className="glass p-3 mb-4">
        <div className="flex items-center gap-2 mb-2.5">
          <Rocket size={16} strokeWidth={1.5} className="text-accent" />
          <h2 className="text-sm font-semibold text-text-0">Prerequisites</h2>
        </div>
        <div className="space-y-3">
          <Step n={1} title="Podman, agents run in sandboxed containers">
            <Cmd code={`# macOS\nbrew install podman && podman machine init && podman machine start`} />
          </Step>
          <Step n={2} title="Ollama + a local model (for LLM agents)">
            <Cmd code={`curl -fsSL https://ollama.com/install.sh | sh && ollama run llama3.2`} />
          </Step>
          <Step n={3} title="Build the Warp CLI from source">
            From the repository root, install Go 1.25 or later and run:
            <Cmd code={`cd warp-go && go install ./cmd/warp`} />
          </Step>
        </div>
      </Card>

      <Card className="glass p-3 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Globe size={16} strokeWidth={1.5} className="text-accent" />
          <h2 className="text-sm font-semibold text-text-0">Join a mesh</h2>
        </div>
        <p className="text-sm text-text-2 mb-3">
          Warp does not provide a public mesh or relay. Connect to a relay you operate or trust;
          same-LAN peers can discover each other without a relay.
        </p>
        <div className="space-y-3">
          <Step n={1} title="Run a worker">
            The first four flags are required; the rest describe the agent and cap its load.
            <Cmd
              code={`warp -mode worker \\
  -agentdir ./my-agent \\
  -image localhost/my-agent:latest \\
  -agent "My Agent" \\
  -model llama3.2 \\
  -desc "Summarizes documents with source citations." \\
  -capability "research" \\
  -author "you" \\
  -maxtasks 4 -maxcpu 80 -maxgpu 70`}
            />
          </Step>
          <Step n={2} title="Find it in the app">
            Switch the project dropdown (top-left) to <b>Open mesh</b>. Workers on the same LAN or
            connected to the same configured relay appear on the <b>Radar</b>.
          </Step>
        </div>
      </Card>

      <Card className="glass p-3 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Lock size={16} strokeWidth={1.5} className="text-accent" />
          <h2 className="text-sm font-semibold text-text-0">Private agent</h2>
        </div>
        <p className="text-sm text-text-2 mb-3">
          A fully isolated swarm, only nodes holding your key can see or dispatch to each other.
          Invisible to the public network. Any mode joins a swarm by adding{' '}
          <code>-swarmkey</code> + <code>-bootstrap</code>.
        </p>
        <div className="space-y-3.5">
          <Step n={1} title="Generate a shared swarm key">
            <Cmd code={`warp -mode genkey        # writes ./swarm.key`} />
          </Step>
          <Step n={2} title="Run a relay for your swarm">
            Locally or on a VPS. Copy the multiaddr it prints.
            <Cmd
              code={`warp -mode relay -port 4001 -swarmkey ./swarm.key
#  -> /ip4/<host>/tcp/4001/p2p/<relay-id>`}
            />
          </Step>
          <Step n={3} title="Run the worker on the swarm">
            Same worker flags as the public example, plus the swarm key and the relay’s multiaddr.
            <Cmd
              code={`warp -mode worker \\
  -agentdir ./my-agent -image localhost/my-agent:latest \\
  -agent "My Agent" -model llama3.2 \\
  -desc "Summarizes documents with source citations." \\
  -capability "research" -author "you" \\
  -maxtasks 4 -maxcpu 80 -maxgpu 70 \\
  -swarmkey ./swarm.key \\
  -bootstrap /ip4/<host>/tcp/4001/p2p/<relay-id>`}
            />
          </Step>
          <Step n={4} title="Add the project in the app">
            Open the project dropdown → <b>New project</b> → <b>Private</b>. Paste the{' '}
            <b>relay multiaddr</b> and the <b>swarm key</b> (the hex line inside{' '}
            <code>swarm.key</code>), then switch to it. Your private worker appears on the Radar.
          </Step>
        </div>
      </Card>

      <Card className="glass p-3 mb-4">
        <div className="flex items-center gap-2 mb-2.5">
          <Terminal size={16} strokeWidth={1.5} className="text-accent" />
          <h2 className="text-sm font-semibold text-text-0">Modes &amp; parameters</h2>
        </div>
        <p className="text-sm text-text-2 mb-3">
          One binary; <code className="text-text-1">-mode</code> picks the role, and each role has
          its own flags. Run <code>warp --help</code> for the exhaustive list.
        </p>
        {MODES.map((m) => (
          <ModeBlock key={m.key} mode={m} />
        ))}
        <div className="mt-4 pt-3 border-t border-border-0">
          <FlagTable title="Common to all P2P modes" flags={COMMON_FLAGS} />
        </div>
      </Card>
    </div>
  )
}
