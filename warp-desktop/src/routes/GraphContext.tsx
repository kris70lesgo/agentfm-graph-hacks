import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  Check,
  CircleDot,
  Clock3,
  Database,
  LockKeyhole,
  Network,
  RefreshCw,
  Route,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { api } from '../lib/api'
import { useWorkers } from '../lib/query'
import type { GraphMemoryEpisode, GraphRouteCandidate } from '../lib/api'
import { Badge } from '../components/primitives/Badge'
import { Button } from '../components/primitives/Button'
import { Card } from '../components/primitives/Card'
import { Input } from '../components/primitives/Input'
import { SectionLabel } from '../components/primitives/SectionLabel'
import { shortenPeerID } from '../lib/peer'
import GraphTopology from './GraphTopology'
import './GraphContext.css'

function scoreWidth(score: number): number {
  return Math.max(3, Math.min(100, ((score + 0.5) / 1.5) * 100))
}

function elapsedLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'time unavailable'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function expiryLabel(value: string): string {
  const remaining = Math.max(0, Math.floor((new Date(value).getTime() - Date.now()) / 1000))
  if (!Number.isFinite(remaining)) return 'expiry unavailable'
  return remaining < 60 ? `expires in ${remaining}s` : `expires in ${Math.floor(remaining / 60)}m`
}

function Metric({
  label, value, note, icon: Icon, tone = 'amber',
}: {
  label: string
  value: string
  note: string
  icon: typeof Network
  tone?: 'amber' | 'mint' | 'blue' | 'slate'
}) {
  return (
    <Card className="graph-metric p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-text-1">{label}</span>
        <span className={`graph-metric-icon graph-metric-icon--${tone}`}><Icon size={16} strokeWidth={1.7} /></span>
      </div>
      <div className="mt-3 text-[23px] font-semibold leading-none tracking-tight text-text-0">{value}</div>
      <div className="mt-2 text-xs text-text-2">{note}</div>
    </Card>
  )
}

