package boss

import (
	"bytes"
	"io"
)

// Observe worker outcome markers without changing the native streaming wire
// format. The rolling suffix catches a marker split across network reads.
type taskOutcomeReader struct {
	io.Reader
	tail   []byte
	failed bool
}

func (r *taskOutcomeReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	marker := []byte("[WARP: TASK_FAILED")
	data := append(r.tail, p[:n]...)
	if bytes.Contains(data, marker) {
		r.failed = true
	}
	if len(data) >= len(marker) {
		data = data[len(data)-len(marker)+1:]
	}
	r.tail = append(r.tail[:0], data...)
	return n, err
}
