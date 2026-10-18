// Package falkor stores the mesh context and task episodes used by the
// graph-aware router. Task content is never persisted; only a one-way hash,
// routing class, outcome, and timing are retained as shared memory.
package falkor

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	dbclient "github.com/FalkorDB/falkordb-go/v2"
)

const queryTimeout = 900 * time.Millisecond

// Store owns one FalkorDB graph for the configured Warp mesh. FalkorDB is
// the queryable context layer; the existing local worker cache remains the
// source of liveness so graph outages never dispatch to a stale peer.
type Store struct {
	db          *dbclient.FalkorDB
	graph       *dbclient.Graph
	name        string
	meshID      string
	coordinator string
}

// WorkerSnapshot is the live portion of a worker that participates in graph
// routing. PeerID is the stable identity shared by the graph and libp2p mesh.
type WorkerSnapshot struct {
	PeerID          string
	Name            string
	Model           string
	Capability      string
	Online          bool
	CPUUsagePct     float64
	CurrentTasks    int
	MaxTasks        int
	TrustScore      float64
	DispatchAllowed bool
	Equivocator     bool
	LastSeen        time.Time
}

// RouteCandidate carries graph-derived factors for an eligible worker.
type RouteCandidate struct {
	PeerID       string  `json:"peer_id"`
	Name         string  `json:"name"`
	Model        string  `json:"model"`
	Capability   string  `json:"capability"`
	Score        float64 `json:"score"`
	TrustScore   float64 `json:"trust_score"`
	SuccessRate  float64 `json:"success_rate"`
	LoadRatio    float64 `json:"load_ratio"`
	HistoryCount int     `json:"history_count"`
}

// TaskEpisode is privacy-preserving episodic memory shared through the graph.
type TaskEpisode struct {
	TaskID       string    `json:"task_id"`
	TaskClass    string    `json:"task_class"`
	PeerID       string    `json:"peer_id"`
	WorkerName   string    `json:"worker_name"`
	Capability   string    `json:"capability"`
	Model        string    `json:"model"`
	Outcome      string    `json:"outcome"`
	DurationMS   int64     `json:"duration_ms"`
	CompletedAt  time.Time `json:"completed_at"`
	PromptDigest string    `json:"prompt_digest"`
	Source       string    `json:"source"`
	Coordinator  string    `json:"coordinator"`
	Prompt       string    `json:"-"`
}

// Summary describes the context currently retained by this graph.
type Summary struct {
	Graph              string `json:"graph"`
	MeshID             string `json:"mesh_id"`
	Workers            int64  `json:"workers"`
	OnlineWorkers      int64  `json:"online_workers"`
	TaskEpisodes       int64  `json:"task_episodes"`
	ActiveReservations int64  `json:"active_reservations"`
}