function CandidateRow({ candidate, index }: { candidate: GraphRouteCandidate; index: number }) {
  const selected = index === 0
  return (
    <div className={`graph-candidate ${selected ? 'graph-candidate--selected' : ''}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className={`graph-candidate-rank ${selected ? 'text-accent' : 'text-text-2'}`}>{String(index + 1).padStart(2, '0')}</span>
        <span className={`graph-candidate-avatar ${selected ? 'graph-candidate-avatar--selected' : ''}`}><Network size={15} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-text-0">{candidate.name || shortenPeerID(candidate.peer_id)}</span>
            {selected && <Badge tone="accent">Best fit</Badge>}
          </div>
          <div className="mt-1 truncate text-xs text-text-2">{candidate.capability} <span className="px-1 text-text-3">·</span> {candidate.model}</div>
        </div>
        <div className="text-right">
          <div className={`font-mono text-base font-semibold tabular-nums ${selected ? 'text-accent' : 'text-text-1'}`}>{candidate.score.toFixed(3)}</div>
          <div className="text-[10px] uppercase tracking-[0.09em] text-text-2">score</div>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/35">
        <div className={`h-full rounded-full transition-[width] duration-300 ${selected ? 'bg-accent' : 'bg-white/30'}`} style={{ width: `${scoreWidth(candidate.score)}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-2">
        <span>Trust <b className="font-mono font-medium text-text-1">{candidate.trust_score.toFixed(2)}</b></span>
        <span><b className="font-mono font-medium text-text-1">{Math.round(candidate.success_rate * 100)}%</b> prior success</span>
        <span><b className="font-mono font-medium text-text-1">{Math.round(candidate.load_ratio * 100)}%</b> load</span>
        <span>{candidate.history_count} related episodes</span>
      </div>
    </div>
  )
}

function EpisodeRow({ episode }: { episode: GraphMemoryEpisode }) {
  const success = episode.outcome === 'success'
  return (
    <div className="graph-episode">
      <span className={`graph-episode-state ${success ? 'graph-episode-state--success' : 'graph-episode-state--failed'}`}>
        {success ? <Check size={13} /> : <CircleDot size={13} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text-0">{episode.task_class || episode.capability || 'Mesh task'}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-text-2">
          <span className="truncate">{episode.worker_name || shortenPeerID(episode.peer_id)}</span>
          <span aria-hidden="true">·</span>
          <span>{elapsedLabel(episode.completed_at)}</span>
        </div>
        {episode.coordinator && (
          <div className="mt-1 font-mono text-[10px] text-text-2" title={episode.coordinator}>Boss {shortenPeerID(episode.coordinator)}</div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <Badge tone={success ? 'ok' : 'warn'}>{episode.outcome}</Badge>
        <div className="mt-1.5 font-mono text-[11px] tabular-nums text-text-2">{episode.duration_ms} ms</div>
      </div>
    </div>
  )
}

export default function GraphContext() {
  const queryClient = useQueryClient()
  const workers = useWorkers()
  const owner = useQuery({ queryKey: ['graph-owner'], queryFn: api.about, staleTime: 30000 })
  const [taskClass, setTaskClass] = useState('')
  const [prompt, setPrompt] = useState('Plan a release with graph routing, shared memory, and a working demo.')

  const graph = useQuery({ queryKey: ['graph-status'], queryFn: api.graphStatus, refetchInterval: 5000 })
  const connected = graph.data?.connected === true
  const memory = useQuery({
    queryKey: ['graph-memory'], queryFn: () => api.graphMemory(30), enabled: connected, refetchInterval: 5000,
  })
  const route = useQuery({
    queryKey: ['graph-route', taskClass],
    queryFn: () => api.graphRoute(taskClass),
    enabled: connected && taskClass.trim().length > 0,
    refetchInterval: 5000,
    retry: false,
  })
  const reservations = useQuery({
    queryKey: ['graph-reservations'], queryFn: api.graphReservations, enabled: connected, refetchInterval: 1000,
  })
  const dispatch = useMutation({
    mutationFn: () => api.graphDispatch(taskClass.trim(), prompt),
    onSettled: () => {
      for (const queryKey of [['graph-memory'], ['graph-status'], ['graph-route'], ['graph-reservations']]) {
        void queryClient.invalidateQueries({ queryKey })
      }
    },
  })

  useEffect(() => {
    if (taskClass) return
    const first = workers.data?.agents?.find((agent) => agent.online)
    if (first) setTaskClass(first.agent_capability || first.name || first.peer_id)
  }, [workers.data, taskClass])

  const summary = graph.data?.summary
  const episodes = memory.data?.episodes ?? []
  const activeReservations = reservations.data?.reservations ?? []
  const onlineCount = summary?.online_workers ?? workers.data?.online_count ?? 0
  const totalCount = summary?.workers ?? workers.data?.agents.length ?? 0

  const refresh = () => {
    void graph.refetch()
    if (connected) {
      void workers.refetch()
      void memory.refetch()
      void reservations.refetch()
      if (taskClass.trim()) void route.refetch()
    }
  }

  return (
    <main className="graph-page mx-auto max-w-[1440px] px-4 pb-8 pt-6 sm:px-6 lg:px-8">
      <div className="graph-hero flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div className="max-w-3xl">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-2">
            <span className="graph-hero-mark"><Network size={14} /></span>
            <span>Agent coordination layer</span>
          </div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-text-0 sm:text-[34px]">
            Graph <span className="text-accent">Context</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-1 sm:text-[15px]">
            See how the mesh connects, why a worker gets picked, and what other Boss nodes remember.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="h-9 gap-2 px-3 text-xs" onClick={refresh} aria-label="Refresh graph context">
            <RefreshCw size={14} className={graph.isFetching ? 'animate-spin' : ''} /> Refresh
          </Button>
          {connected && (
            <a className="graph-link-button" href="http://127.0.0.1:3001" target="_blank" rel="noreferrer">
              FalkorDB Browser <ArrowUpRight size={14} />
            </a>
          )}
        </div>
      </div>

      <Card className={`graph-connection mt-6 p-4 ${connected ? 'graph-connection--online' : 'graph-connection--offline'}`}>
        <span className="graph-connection-icon"><Database size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-text-0">
              {graph.isLoading ? 'Connecting to FalkorDB' : connected ? 'FalkorDB is connected' : 'FalkorDB is offline'}
            </span>
            <Badge tone={connected ? 'ok' : 'warn'} mono>{connected ? 'LIVE GRAPH' : 'OFFLINE'}</Badge>
          </div>
          <div className="mt-1 truncate font-mono text-xs text-text-2">
            {summary ? `${summary.graph}  /  mesh ${summary.mesh_id}` : 'Set FALKORDB_ADDR and start the graph service'}
          </div>
        </div>
        <div className="hidden items-center gap-2 border-l border-border-1 pl-4 text-xs text-text-2 sm:flex">
          <LockKeyhole size={14} className="text-ok" /> Task content stays private
        </div>
      </Card>
      {graph.error && !connected && (
        <p className="mt-2 px-1 text-xs text-text-2" role="status">The graph will reconnect automatically when FalkorDB is reachable.</p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Online workers" value={`${onlineCount} / ${totalCount}`} note="Available in this mesh" icon={Users} tone="mint" />
        <Metric label="Shared memory" value={`${summary?.task_episodes ?? episodes.length}`} note="Task outcomes across sessions" icon={BrainCircuit} tone="blue" />
        <Metric label="Active reservations" value={String(summary?.active_reservations ?? activeReservations.length)} note="Capacity claimed by Boss nodes" icon={Activity} tone="amber" />
        <Metric label="Stored task data" value="Digest only" note="Prompts and outputs stay out of FalkorDB" icon={ShieldCheck} tone="slate" />
      </div>

      <section className="mt-8" aria-labelledby="topology-title">
        <div className="graph-section-heading mb-3">
          <div>
            <div className="flex items-center gap-2"><Network size={16} className="text-accent" /><SectionLabel as="h2">Live mesh topology</SectionLabel></div>
            <p id="topology-title" className="mt-1 text-xs text-text-2">Real relationships from the shared FalkorDB graph.</p>
          </div>
          <span className="graph-section-kicker">CONNECTED DATA · TRACK 01</span>
        </div>
        <Card className="graph-topology-card p-0">
          <div className="graph-topology-meta">
            <div className="flex items-center gap-2"><span className="graph-live-pulse" /><span>{connected ? 'Live topology' : 'Waiting for graph'}</span></div>
            <span className="font-mono">{summary?.graph || 'FalkorDB'} <span className="px-1 text-text-3">/</span> {summary?.mesh_id || 'shared mesh'}</span>
          </div>
          <GraphTopology
            meshId={summary?.mesh_id ?? 'Agent mesh'}
            owner={owner.data}
            workers={workers.data}
            route={route.data}
            episodes={episodes}
            reservations={activeReservations}
            connected={connected}
          />
        </Card>
      </section>

      <div className="mt-8 grid gap-5 xl:grid-cols-[1.02fr_0.98fr]">
        <section aria-labelledby="route-title">
          <div className="graph-section-heading mb-3">
            <div>
              <div className="flex items-center gap-2"><Route size={16} className="text-accent" /><SectionLabel as="h2">Graph-ranked route</SectionLabel></div>
              <p id="route-title" className="mt-1 text-xs text-text-2">A route score combines trust, past success, and current capacity.</p>
            </div>
            <span className="graph-section-kicker">ROUTING · TRACK 01</span>
          </div>
          <Card className="graph-panel p-4 sm:p-5">
            <form onSubmit={(event) => { event.preventDefault(); void route.refetch() }}>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="sr-only" htmlFor="graph-task-class">Worker model or capability</label>
                <Input
                  id="graph-task-class"
                  className="h-10 px-3 text-sm"
                  value={taskClass}
                  onChange={(event) => setTaskClass(event.target.value)}
                  placeholder="Enter a model, agent, or capability"
                />
                <Button
                  type="submit"
                  variant="primary"
                  className="h-10 shrink-0 gap-2 px-4 text-sm"
                  disabled={!connected || !taskClass.trim() || route.isFetching}
                >
                  <Route size={14} /> Trace route
                </Button>
              </div>
            </form>
            <div className="mt-4 flex items-start gap-2 rounded-md bg-white/[0.035] px-3 py-2.5 text-xs leading-relaxed text-text-1">
              <Activity size={14} className="mt-0.5 shrink-0 text-accent" />
              <span>{route.data?.reason ?? 'The graph checks worker capability, trust, live load, and related task outcomes before dispatch.'}</span>
            </div>
            {route.isError && <p className="mt-3 text-xs text-warn" role="status">{route.error.message}</p>}
            {route.isLoading && <div className="graph-inline-loading mt-4"><span />Following graph relationships…</div>}
            {route.data?.candidates.length ? (
              <div className="mt-4 divide-y divide-white/[0.08]">
                {route.data.candidates.map((candidate, index) => <CandidateRow key={candidate.peer_id} candidate={candidate} index={index} />)}
              </div>
            ) : connected && !route.isLoading && !route.isError ? (
              <div className="graph-inline-empty mt-4"><Network size={17} />Trace a capability to see eligible workers.</div>
            ) : null}
          </Card>
        </section>

        <section aria-labelledby="memory-title">
          <div className="graph-section-heading mb-3">
            <div>
              <div className="flex items-center gap-2"><BrainCircuit size={16} className="text-ok" /><SectionLabel as="h2">Shared task memory</SectionLabel></div>
              <p id="memory-title" className="mt-1 text-xs text-text-2">Outcomes written by every Boss connected to this graph.</p>
            </div>
            <span className="graph-section-kicker">PERSISTENT MEMORY · TRACK 02</span>
          </div>
          <Card className="graph-panel p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 border-b border-border-0 pb-3">
              <div>
                <div className="text-sm font-semibold text-text-0">Recent outcomes</div>
                <div className="mt-1 text-xs text-text-2">Shared across sessions and coordinator restarts.</div>
              </div>
              <Badge tone="neutral" mono>{episodes.length} loaded</Badge>
            </div>
            {memory.isLoading ? (
              <div className="space-y-2 pt-3" aria-label="Loading task memory">
                {[0, 1, 2].map((row) => <div key={row} className="graph-skeleton" />)}
              </div>
            ) : episodes.length ? (
              <div className="max-h-[380px] divide-y divide-white/[0.08] overflow-y-auto">
                {episodes.map((episode) => <EpisodeRow key={episode.task_id} episode={episode} />)}
              </div>
            ) : (
              <div className="graph-memory-empty">
                <span className="graph-memory-empty-icon"><BrainCircuit size={18} /></span>
                <div className="text-sm font-medium text-text-0">No task history yet</div>
                <p>Run a task below. Its outcome will be available to other Boss nodes and can inform future routes.</p>
              </div>
            )}
            {memory.isError && <p className="mt-3 text-xs text-warn">Could not load shared task memory.</p>}
          </Card>
        </section>
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-[1.02fr_0.98fr]">
        <section aria-labelledby="dispatch-title">
          <div className="graph-section-heading mb-3">
            <div>
              <div className="flex items-center gap-2"><Send size={16} className="text-accent" /><SectionLabel as="h2">Dispatch a task</SectionLabel></div>
              <p id="dispatch-title" className="mt-1 text-xs text-text-2">Let graph context choose the worker and record what happened.</p>
            </div>
          </div>
          <Card className="graph-panel p-4 sm:p-5">
            <form onSubmit={(event) => { event.preventDefault(); dispatch.mutate() }}>
              <label htmlFor="graph-prompt" className="text-xs font-medium text-text-1">Task prompt <span className="font-normal text-text-2">· capability {taskClass || 'not selected'}</span></label>
              <textarea
                id="graph-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                className="graph-prompt mt-2 min-h-[112px] w-full resize-y rounded-md border border-border-1 bg-editor px-3 py-3 text-sm leading-relaxed text-text-0 outline-none transition-colors placeholder:text-text-2 focus:border-accent/70"
                placeholder="Describe a task for your worker…"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button type="submit" variant="primary" className="h-10 gap-2 px-4 text-sm" disabled={!connected || !taskClass.trim() || !prompt.trim() || dispatch.isPending}>
                  {dispatch.isPending ? <><span className="graph-pending-dot" /> Running on mesh…</> : <><Send size={14} /> Run graph-routed task</>}
                </Button>
                <span className="text-xs text-text-2">The selected worker returns output to this session.</span>
              </div>
            </form>
            {dispatch.error && <p className="mt-4 rounded-md border border-warn/30 bg-warn/5 p-3 text-xs text-warn" role="alert">{dispatch.error.message}</p>}
            {dispatch.data && !dispatch.isPending && (
              <div className="graph-dispatch-result mt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="ok"><Check size={12} /> Completed</Badge>
                  <span className="text-xs text-text-1" title={dispatch.data.warp_peer_id}>Worker {shortenPeerID(dispatch.data.warp_peer_id)}</span>
                  <span className="ml-auto font-mono text-[10px] text-text-2">{shortenPeerID(dispatch.data.warp_task_id, 8, 5)}</span>
                </div>
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-black/20 p-3 font-mono text-xs leading-relaxed text-text-1">{dispatch.data.choices[0]?.message.content}</pre>
              </div>
            )}
          </Card>
        </section>

        <section aria-labelledby="coordination-title">
          <div className="graph-section-heading mb-3">
            <div>
              <div className="flex items-center gap-2"><Database size={16} className="text-blue-300" /><SectionLabel as="h2">Shared capacity</SectionLabel></div>
              <p id="coordination-title" className="mt-1 text-xs text-text-2">Reservations keep independent Boss nodes from double-booking workers.</p>
            </div>
            <span className="graph-section-kicker">COORDINATION · TRACK 02</span>
          </div>
          <Card className="graph-panel p-4 sm:p-5">
            <div className="flex items-start gap-3 rounded-md border border-border-0 bg-white/[0.025] p-3">
              <span className="graph-lock-icon"><ShieldCheck size={17} /></span>
              <p className="text-xs leading-relaxed text-text-1">A task claims worker capacity in FalkorDB before execution. Other Boss nodes see the claim; completion releases it, and interrupted claims expire automatically.</p>
            </div>
            {activeReservations.length ? (
              <div className="mt-2 divide-y divide-white/[0.08]">
                {activeReservations.map((claim) => (
                  <div key={claim.task_id} className="graph-reservation">
                    <span className="graph-reservation-icon"><Clock3 size={15} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-text-0">{claim.worker_name || shortenPeerID(claim.peer_id)}</div>
                      <div className="mt-1 font-mono text-[10px] text-text-2" title={claim.coordinator}>Boss {shortenPeerID(claim.coordinator)} <span className="px-1">·</span>{expiryLabel(claim.expires_at)}</div>
                    </div>
                    <Badge tone="accent">Reserved</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="graph-reservations-empty mt-3">
                <span className="graph-reservations-check"><Check size={15} /></span>
                <div>
                  <div className="text-sm font-medium text-text-0">All worker capacity is available</div>
                  <div className="mt-1 text-xs text-text-2">A shared reservation will appear here while a task is running.</div>
                </div>
              </div>
            )}
            {reservations.error && <p className="mt-3 text-xs text-warn">Could not load active reservations.</p>}
          </Card>
        </section>
      </div>

      <footer className="graph-footer mt-8 flex flex-col gap-2 border-t border-border-0 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2 text-xs text-text-2"><LockKeyhole size={13} /> Prompt and worker output never enter graph memory.</span>
        <span className="text-xs text-text-2">Warp <ArrowRight size={12} className="mx-1 inline" /> FalkorDB <ArrowRight size={12} className="mx-1 inline" /> mesh workers</span>
      </footer>
    </main>
  )
}
