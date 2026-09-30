package fixed

import (
	"slices"
	"testing"

	"github.com/xoriors/experimental/formal-verification/tla-plus/go-worker-pool/internal/scenario"
)

func newPool(workers, queueSize int, handler func(int)) scenario.Pool {
	return New(workers, queueSize, handler)
}

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

// Submits racing Shutdown without hooks: every interleaving the scheduler
// happens to produce must satisfy the spec's properties. Under -race this is
// also where the race detector would flag an unordered send/close pair.
func TestSubmitRacesShutdown(t *testing.T) { scenario.SubmitRacesShutdown(t, newPool, ErrClosed) }

func TestNewRejectsConfigOutsideTheModel(t *testing.T) {
	for _, c := range []struct{ workers, queue int }{{0, 1}, {1, 0}} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("New(%d, %d, h) did not panic", c.workers, c.queue)
				}
			}()
			New(c.workers, c.queue, func(int) {})
		}()
	}
}

// TestReplayTOCTOU drives the fixed pool through the schedule of the
// counterexample TLC found in the buggy spec. With c1 parked in the window,
// the driver checks that Shutdown is blocked in p.senders.Wait (sd_close is
// not enabled) before it lets c1 send, so the close comes after the send: no
// panic, and the job is handled exactly once, before Shutdown returns.
func TestReplayTOCTOU(t *testing.T) {
	res := scenario.ReplayTOCTOU(t, newPool, scenario.Hooks{
		SubmitAdmitted: &testHookSubmitAdmitted,
		ShutdownMarked: &testHookShutdownMarked,
		ShutdownClosed: &testHookShutdownClosed,
	}, scenario.WaitsForSender)
	t.Logf("events: %q", res.Events)

	if res.Panic != nil {
		t.Fatalf("Submit panicked: %v", res.Panic)
	}
	if res.SubmitErr != nil {
		t.Fatalf("Submit = %v, want nil (c1 was admitted before Shutdown started)", res.SubmitErr)
	}
	if res.HandledAtShutdown != 1 || res.Handled != 1 {
		t.Fatalf("job handled %d times by Shutdown's return, %d in total; want 1 and 1",
			res.HandledAtShutdown, res.Handled)
	}
	want := []string{scenario.EvAdmitted, scenario.EvMarked, scenario.EvWaiting, scenario.EvResumed, scenario.EvClosed}
	if !slices.Equal(res.Events, want) {
		t.Fatalf("events = %q, want %q", res.Events, want)
	}
}
