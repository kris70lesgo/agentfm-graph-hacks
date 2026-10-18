import type { AboutResponse, WorkerListResponse, PeerSummary, PeerLogResponse } from '../types/api'

const DEFAULT_PORT = 8080
let port = DEFAULT_PORT
const baseURL = () => `http://127.0.0.1:${port}`

export function setApiPort(p: number) {
  port = p
}

// getApiBaseURL exposes the resolved base URL so non-fetch callers (EventSource,
// WebSocket) can build URLs from the same source of truth as the HTTP client.
export function getApiBaseURL(): string {
  return baseURL()
}

export async function loadApiPortFromSettings() {
  try {
    const stored = await window.api?.settings.get<number>('apiPort')
    if (typeof stored === 'number') port = stored
  } catch {}
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${baseURL()}${path}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(res.status, text || res.statusText)
  }
  return res.json()
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseURL()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(res.status, text || res.statusText)
  }
  return res.json()
}

export interface SelfCommentResponse {
  cid: string
  ledger_hash: string
}

export interface GraphStatusResponse {
  connected: boolean
  summary: {
    graph: string
    mesh_id: string
    workers: number
    online_workers: number
    task_episodes: number
    active_reservations: number
  }
}

export interface GraphRouteCandidate {
  peer_id: string
  name: string
  model: string
  capability: string
  score: number
  trust_score: number
  success_rate: number
  load_ratio: number
  history_count: number
}

export interface GraphRouteResponse {
  task_class: string
  selected: GraphRouteCandidate
  candidates: GraphRouteCandidate[]
  reason: string
}

export interface GraphMemoryEpisode {
  task_id: string
  task_class: string
  peer_id: string
  worker_name: string
  capability: string
  model: string
  outcome: string
  duration_ms: number
  completed_at: string
  prompt_digest: string
  source: string
  coordinator: string
}

export interface GraphReservation {
  task_id: string
  peer_id: string
  worker_name: string
  coordinator: string
  created_at: string
  expires_at: string
}

export interface GraphTaskResult {
  warp_peer_id: string
  warp_task_id: string
  choices: { message: { content: string } }[]
}

export const api = {
  about: () => getJSON<AboutResponse>('/v1/about'),
  graphStatus: () => getJSON<GraphStatusResponse>('/v1/graph/status'),
  graphReservations: () => getJSON<{ reservations: GraphReservation[] }>('/v1/graph/reservations'),
  graphDispatch: (model: string, prompt: string) => postJSON<GraphTaskResult>('/v1/chat/completions', {
    model, messages: [{ role: 'user', content: prompt }], stream: false,
  }),
  graphMemory: (limit = 20) =>
    getJSON<{ episodes: GraphMemoryEpisode[] }>(`/v1/graph/memory?limit=${limit}`),
  graphRoute: (taskClass: string) =>
    getJSON<GraphRouteResponse>(`/v1/graph/route?model=${encodeURIComponent(taskClass)}`),
  health: () => getJSON<{ status: string; online_workers: number }>('/health'),
  workers: (includeOffline = false) =>
    getJSON<WorkerListResponse>(`/api/workers${includeOffline ? '?include_offline=true' : ''}`),
  peer: (peerId: string) => getJSON<PeerSummary>(`/v1/peers/${peerId}`),
  peerLog: (
    peerId: string,
    { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
  ) => getJSON<PeerLogResponse>(`/v1/peers/${peerId}/log?limit=${limit}&offset=${offset}`),
  commentBody: (peerId: string, cid: string) =>
    getJSON<{ cid: string; body: string; language: string }>(
      `/v1/peers/${peerId}/comments/${cid}.json`,
    ),
  submitSelfComment: (
    peerId: string,
    body: {
      text: string
      language?: string
      attached_rating_hash?: string
      /** Optional honesty rating in [-1.0, +1.0]. When set, the boss appends a
       *  paired Rating ledger entry alongside the Comment so it surfaces in
       *  the PeerView Ratings tab and flows into EigenTrust. */
      rating?: number
    },
  ) =>
    postJSON<SelfCommentResponse>(
      `/v1/peers/${peerId}/comments/self`,
      body,
    ),

  // Streaming endpoints, return a Response guaranteed to be ok with a body.
  // On non-2xx, ApiError is thrown with the error body text.
  execute: async (
    body: {
      worker_id: string
      prompt: string
      task_id?: string
      feedback?: string
      feedback_rating?: number
    },
    signal?: AbortSignal,
  ) => {
    const res = await fetch(`${baseURL()}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new ApiError(res.status, text || res.statusText)
    }
    return res
  },

  testRelay: (multiaddr: string) =>
    postJSON<{ ok: boolean; peer_id?: string; error?: string }>('/api/relay/test', {
      multiaddr,
    }),

  chatCompletion: async (body: unknown, signal?: AbortSignal) => {
    const res = await fetch(`${baseURL()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new ApiError(res.status, text || res.statusText)
    }
    return res
  },
}
