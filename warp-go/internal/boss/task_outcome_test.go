package boss

import (
	"warp/internal/types"
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestTaskFailureSurvivesChunkBoundaries(t *testing.T) {
	input := "partial output\n[WARP: TASK_FAILED sandbox_failed]\n"
	r := &taskOutcomeReader{Reader: strings.NewReader(input)}
	var output strings.Builder
	buffer := make([]byte, 3)
	for {
		n, err := r.Read(buffer)
		output.Write(buffer[:n])
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	if !r.failed || output.String() != input {
		t.Fatalf("failed=%v, output=%q", r.failed, output.String())
	}
}

func TestConfiguredGraphCannotSilentlyBypassCoordination(t *testing.T) {
	b := &Boss{graphRequired: true}
	if _, err := b.pickWorker(context.Background(), "planning"); !errors.Is(err, errGraphUnavailable) {
		t.Fatalf("routing without graph: %v", err)
	}
	if _, err := b.reserveGraphTask(context.Background(), types.WorkerProfile{PeerID: "worker"}, "task"); !errors.Is(err, errGraphUnavailable) {
		t.Fatalf("dispatch without graph: %v", err)
	}
}

func TestOpenAIStreamPropagatesWorkerTaskFailure(t *testing.T) {
	out, err := io.ReadAll(newSentinelFilter(strings.NewReader("partial output\n[WARP: TASK_FAILED sandbox_failed]\n")))
	if err == nil || !strings.Contains(err.Error(), "worker task failed") || string(out) != "partial output\n" {
		t.Fatalf("output=%q, error=%v", out, err)
	}
}
