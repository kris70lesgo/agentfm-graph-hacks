package falkor

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"
)

// Schema setup is serialized across processes, including the first command
// that creates a graph. Unique constraints protect subsequent concurrent MERGE
// operations from creating duplicate identities.
func (s *Store) initialize(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	key := "warp:schema:" + s.name
	token := fmt.Sprintf("%d-%d", os.Getpid(), time.Now().UnixNano())
	for {
		acquired, err := s.db.Conn.SetNX(ctx, key, token, 15*time.Second).Result()
		if err != nil {
			return err
		}
		if acquired {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(25 * time.Millisecond):
		}
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), time.Second)
		defer done()
		_ = s.db.Conn.Eval(cleanup, `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`, []string{key}, token).Err()
	}()
	schema := []struct {
		label      string
		properties []string
	}{
		{"Mesh", []string{"id"}},
		{"Coordinator", []string{"mesh_id", "peer_id"}},
		{"Worker", []string{"mesh_id", "peer_id"}},
		{"Task", []string{"mesh_id", "task_id"}},
		{"Reservation", []string{"mesh_id", "task_id"}},
		{"Capability", []string{"name"}},
		{"Model", []string{"name"}},
	}
	for _, item := range schema {
		fields := make([]string, 0, len(item.properties))
		for _, property := range item.properties {
			fields = append(fields, "n."+property)
		}
		_, err := s.query(ctx, fmt.Sprintf("CREATE INDEX FOR (n:%s) ON (%s)", item.label, strings.Join(fields, ",")), nil)
		if err != nil && !strings.Contains(strings.ToLower(err.Error()), "already indexed") {
			return err
		}
		args := []interface{}{"GRAPH.CONSTRAINT", "CREATE", s.name, "UNIQUE", "NODE", item.label, "PROPERTIES", len(item.properties)}
		for _, property := range item.properties {
			args = append(args, property)
		}
		if err := s.db.Conn.Do(ctx, args...).Err(); err != nil && !strings.Contains(strings.ToLower(err.Error()), "already exists") {
			return err
		}
	}
	for {
		result, err := s.readQuery(ctx, "CALL db.constraints() YIELD status RETURN status", nil)
		if err != nil {
			return err
		}
		ready := 0
		for result.Next() {
			status := stringValue(result.Record(), "status")
			if status == "FAILED" {
				return fmt.Errorf("graph %q contains duplicate identities; a unique constraint failed", s.name)
			}
			if status == "OPERATIONAL" {
				ready++
			}
		}
		if ready >= len(schema) {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(25 * time.Millisecond):
		}
	}
	_, err := s.query(ctx, `
		MERGE (m:Mesh {id: $mesh_id}) ON CREATE SET m.created_at = $created_at
		MERGE (owner:Coordinator {mesh_id: $mesh_id, peer_id: $coordinator})
		MERGE (m)-[:HAS_COORDINATOR]->(owner)
	`, map[string]interface{}{
		"mesh_id": s.meshID, "created_at": time.Now().UnixMilli(), "coordinator": s.coordinator,
	})
	return err
}
