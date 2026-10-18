package falkor

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func integrationStore(t *testing.T) *Store {
	t.Helper()
	addr := os.Getenv("FALKORDB_TEST_ADDR")
	if addr == "" {
		t.Skip("set FALKORDB_TEST_ADDR to run against a real FalkorDB instance")
	}
	t.Setenv("FALKORDB_ADDR", addr)
	t.Setenv("FALKORDB_GRAPH", fmt.Sprintf("warp_test_%d", time.Now().UnixNano()))
	t.Setenv("FALKORDB_MESH_ID", "test-mesh")
	s, err := OpenFromEnv(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.graph.Delete(); _ = s.Close() })
	return s
}

func TestReservationsCoordinateBossNodesAndExpire(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	if err := s.UpsertWorker(ctx, WorkerSnapshot{PeerID: "shared", Capability: "research", Online: true, MaxTasks: 1, DispatchAllowed: true}); err != nil {
		t.Fatal(err)
	}
	other, err := OpenFromEnv(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	var claimed atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			store := []*Store{s, other}[i%2]
			ok, err := store.ReserveTask(ctx, fmt.Sprintf("parallel-%d", i), "shared", fmt.Sprintf("boss-%d", i%2), time.Minute)
			if err != nil {
				t.Error(err)
			}
			if ok {
				claimed.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if claimed.Load() != 1 {
		t.Fatalf("capacity 1 accepted %d concurrent claims", claimed.Load())
	}
	leases, err := other.Reservations(ctx)
	if err != nil || len(leases) != 1 {
		t.Fatalf("shared reservations: %+v, %v", leases, err)
	}
	if err := other.RecordTask(ctx, TaskEpisode{TaskID: leases[0].TaskID, PeerID: "shared", Outcome: "success"}); err != nil {
		t.Fatal(err)
	}
	leases, err = s.Reservations(ctx)
	if err != nil || len(leases) != 0 {
		t.Fatalf("completion releases capacity: %+v, %v", leases, err)
	}
	if ok, err := s.ReserveTask(ctx, "expired", "shared", "boss-a", time.Millisecond); err != nil || !ok {
		t.Fatalf("short lease: %v, %v", ok, err)
	}
	time.Sleep(3 * time.Millisecond)
	if ok, err := other.ReserveTask(ctx, "recovered", "shared", "boss-b", time.Minute); err != nil || !ok {
		t.Fatalf("expired lease recovery: %v, %v", ok, err)
	}
}

func TestMeshesDoNotShareWorkerStateOrTaskMemory(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	if err := s.UpsertWorker(ctx, WorkerSnapshot{PeerID: "same-peer", Capability: "research", Online: true, MaxTasks: 1, DispatchAllowed: true}); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordTask(ctx, TaskEpisode{TaskID: "same-task", PeerID: "same-peer", Outcome: "success"}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FALKORDB_MESH_ID", "another-mesh")
	other, err := OpenFromEnv(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if err := other.UpsertWorker(ctx, WorkerSnapshot{PeerID: "same-peer", Capability: "research", Online: false, MaxTasks: 1}); err != nil {
		t.Fatal(err)
	}
	summary, err := s.Summary(ctx)
	if err != nil || summary.OnlineWorkers != 1 {
		t.Fatalf("isolated worker state: %+v, %v", summary, err)
	}
	if memory, err := other.RecentMemory(ctx, 10); err != nil || len(memory) != 0 {
		t.Fatalf("isolated memory: %+v, %v", memory, err)
	}
}

func TestBossTrustAndReachabilityRemainIndependent(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	worker := WorkerSnapshot{PeerID: "shared", Capability: "planning", Online: true, MaxTasks: 2, TrustScore: 0.8, DispatchAllowed: true}
	if err := s.UpsertWorker(ctx, worker); err != nil {
		t.Fatal(err)
	}
	other, err := OpenFromEnv(ctx, "another-boss")
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	worker.TrustScore, worker.DispatchAllowed = -0.9, false
	if err := other.UpsertWorker(ctx, worker); err != nil {
		t.Fatal(err)
	}
	if ranked, err := s.Recommend(ctx, "planning", []string{"shared"}); err != nil || len(ranked) != 1 || ranked[0].TrustScore != 0.8 {
		t.Fatalf("independent trust: %+v %v", ranked, err)
	}
	if ranked, err := other.Recommend(ctx, "planning", []string{"shared"}); err != nil || len(ranked) != 0 {
		t.Fatalf("blocked in other trust view: %+v %v", ranked, err)
	}
	if err := s.MarkWorkerOffline(ctx, "shared"); err != nil {
		t.Fatal(err)
	}
	worker.DispatchAllowed = true
	if err := other.UpsertWorker(ctx, worker); err != nil {
		t.Fatal(err)
	}
	if ranked, err := other.Recommend(ctx, "planning", []string{"shared"}); err != nil || len(ranked) != 1 {
		t.Fatalf("another Boss can still reach worker: %+v %v", ranked, err)
	}
	if ranked, err := s.Recommend(ctx, "planning", []string{"shared"}); err != nil || len(ranked) != 0 {
		t.Fatalf("offline in first Boss: %+v %v", ranked, err)
	}
}

func TestConcurrentStartupKeepsUniqueIdentities(t *testing.T) {
	s := integrationStore(t)
	if err := s.graph.Delete(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			fresh, err := OpenFromEnv(ctx)
			if err != nil {
				t.Error(err)
				return
			}
			defer fresh.Close()
			if err := fresh.UpsertWorker(ctx, WorkerSnapshot{PeerID: "same-worker", Capability: "planning", Online: true, MaxTasks: 1, DispatchAllowed: true}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	fresh, err := OpenFromEnv(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	result, err := fresh.readQuery(ctx, "MATCH (m:Mesh) RETURN count(m) AS meshes", nil)
	if err != nil || !result.Next() || floatValue(result.Record(), "meshes") != 1 {
		t.Fatalf("duplicate mesh identities: %v", err)
	}
	if summary, err := fresh.Summary(ctx); err != nil || summary.Workers != 1 {
		t.Fatalf("duplicate worker identities: %+v %v", summary, err)
	}
}

func TestGraphRoutingLearnsFromPersistentOutcomes(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	if summary, err := s.Summary(ctx); err != nil || summary.Workers != 0 {
		t.Fatalf("empty graph: %+v, %v", summary, err)
	}
	for _, id := range []string{"worker-a", "worker-b"} {
		if err := s.UpsertWorker(ctx, WorkerSnapshot{
			PeerID: id, Name: id, Model: "demo", Capability: "research",
			Online: true, MaxTasks: 2, DispatchAllowed: true, LastSeen: time.Now(),
		}); err != nil {
			t.Fatal(err)
		}
	}
	for i, outcome := range []string{"failure", "success"} {
		id := []string{"worker-a", "worker-b"}[i]
		if err := s.RecordTask(ctx, TaskEpisode{
			TaskID: fmt.Sprintf("task-%d", i), TaskClass: "research", PeerID: id,
			Capability: "research", Outcome: outcome, Prompt: "private content",
		}); err != nil {
			t.Fatal(err)
		}
	}
	ranked, err := s.Recommend(ctx, "research", []string{"worker-a", "worker-b"})
	if err != nil || len(ranked) != 2 || ranked[0].PeerID != "worker-b" || ranked[0].HistoryCount != 1 {
		t.Fatalf("memory-aware route: %+v, %v", ranked, err)
	}
	// A second connection reads the same memory, as a new Boss session would.
	other, err := OpenFromEnv(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	memory, err := other.RecentMemory(ctx, 20)
	if err != nil || len(memory) != 2 || len(memory[0].PromptDigest) != 64 || memory[0].Prompt != "" {
		t.Fatalf("persistent digest-only memory: %+v, %v", memory, err)
	}
	if err := s.MarkWorkerOffline(ctx, "worker-b"); err != nil {
		t.Fatal(err)
	}
	ranked, err = other.Recommend(ctx, "research", []string{"worker-a", "worker-b"})
	if err != nil || len(ranked) != 1 || ranked[0].PeerID != "worker-a" {
		t.Fatalf("offline exclusion: %+v, %v", ranked, err)
	}
}
