package boss

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"warp/internal/falkor"
	"warp/internal/network"
	"warp/internal/obs"
	"warp/internal/types"
)

const graphOperationTimeout = 1500 * time.Millisecond

func (b *Boss) syncGraphWorker(profile types.WorkerProfile) {
	if b.graphStore == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), graphOperationTimeout)
	defer cancel()
	trust := b.checkTrust(ctx, profile)
	trustScore := 0.0
	if b.reputationEngine != nil {
		trustScore = b.reputationEngine.Score(profile.PeerID)
	}
	capability := strings.TrimSpace(profile.AgentCapability)
	if capability == "" {
		capability = strings.TrimSpace(profile.AgentName)
	}
	if capability == "" {
		capability = "general"
	}
	err := b.graphStore.UpsertWorker(ctx, falkor.WorkerSnapshot{
		PeerID: profile.PeerID, Name: profile.AgentName, Model: profile.Model,
		Capability: capability, Online: true, CPUUsagePct: profile.CPUUsagePct,
		CurrentTasks: profile.CurrentTasks, MaxTasks: profile.MaxTasks,
		TrustScore: trustScore, DispatchAllowed: trust.Allowed,
		Equivocator: trust.Reason == ErrPeerIsEquivocator.Error(), LastSeen: time.Now(),
	})
	if err != nil {
		slog.Debug("FalkorDB worker sync failed", slog.String(obs.FieldPeerID, profile.PeerID), slog.Any(obs.FieldErr, err))
	}
}

func (b *Boss) markGraphWorkerOffline(peerID string) {
	if b.graphStore == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), graphOperationTimeout)
	defer cancel()
	if err := b.graphStore.MarkWorkerOffline(ctx, peerID); err != nil {
		slog.Debug("FalkorDB offline update failed", slog.String(obs.FieldPeerID, peerID), slog.Any(obs.FieldErr, err))
	}
}

func (b *Boss) recordGraphTask(episode falkor.TaskEpisode) {
	if b.graphStore == nil || episode.TaskID == "" || episode.PeerID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), graphOperationTimeout)
	defer cancel()
	if b.node != nil && b.node.Host != nil {
		episode.Coordinator = b.node.Host.ID().String()
	}
	if err := b.graphStore.RecordTask(ctx, episode); err != nil {
		slog.Warn("FalkorDB task memory write failed", slog.String(obs.FieldTaskID, episode.TaskID), slog.Any(obs.FieldErr, err))
	}
}

func (b *Boss) reserveGraphTask(ctx context.Context, profile types.WorkerProfile, taskID string) (func(), error) {
	if b.graphStore == nil {
		if b.graphRequired {
			return nil, errGraphUnavailable
		}
		return func() {}, nil
	}
	owner := ""
	if b.node != nil && b.node.Host != nil {
		owner = b.node.Host.ID().String()
	}
	queryCtx, cancel := context.WithTimeout(ctx, graphOperationTimeout)
	defer cancel()
	ok, err := b.graphStore.ReserveTask(queryCtx, taskID, profile.PeerID, owner, network.TaskExecutionTimeout+network.StreamDialTimeout+time.Minute)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errGraphUnavailable, err)
	}
	if !ok {
		return nil, errMeshOverloaded
	}
	return func() {
		ctx, cancel := context.WithTimeout(context.Background(), graphOperationTimeout)
		defer cancel()
		if err := b.graphStore.ReleaseTask(ctx, taskID); err != nil {
			slog.Warn("FalkorDB reservation release failed; claim will expire", slog.String(obs.FieldTaskID, taskID), slog.Any(obs.FieldErr, err))
		}
	}, nil
}

func (b *Boss) handleGraphReservations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if b.graphStore == nil {
		http.Error(w, "FalkorDB is not configured", http.StatusServiceUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), graphOperationTimeout)
	defer cancel()
	items, err := b.graphStore.Reservations(ctx)
	if err != nil {
		http.Error(w, "FalkorDB reservations unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"reservations": items})
}

func (b *Boss) handleGraphStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if b.graphStore == nil {
		http.Error(w, "FalkorDB is not configured", http.StatusServiceUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), graphOperationTimeout)
	defer cancel()
	summary, err := b.graphStore.Summary(ctx)
	if err != nil {
		http.Error(w, "FalkorDB context unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"connected": true, "summary": summary})
}

func (b *Boss) handleGraphMemory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if b.graphStore == nil {
		http.Error(w, "FalkorDB is not configured", http.StatusServiceUnavailable)
		return
	}
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit == 0 {
		limit = 20
	}
	ctx, cancel := context.WithTimeout(r.Context(), graphOperationTimeout)
	defer cancel()
	items, err := b.graphStore.RecentMemory(ctx, limit)
	if err != nil {
		http.Error(w, "FalkorDB memory unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"episodes": items})
}

func (b *Boss) handleGraphRoute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if b.graphStore == nil {
		http.Error(w, "FalkorDB is not configured", http.StatusServiceUnavailable)
		return
	}
	taskClass := strings.TrimSpace(r.URL.Query().Get("model"))
	if taskClass == "" {
		taskClass = strings.TrimSpace(r.URL.Query().Get("capability"))
	}
	if taskClass == "" {
		http.Error(w, "model or capability is required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), graphOperationTimeout)
	defer cancel()
	ranked, _, err := b.graphRoute(ctx, taskClass)
	if err != nil {
		if errors.Is(err, errGraphUnavailable) {
			http.Error(w, "FalkorDB graph query failed", http.StatusServiceUnavailable)
			return
		}
		http.Error(w, "no graph-eligible workers", http.StatusServiceUnavailable)
		return
	}
	if len(ranked) == 0 {
		http.Error(w, "no workers match this model or capability", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"task_class": taskClass,
		"selected":   ranked[0],
		"candidates": ranked,
		"reason":     "FalkorDB ranked live trust-eligible workers by trust, prior task success, and current load.",
	})
}

func routeMemoryEpisode(profile types.WorkerProfile, taskID, taskClass, prompt, source, outcome string, started time.Time) falkor.TaskEpisode {
	capability := strings.TrimSpace(profile.AgentCapability)
	if capability == "" {
		capability = strings.TrimSpace(profile.AgentName)
	}
	if strings.EqualFold(taskClass, profile.PeerID) {
		taskClass = capability
	}
	if taskClass == "" {
		taskClass = capability
	}
	if taskClass == "" {
		taskClass = profile.Model
	}
	if taskClass == "" {
		taskClass = "general"
	}
	return falkor.TaskEpisode{
		TaskID: taskID, TaskClass: strings.ToLower(strings.TrimSpace(taskClass)),
		PeerID: profile.PeerID, WorkerName: profile.AgentName, Capability: capability,
		Model: profile.Model, Outcome: outcome, DurationMS: time.Since(started).Milliseconds(),
		CompletedAt: time.Now(), Prompt: prompt, Source: source,
	}
}