// Reservation is a bounded claim on worker capacity shared by all Boss nodes.
type Reservation struct {
	TaskID      string    `json:"task_id"`
	PeerID      string    `json:"peer_id"`
	WorkerName  string    `json:"worker_name"`
	Coordinator string    `json:"coordinator"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
}

// ReserveTask checks capacity and creates its claim in one serialized graph
// write. Lease expiry recovers capacity after an interrupted Boss process.
func (s *Store) ReserveTask(ctx context.Context, taskID, peerID, coordinator string, ttl time.Duration) (bool, error) {
	if taskID == "" || peerID == "" || ttl <= 0 {
		return false, errors.New("task id, peer id, and positive reservation TTL are required")
	}
	now := time.Now()
	result, err := s.query(ctx, `
		OPTIONAL MATCH (existing:Reservation {mesh_id: $mesh_id, task_id: $task_id})
		WHERE existing.expires_at > $now
		WITH count(existing) AS existing_count
		WHERE existing_count = 0
		MATCH (:Mesh {id: $mesh_id})-[:HAS_COORDINATOR]->(:Coordinator {peer_id: $observer})-[trust:TRUSTS]->(w:Worker {peer_id: $peer_id})
		OPTIONAL MATCH (w)-[old:RESERVED]->(expired:Reservation)
		WHERE expired.expires_at <= $now
		DELETE old, expired
		WITH DISTINCT w, trust
		OPTIONAL MATCH (w)-[:RESERVED]->(lease:Reservation)
		WHERE lease.expires_at > $now
		WITH w, trust, count(lease) AS reservations
		WITH w, trust, CASE WHEN reservations > w.current_tasks THEN reservations ELSE w.current_tasks END AS effective_tasks
		WHERE trust.online = true AND trust.updated_at > $fresh_after
		  AND trust.allowed = true AND trust.equivocator = false
		  AND (w.max_tasks <= 0 OR effective_tasks < w.max_tasks)
		CREATE (claim:Reservation {mesh_id: $mesh_id, task_id: $task_id,
		  coordinator: $coordinator, created_at: $now, expires_at: $expires_at})
		CREATE (w)-[:RESERVED]->(claim)
		RETURN claim.task_id AS task_id
	`, map[string]interface{}{
		"mesh_id": s.meshID, "peer_id": peerID, "task_id": taskID,
		"coordinator": coordinator, "now": now.UnixMilli(), "expires_at": now.Add(ttl).UnixMilli(),
		"observer": s.coordinator, "fresh_after": now.Add(-45 * time.Second).UnixMilli(),
	})
	if err != nil {
		return false, fmt.Errorf("reserve FalkorDB worker capacity: %w", err)
	}
	return result.Next(), nil
}

func (s *Store) ReleaseTask(ctx context.Context, taskID string) error {
	_, err := s.query(ctx, `
		MATCH (lease:Reservation {mesh_id: $mesh_id, task_id: $task_id})
		DETACH DELETE lease
	`, map[string]interface{}{"mesh_id": s.meshID, "task_id": taskID})
	return err
}

func (s *Store) Reservations(ctx context.Context) ([]Reservation, error) {
	result, err := s.readQuery(ctx, `
		MATCH (:Mesh {id: $mesh_id})-[:HAS_WORKER]->(w:Worker)-[:RESERVED]->(lease:Reservation)
		WHERE lease.expires_at > $now
		RETURN lease.task_id AS task_id, w.peer_id AS peer_id, w.name AS worker_name,
		  lease.coordinator AS coordinator, lease.created_at AS created_at, lease.expires_at AS expires_at
		ORDER BY created_at DESC LIMIT 100
	`, map[string]interface{}{"mesh_id": s.meshID, "now": time.Now().UnixMilli()})
	if err != nil {
		return nil, err
	}
	items := make([]Reservation, 0)
	for result.Next() {
		r := result.Record()
		items = append(items, Reservation{
			TaskID: stringValue(r, "task_id"), PeerID: stringValue(r, "peer_id"),
			WorkerName: stringValue(r, "worker_name"), Coordinator: stringValue(r, "coordinator"),
			CreatedAt: time.UnixMilli(int64(floatValue(r, "created_at"))),
			ExpiresAt: time.UnixMilli(int64(floatValue(r, "expires_at"))),
		})
	}
	return items, nil
}

// OpenFromEnv connects when FALKORDB_ADDR is configured. An unset address
// keeps FalkorDB opt-in for existing deployments; connection failures are
// returned to the bootstrap layer. An explicitly configured graph is required
// for dispatch, so an unavailable graph cannot silently bypass coordination.
func OpenFromEnv(ctx context.Context, coordinatorID ...string) (*Store, error) {
	addr := strings.TrimSpace(os.Getenv("FALKORDB_ADDR"))
	if addr == "" {
		return nil, nil
	}

	graphName := strings.TrimSpace(os.Getenv("FALKORDB_GRAPH"))
	if graphName == "" {
		graphName = "warp"
	}
	meshID := strings.TrimSpace(os.Getenv("FALKORDB_MESH_ID"))
	if meshID == "" {
		meshID = "public-mesh"
	}

	options := &dbclient.ConnectionOption{
		Addr:         addr,
		Username:     os.Getenv("FALKORDB_USERNAME"),
		Password:     os.Getenv("FALKORDB_PASSWORD"),
		DialTimeout:  2 * time.Second,
		ReadTimeout:  2 * time.Second,
		WriteTimeout: 2 * time.Second,
	}
	if enabled, _ := strconv.ParseBool(os.Getenv("FALKORDB_TLS")); enabled {
		options.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	}

	db, err := dbclient.FalkorDBNew(options)
	if err != nil {
		return nil, fmt.Errorf("create FalkorDB client: %w", err)
	}
	if err := db.Conn.Ping(ctx).Err(); err != nil {
		_ = db.Conn.Close()
		return nil, fmt.Errorf("ping FalkorDB at %s: %w", addr, err)
	}
	coordinator := "default-boss"
	if len(coordinatorID) > 0 && coordinatorID[0] != "" {
		coordinator = coordinatorID[0]
	}
	store := &Store{db: db, graph: db.SelectGraph(graphName), name: graphName, meshID: meshID, coordinator: coordinator}
	if err := store.initialize(ctx); err != nil {
		_ = db.Conn.Close()
		return nil, fmt.Errorf("initialize FalkorDB graph %q: %w", graphName, err)
	}
	return store, nil
}

func (s *Store) Name() string { return s.name }

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Conn.Close()
}

func (s *Store) query(ctx context.Context, cypher string, params map[string]interface{}) (*dbclient.QueryResult, error) {
	return s.runQuery(ctx, cypher, params, false)
}

func (s *Store) readQuery(ctx context.Context, cypher string, params map[string]interface{}) (*dbclient.QueryResult, error) {
	return s.runQuery(ctx, cypher, params, true)
}

func (s *Store) runQuery(ctx context.Context, cypher string, params map[string]interface{}, readOnly bool) (*dbclient.QueryResult, error) {
	if s == nil || s.graph == nil {
		return nil, errors.New("FalkorDB is not configured")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	options := dbclient.NewQueryOptions().SetTimeout(int(queryTimeout.Milliseconds()))
	var result *dbclient.QueryResult
	var err error
	if readOnly {
		result, err = s.graph.ROQuery(cypher, params, options)
	} else {
		result, err = s.graph.Query(cypher, params, options)
	}
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// UpsertWorker refreshes the connected-data graph from the latest signed mesh
// telemetry plus the Boss's current trust decision.
func (s *Store) UpsertWorker(ctx context.Context, worker WorkerSnapshot) error {
	if worker.LastSeen.IsZero() {
		worker.LastSeen = time.Now()
	}
	params := map[string]interface{}{
		"mesh_id": s.meshID, "peer_id": worker.PeerID,
		"name": worker.Name, "model": worker.Model, "capability": worker.Capability,
		"online": worker.Online, "cpu_usage_pct": worker.CPUUsagePct,
		"current_tasks": worker.CurrentTasks, "max_tasks": worker.MaxTasks,
		"trust_score": worker.TrustScore, "dispatch_allowed": worker.DispatchAllowed,
		"equivocator": worker.Equivocator, "last_seen": worker.LastSeen.UnixMilli(),
		"coordinator": s.coordinator,
	}
	if _, err := s.query(ctx, `
		MERGE (m:Mesh {id: $mesh_id})
		MERGE (w:Worker {mesh_id: $mesh_id, peer_id: $peer_id})
		SET w.name = $name, w.model = $model, w.capability = $capability,
		    w.online = $online, w.cpu_usage_pct = $cpu_usage_pct,
		    w.current_tasks = $current_tasks, w.max_tasks = $max_tasks,
		    w.trust_score = $trust_score, w.dispatch_allowed = $dispatch_allowed,
		    w.equivocator = $equivocator, w.last_seen = $last_seen
		MERGE (m)-[:HAS_WORKER]->(w)
		MERGE (owner:Coordinator {mesh_id: $mesh_id, peer_id: $coordinator})
		MERGE (m)-[:HAS_COORDINATOR]->(owner)
		MERGE (owner)-[t:TRUSTS]->(w)
		SET t.score = $trust_score, t.allowed = $dispatch_allowed,
		    t.equivocator = $equivocator, t.updated_at = $last_seen, t.online = $online
	`, params); err != nil {
		return fmt.Errorf("upsert FalkorDB worker and trust edge: %w", err)
	}
	capabilities := []string{}
	if worker.Capability != "" {
		capabilities = append(capabilities, worker.Capability)
	}
	if _, err := s.query(ctx, `
		MATCH (w:Worker {mesh_id: $mesh_id, peer_id: $peer_id})
		OPTIONAL MATCH (w)-[old:HAS_CAPABILITY]->(:Capability)
		DELETE old
		WITH w
		FOREACH (cap IN $capabilities |
			MERGE (c:Capability {name: cap})
			MERGE (w)-[:HAS_CAPABILITY]->(c)
		)
	`, map[string]interface{}{"mesh_id": s.meshID, "peer_id": worker.PeerID, "capabilities": capabilities}); err != nil {
		return fmt.Errorf("upsert FalkorDB worker capability: %w", err)
	}
	models := []string{}
	if worker.Model != "" {
		models = append(models, worker.Model)
	}
	if _, err := s.query(ctx, `
		MATCH (w:Worker {mesh_id: $mesh_id, peer_id: $peer_id})
		OPTIONAL MATCH (w)-[old:RUNS_MODEL]->(:Model)
		DELETE old
		WITH w
		FOREACH (model IN $models |
			MERGE (m:Model {name: model})
			MERGE (w)-[:RUNS_MODEL]->(m)
		)
	`, map[string]interface{}{"mesh_id": s.meshID, "peer_id": worker.PeerID, "models": models}); err != nil {
		return fmt.Errorf("upsert FalkorDB worker model: %w", err)
	}
	return nil
}

func (s *Store) MarkWorkerOffline(ctx context.Context, peerID string) error {
	_, err := s.query(ctx, `
		MATCH (:Coordinator {mesh_id: $mesh_id, peer_id: $coordinator})-[t:TRUSTS]->(w:Worker {peer_id: $peer_id})
		SET t.online = false
		WITH w
		MATCH (:Coordinator)-[seen:TRUSTS]->(w)
		WITH w, sum(CASE WHEN seen.online = true THEN 1 ELSE 0 END) AS online_views
		SET w.online = online_views > 0
	`, map[string]interface{}{"mesh_id": s.meshID, "peer_id": peerID, "coordinator": s.coordinator})
	return err
}

// Recommend ranks only currently live, trust-approved candidates, while using
// graph relationships and prior task episodes to shape the choice.
func (s *Store) Recommend(ctx context.Context, taskClass string, candidateIDs []string) ([]RouteCandidate, error) {
	if len(candidateIDs) == 0 {
		return nil, nil
	}
	result, err := s.readQuery(ctx, `
		MATCH (m:Mesh {id: $mesh_id})-[:HAS_COORDINATOR]->(:Coordinator {peer_id: $coordinator})-[trust:TRUSTS]->(w:Worker)
		OPTIONAL MATCH (w)-[:HAS_CAPABILITY]->(c:Capability)
		WITH w, trust, collect(c.name) AS capabilities
		WHERE w.peer_id IN $candidate_ids
		  AND trust.online = true
		  AND trust.updated_at > $fresh_after
		  AND trust.allowed = true
		  AND trust.equivocator = false
		  AND (w.max_tasks <= 0 OR w.current_tasks < w.max_tasks)
		  AND (
		    toLower(w.peer_id) = toLower($task_class)
		    OR toLower(w.name) = toLower($task_class)
		    OR toLower(w.model) = toLower($task_class)
		    OR any(cap IN capabilities WHERE toLower(cap) = toLower($task_class))
		  )
		OPTIONAL MATCH (w)-[:RESERVED]->(lease:Reservation)
		WHERE lease.expires_at > $now
		WITH w, trust, count(lease) AS reservations
		WITH w, trust, CASE WHEN reservations > w.current_tasks THEN reservations ELSE w.current_tasks END AS effective_tasks
		WHERE w.max_tasks <= 0 OR effective_tasks < w.max_tasks
		OPTIONAL MATCH (w)-[:EXECUTED]->(episode:Task)
		WHERE toLower(episode.task_class) = toLower($task_class)
		   OR toLower(episode.capability) = toLower($task_class)
		   OR toLower(episode.model) = toLower($task_class)
		WITH w, trust, effective_tasks, count(episode) AS history_count,
		     sum(CASE WHEN episode.outcome = 'success' THEN 1 ELSE 0 END) AS successes
		WITH w, trust, history_count, successes, effective_tasks,
		     CASE WHEN history_count = 0 THEN 0.5 ELSE successes * 1.0 / history_count END AS success_rate,
		     CASE WHEN w.max_tasks <= 0 THEN 0.0 ELSE effective_tasks * 1.0 / w.max_tasks END AS load_ratio
		RETURN w.peer_id AS peer_id, w.name AS name, w.model AS model,
		       w.capability AS capability, coalesce(trust.score, 0.0) AS trust_score,
		       success_rate AS success_rate, load_ratio AS load_ratio,
	       history_count AS history_count,
	       coalesce(trust.score, 0.0) * 0.5 + success_rate * 0.3 + (1.0 - load_ratio) * 0.2 AS score
		ORDER BY score DESC, load_ratio ASC, w.cpu_usage_pct ASC, peer_id ASC
	`, map[string]interface{}{
		"mesh_id":       s.meshID,
		"candidate_ids": candidateIDs,
		"task_class":    taskClass,
		"now":           time.Now().UnixMilli(),
		"coordinator":   s.coordinator,
		"fresh_after":   time.Now().Add(-45 * time.Second).UnixMilli(),
	})
	if err != nil {
		return nil, fmt.Errorf("rank workers in FalkorDB: %w", err)
	}
	candidates := make([]RouteCandidate, 0)
	for result.Next() {
		r := result.Record()
		candidates = append(candidates, RouteCandidate{
			PeerID:       stringValue(r, "peer_id"),
			Name:         stringValue(r, "name"),
			Model:        stringValue(r, "model"),
			Capability:   stringValue(r, "capability"),
			Score:        floatValue(r, "score"),
			TrustScore:   floatValue(r, "trust_score"),
			SuccessRate:  floatValue(r, "success_rate"),
			LoadRatio:    floatValue(r, "load_ratio"),
			HistoryCount: int(floatValue(r, "history_count")),
		})
	}
	return candidates, nil
}

// RecordTask persists an episodic result without retaining prompts or model
// output. Routing learns from task classes and outcomes; the digest identifies
// a prompt without retaining its text.
func (s *Store) RecordTask(ctx context.Context, episode TaskEpisode) error {
	digestInput := episode.Prompt
	if digestInput == "" {
		digestInput = episode.TaskClass + "\x00" + episode.TaskID
	}
	digest := sha256.Sum256([]byte(digestInput))
	if episode.CompletedAt.IsZero() {
		episode.CompletedAt = time.Now()
	}
	_, err := s.query(ctx, `
		MERGE (m:Mesh {id: $mesh_id})
		MERGE (w:Worker {mesh_id: $mesh_id, peer_id: $peer_id})
		MERGE (t:Task {mesh_id: $mesh_id, task_id: $task_id})
		MERGE (m)-[:HAS_WORKER]->(w)
		SET t.task_class = $task_class, t.capability = $capability,
		    t.model = $model, t.outcome = $outcome, t.duration_ms = $duration_ms,
		    t.completed_at = $completed_at, t.prompt_digest = $prompt_digest,
		    t.source = $source, t.coordinator = $coordinator
		MERGE (w)-[:EXECUTED]->(t)
		MERGE (m)-[:REMEMBERS]->(t)
		WITH t
		OPTIONAL MATCH (lease:Reservation {mesh_id: $mesh_id, task_id: $task_id})
		DETACH DELETE lease
	`, map[string]interface{}{
		"mesh_id": s.meshID, "peer_id": episode.PeerID, "task_id": episode.TaskID,
		"task_class": episode.TaskClass, "capability": episode.Capability,
		"model": episode.Model, "outcome": episode.Outcome,
		"duration_ms": episode.DurationMS, "completed_at": episode.CompletedAt.UnixMilli(),
		"prompt_digest": hex.EncodeToString(digest[:]), "source": episode.Source,
		"coordinator": episode.Coordinator,
	})
	if err != nil {
		return fmt.Errorf("record FalkorDB task episode: %w", err)
	}
	return nil
}

func (s *Store) Summary(ctx context.Context) (Summary, error) {
	result, err := s.readQuery(ctx, `
		MATCH (m:Mesh {id: $mesh_id})
		OPTIONAL MATCH (m)-[:HAS_WORKER]->(w:Worker)
		WITH m, collect(w) AS workers
		OPTIONAL MATCH (m)-[:HAS_WORKER]->(:Worker)-[:RESERVED]->(lease:Reservation)
		WHERE lease.expires_at > $now
		WITH m, workers, count(lease) AS active_reservations
		OPTIONAL MATCH (m)-[:REMEMBERS]->(t:Task)
		RETURN size(workers) AS workers,
		       size([w IN workers WHERE w.online = true AND w.last_seen > $fresh_after]) AS online_workers,
		       active_reservations AS active_reservations,
		       count(t) AS task_episodes
	`, map[string]interface{}{"mesh_id": s.meshID, "now": time.Now().UnixMilli(), "fresh_after": time.Now().Add(-45 * time.Second).UnixMilli()})
	if err != nil {
		return Summary{}, fmt.Errorf("read FalkorDB summary: %w", err)
	}
	summary := Summary{Graph: s.name, MeshID: s.meshID}
	if result.Next() {
		r := result.Record()
		summary.Workers = int64(floatValue(r, "workers"))
		summary.OnlineWorkers = int64(floatValue(r, "online_workers"))
		summary.TaskEpisodes = int64(floatValue(r, "task_episodes"))
		summary.ActiveReservations = int64(floatValue(r, "active_reservations"))
	}
	return summary, nil
}

func (s *Store) RecentMemory(ctx context.Context, limit int) ([]TaskEpisode, error) {
	if limit < 1 {
		limit = 1
	}
	if limit > 100 {
		limit = 100
	}
	result, err := s.readQuery(ctx, `
		MATCH (w:Worker)-[:EXECUTED]->(t:Task)
		MATCH (m:Mesh {id: $mesh_id})-[:REMEMBERS]->(t)
		RETURN t.task_id AS task_id, t.task_class AS task_class,
		       w.peer_id AS peer_id, w.name AS worker_name,
		       t.capability AS capability, t.model AS model,
		       t.outcome AS outcome, t.duration_ms AS duration_ms,
		       t.completed_at AS completed_at, t.prompt_digest AS prompt_digest,
		       t.source AS source, t.coordinator AS coordinator
		ORDER BY t.completed_at DESC
		LIMIT $limit
	`, map[string]interface{}{"mesh_id": s.meshID, "limit": limit})
	if err != nil {
		return nil, fmt.Errorf("read FalkorDB task memory: %w", err)
	}
	episodes := make([]TaskEpisode, 0)
	for result.Next() {
		r := result.Record()
		episodes = append(episodes, TaskEpisode{
			TaskID:       stringValue(r, "task_id"),
			TaskClass:    stringValue(r, "task_class"),
			PeerID:       stringValue(r, "peer_id"),
			WorkerName:   stringValue(r, "worker_name"),
			Capability:   stringValue(r, "capability"),
			Model:        stringValue(r, "model"),
			Outcome:      stringValue(r, "outcome"),
			DurationMS:   int64(floatValue(r, "duration_ms")),
			CompletedAt:  time.UnixMilli(int64(floatValue(r, "completed_at"))),
			PromptDigest: stringValue(r, "prompt_digest"),
			Source:       stringValue(r, "source"),
			Coordinator:  stringValue(r, "coordinator"),
		})
	}
	return episodes, nil
}

func stringValue(record interface {
	Get(string) (interface{}, bool)
}, key string) string {
	value, ok := record.Get(key)
	if !ok || value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

func floatValue(record interface {
	Get(string) (interface{}, bool)
}, key string) float64 {
	value, ok := record.Get(key)
	if !ok || value == nil {
		return 0
	}
	switch n := value.(type) {
	case int:
		return float64(n)
	case int32:
		return float64(n)
	case int64:
		return float64(n)
	case uint64:
		return float64(n)
	case float32:
		return float64(n)
	case float64:
		return n
	case string:
		parsed, _ := strconv.ParseFloat(n, 64)
		return parsed
	default:
		parsed, _ := strconv.ParseFloat(fmt.Sprint(value), 64)
		return parsed
	}
}
