package buggy

import (
	"os"
	"runtime"
	"slices"
	"testing"

	"github.com/xoriors/experimental/formal-verification/tla-plus/go-worker-pool/internal/scenario"
)

func newPool(workers, queueSize int, handler func(int)) scenario.Pool {
	return New(workers, queueSize, handler)
}

// The ordinary functional suite passes on the buggy pool, under -race too:
// none of these tests runs Submit concurrently with Shutdown.
func TestAcceptedJobsAreHandled(t *testing.T) { scenario.AcceptedJobsAreHandled(t, newPool) }
func TestConcurrentSubmitters(t *testing.T)   { scenario.ConcurrentSubmitters(t, newPool) }
func TestSubmitAfterShutdownFails(t *testing.T) {
	scenario.SubmitAfterShutdownFails(t, newPool, ErrClosed)
}
func TestRepeatedAndConcurrentShutdown(t *testing.T) {
	scenario.RepeatedAndConcurrentShutdown(t, newPool)
}
func TestShutdownWaitsForRunningHandler(t *testing.T) {
	scenario.ShutdownWaitsForRunningHandler(t, newPool)
}

// TestSubmitRacesShutdown is the fixed pool's racing test. A test written
// for this race does find it: on this pool it fails in practice on every run,
// usually within a few of its 300 rounds, with "send on closed channel". So
// it runs only when asked: RACING=1 go test -run SubmitRacesShutdown ./buggy/
func TestSubmitRacesShutdown(t *testing.T) {
	if os.Getenv("RACING") == "" {
		t.Skip("fails on this pool by design; set RACING=1 to watch it fail")
	}
	scenario.SubmitRacesShutdown(t, newPool, ErrClosed)
}

// TestReplayTOCTOU replays TLC's counterexample for spec/WorkerPoolBuggy.cfg
// against the real code and shows the send really panics.
func TestReplayTOCTOU(t *testing.T) {
	res := scenario.ReplayTOCTOU(t, newPool, scenario.Hooks{
		SubmitAdmitted: &testHookSubmitAdmitted,
		ShutdownMarked: &testHookShutdownMarked,
		ShutdownClosed: &testHookShutdownClosed,
	}, scenario.ClosesJobs)
	t.Logf("events: %q", res.Events)
	t.Logf("Submit panicked with: %v", res.Panic)

	err, ok := res.Panic.(runtime.Error)
	if !ok || err.Error() != "send on closed channel" {
		t.Fatalf("Submit panic = %v, want runtime error \"send on closed channel\"", res.Panic)
	}
	want := []string{scenario.EvAdmitted, scenario.EvMarked, scenario.EvClosed, scenario.EvResumed}
	if !slices.Equal(res.Events, want) {
		t.Fatalf("events = %q, want %q", res.Events, want)
	}
	if res.Handled != 0 {
		t.Fatalf("job handled %d times, want 0 (it was never enqueued)", res.Handled)
	}
}
