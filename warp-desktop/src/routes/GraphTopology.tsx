import { useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './GraphTopology.css'
import {
  Bot,
  BrainCircuit,
  CircleDot,
  Cpu,
  GitBranch,
  Network,
  ShieldCheck,
} from 'lucide-react'
import type {
  GraphMemoryEpisode,
  GraphReservation,
  GraphRouteResponse,
} from '../lib/api'
import type { AboutResponse, WorkerListResponse } from '../types/api'
import { shortenPeerID } from '../lib/peer'

type NodeKind = 'mesh' | 'coordinator' | 'worker' | 'capability' | 'memory'
type Tone = 'amber' | 'mint' | 'blue' | 'slate'

type EntityData = {
  kind: NodeKind
  title: string
  detail: string
  status?: string
  tone: Tone
  icon: typeof Network
  emphasis?: string
}

type EntityNode = Node<EntityData, 'entity'>

const ICONS = {
  mesh: Network,
  coordinator: ShieldCheck,
  worker: Bot,
  capability: Cpu,
  memory: BrainCircuit,
} satisfies Record<NodeKind, typeof Network>

const HANDLES = [Position.Left, Position.Right, Position.Top, Position.Bottom] as const

function EntityCard({ data }: NodeProps<EntityNode>) {
  const Icon = data.icon
  return (
    <div className={`graph-entity graph-entity--${data.tone}`} aria-label={`${data.kind}: ${data.title}`}>
      {HANDLES.flatMap((position) => [
        <Handle key={`source-${position}`} id={`source-${position}`} type="source" position={position} isConnectable={false} />,
        <Handle key={`target-${position}`} id={`target-${position}`} type="target" position={position} isConnectable={false} />,
      ])}
      <div className="graph-entity-icon"><Icon size={16} strokeWidth={1.8} /></div>
      <div className="graph-entity-copy">
        <div className="graph-entity-kind">{data.kind}</div>
        <div className="graph-entity-title" title={data.title}>{data.title}</div>
        <div className="graph-entity-detail" title={data.detail}>{data.detail}</div>
      </div>
      {data.status && <span className="graph-entity-status"><CircleDot size={10} />{data.status}</span>}
      {data.emphasis && <span className="graph-entity-emphasis">{data.emphasis}</span>}
    </div>
  )
}

const nodeTypes = { entity: EntityCard }

function connection(
  id: string,
  source: string,
  target: string,
  label: string,
  tone: Tone,
  sourceSide: Position,
  targetSide: Position,
): Edge {
  const colors: Record<Tone, string> = {
    amber: '#ffb547',
    mint: '#63d7aa',
    blue: '#83b7ff',
    slate: '#9ca4af',
  }
  const color = colors[tone]
  return {
    id,
    source,
    target,
    sourceHandle: `source-${sourceSide}`,
    targetHandle: `target-${targetSide}`,
    type: 'smoothstep',
    label,
    labelStyle: { fill: color, fontSize: 9, fontWeight: 600, letterSpacing: '0.025em' },
    labelBgStyle: { fill: '#1b1d20', fillOpacity: 0.96 },
    labelBgPadding: [5, 3],
    labelBgBorderRadius: 3,
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
    style: { stroke: color, strokeWidth: 1.5, opacity: 0.82 },
  }
}

interface Props {
  meshId: string
  owner?: AboutResponse
  workers?: WorkerListResponse
  route?: GraphRouteResponse
  episodes: GraphMemoryEpisode[]
  reservations: GraphReservation[]
  connected: boolean
}

export default function GraphTopology({ meshId, owner, workers, route, episodes, reservations, connected }: Props) {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth < 820)

  useEffect(() => {
    const update = () => setCompact(window.innerWidth < 820)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const entities = workers?.agents ?? []
  const candidateByPeer = new Map(route?.candidates.map((candidate) => [candidate.peer_id, candidate]) ?? [])
  const coordinators = Array.from(new Set([
    owner?.boss_peer_id,
    ...episodes.map((episode) => episode.coordinator),
    ...reservations.map((reservation) => reservation.coordinator),
  ].filter((peer): peer is string => Boolean(peer))))
  const visibleCoordinators = coordinators.slice(0, 3)
  const taskCounts = new Map<string, number>()
  for (const episode of episodes) taskCounts.set(episode.peer_id, (taskCounts.get(episode.peer_id) ?? 0) + 1)
  const capabilityNames = Array.from(new Set(entities.map((agent) => agent.agent_capability || agent.model || 'general')))
  const workerRows = Math.ceil(entities.length / 2)
  const capabilityRows = Math.ceil(capabilityNames.length / 2)
  const compactHeight = Math.max(680, 290 + workerRows * 140 + capabilityRows * 145 + 130)
  const desktopHeight = Math.max(390, 88 + Math.max(entities.length, capabilityNames.length, visibleCoordinators.length, 2) * 108)
  const height = compact ? compactHeight : desktopHeight

  const { nodes, edges } = useMemo(() => {
    const flowOut = compact ? Position.Bottom : Position.Right
    const flowIn = compact ? Position.Top : Position.Left
    const center = compact ? 0 : Math.max(40, (height - 92) / 2)
    const column = compact ? 250 : 280
    const workerX = compact ? 0 : 570
    const capabilityX = compact ? 0 : 865
    const bossX = compact ? 0 : 280
    const meshPosition = compact ? { x: 240, y: 0 } : { x: 0, y: center }
    const memoryPosition = compact ? { x: 240, y: height - 112 } : { x: capabilityX, y: height - 112 }

    const nextNodes: EntityNode[] = [{
      id: 'mesh', type: 'entity', position: meshPosition,
      data: { kind: 'mesh', title: meshId || 'Agent mesh', detail: `${entities.length} workers · ${visibleCoordinators.length} Boss nodes`, icon: ICONS.mesh, tone: 'amber', emphasis: 'SHARED' },
    }]
    const nextEdges: Edge[] = []

    const coordinatorNodes = compact ? visibleCoordinators.slice(0, 2) : visibleCoordinators
    coordinatorNodes.forEach((peer, index) => {
      const current = peer === owner?.boss_peer_id
      const y = compact
        ? 145
        : center + (index - (visibleCoordinators.length - 1) / 2) * 112
      const x = compact ? 15 + index * column : bossX
      const id = `coordinator-${peer}`
      nextNodes.push({
        id, type: 'entity', position: { x, y },
        data: {
          kind: 'coordinator', title: current ? 'This Boss' : `Boss ${shortenPeerID(peer, 4, 3)}`,
          detail: shortenPeerID(peer), icon: ICONS.coordinator, tone: current ? 'amber' : 'slate',
          emphasis: current ? 'CONNECTED' : 'SEEN IN MEMORY',
        },
      })
      nextEdges.push(connection(`mesh-${id}`, 'mesh', id, 'HAS_COORDINATOR', 'amber', flowOut, flowIn))
    })

    const shownAgents = entities.slice(0, 6)
    const agentPosition = new Map<string, { x: number; y: number }>()
    shownAgents.forEach((agent, index) => {
      const candidate = candidateByPeer.get(agent.peer_id)
      const y = compact
        ? 300 + Math.floor(index / 2) * 140
        : 38 + index * 108
      const x = compact
        ? 15 + (index % 2) * column
        : workerX
      agentPosition.set(agent.peer_id, { x, y })
      const activeClaim = reservations.some((reservation) => reservation.peer_id === agent.peer_id)
      nextNodes.push({
        id: `worker-${agent.peer_id}`, type: 'entity', position: { x, y },
        data: {
          kind: 'worker', title: agent.name || shortenPeerID(agent.peer_id),
          detail: `${agent.agent_capability || agent.model || 'general'} · ${agent.current_tasks}/${agent.max_tasks || 1} active`,
          icon: ICONS.worker, tone: activeClaim ? 'blue' : agent.online ? 'mint' : 'slate',
          status: activeClaim ? 'reserved' : agent.online ? 'online' : 'offline',
          emphasis: candidate ? `ROUTE ${candidate.score.toFixed(2)}` : undefined,
        },
      })
      if (!compact) {
        nextEdges.push(connection(`mesh-worker-${agent.peer_id}`, 'mesh', `worker-${agent.peer_id}`, 'HAS_WORKER', 'slate', Position.Bottom, Position.Bottom))
      }
      if (owner?.boss_peer_id) {
        const trustLabel = compact && index > 0 ? '' : candidate ? `TRUSTS · ${candidate.trust_score.toFixed(2)}` : 'TRUSTS'
        nextEdges.push(connection(`trust-${agent.peer_id}`, `coordinator-${owner.boss_peer_id}`, `worker-${agent.peer_id}`, trustLabel, 'amber', flowOut, flowIn))
      }
      if ((taskCounts.get(agent.peer_id) ?? 0) > 0) {
        const historyLabel = compact ? '' : `EXECUTED · ${taskCounts.get(agent.peer_id)}`
        nextEdges.push(connection(`executed-${agent.peer_id}`, `worker-${agent.peer_id}`, 'memory', historyLabel, 'mint', compact ? flowOut : Position.Bottom, compact ? flowIn : Position.Top))
      }
    })

    capabilityNames.forEach((capability, index) => {
      const members = shownAgents.filter((agent) => (agent.agent_capability || agent.model || 'general') === capability)
      const relatedY = members.length
        ? members.reduce((total, member) => total + (agentPosition.get(member.peer_id)?.y ?? 0), 0) / members.length
        : index * 108
      const x = compact ? 15 + (index % 2) * column : capabilityX
      const y = compact
        ? 300 + workerRows * 140 + Math.floor(index / 2) * 145
        : Math.max(38, relatedY)
      const id = `capability-${capability}`
      nextNodes.push({
        id, type: 'entity', position: { x, y },
        data: { kind: 'capability', title: capability, detail: `${members.length} matching ${members.length === 1 ? 'worker' : 'workers'}`, icon: ICONS.capability, tone: 'blue' },
      })
      members.forEach((member) => nextEdges.push(connection(
        `cap-${member.peer_id}-${capability}`, `worker-${member.peer_id}`, id,
        compact && members.indexOf(member) > 0 ? '' : 'HAS_CAPABILITY', 'blue', flowOut, flowIn,
      )))
    })

    nextNodes.push({
      id: 'memory', type: 'entity', position: memoryPosition,
      data: {
        kind: 'memory', title: 'Task episodes', detail: `${episodes.length} outcomes · SHA-256 only`,
        icon: ICONS.memory, tone: 'mint', emphasis: reservations.length ? `${reservations.length} CLAIMED` : 'PERSISTENT',
      },
    })
    nextEdges.push(connection('mesh-memory', 'mesh', 'memory', `REMEMBERS · ${episodes.length}`, 'mint', compact ? flowOut : Position.Bottom, compact ? flowIn : Position.Top))

    return { nodes: nextNodes, edges: nextEdges }
  }, [
    candidateByPeer, capabilityNames, compact, entities, episodes.length, height, meshId,
    owner?.boss_peer_id, reservations, taskCounts, visibleCoordinators, workerRows,
  ])

  const hiddenWorkers = Math.max(0, entities.length - 6)
  return (
    <div className="graph-flow-frame">
      {connected ? (
        <div className="graph-flow" style={{ height }}>
          <ReactFlow
            key={compact ? 'compact' : 'wide'}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: compact ? 0.14 : 0.12, minZoom: 0.38, maxZoom: 1.05 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            zoomOnScroll={false}
            panOnDrag
            proOptions={{ hideAttribution: false }}
          >
            <Background variant={BackgroundVariant.Dots} color="#585b62" gap={22} size={1} />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </div>
      ) : (
        <div className="graph-flow-empty">
          <GitBranch size={20} />
          <strong>Connect FalkorDB to explore the mesh</strong>
          <span>Worker, trust, capability, and task relationships appear here when the graph is online.</span>
        </div>
      )}
      <div className="graph-flow-caption">
        <span>
          <i />
          {compact
            ? 'Mesh HAS_WORKER Worker · Boss TRUSTS Worker · Mesh REMEMBERS Task'
            : 'Drag to pan · Use the controls to zoom or fit the graph'}
        </span>
        <span>{hiddenWorkers ? `Showing 6 of ${entities.length} workers` : `${nodes.length} nodes · ${edges.length} relationships`}</span>
      </div>
    </div>
  )
}
