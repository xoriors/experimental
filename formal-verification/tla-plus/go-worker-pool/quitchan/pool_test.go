package quitchan

import (
	"errors"
	"os"
	"testing"

	"github.com/xoriors/experimental/formal-verification/tla-plus/go-worker-pool/internal/scenario"
)

func newPool(workers, queueSize int, handler func(int)) scenario.Pool {
	return New(workers, queueSize, handler)
}

// The rest of the functional suite passes on this pool, under -race too, and
// the race detector has nothing to report: there is no data race.
// SubmitAfterShutdownFails is the exception, see the next test.
func TestAcceptedJobsAreHandled(t *testing.T) { scenario.AcceptedJobsAreHandled(t, newPool) }
func TestConcurrentSubmitters(t *testing.T)   { scenario.ConcurrentSubmitters(t, newPool) }
func TestRepeatedAndConcurrentShutdown(t *testing.T) {
	scenario.RepeatedAndConcurrentShutdown(t, newPool)
}
func TestShutdownWaitsForRunningHandler(t *testing.T) {
	scenario.ShutdownWaitsForRunningHandler(t, newPool)
}

// TestSubmitAfterShutdownIsAccepted is the suite's SubmitAfterShutdownFails
// (same pool size, 100 Submits after Shutdown returned) with the verdict
// inverted, because this plain, sequential test catches the quitchan bug.
// Once p.quit is closed and the queue has room, both cases of Submit's select
// are ready, so each Submit returns nil with probability 1/2: the scenario
// fails essentially always (all 100 get ErrClosed with probability 2^-100).
// The accepted job is stranded: the workers have exited.
func TestSubmitAfterShutdownIsAccepted(t *testing.T) {
	rec := &scenario.Recorder{}
	p := New(2, 4, rec.Handle)
	p.Shutdown()
	for j := range 100 {
		err := p.Submit(j)
		if errors.Is(err, ErrClosed) {
			continue
		}
		if err != nil {
			t.Fatalf("Submit(%d) = %v", j, err)
		}
		t.Logf("Submit(%d) after Shutdown returned nil: the job is stranded in p.jobs", j)
		if got := len(p.jobs); got != 1 {
			t.Fatalf("len(p.jobs) = %d, want the 1 stranded job", got)
		}
		if got := rec.Snapshot(); len(got) != 0 {
			t.Fatalf("handler ran after Shutdown: %v", got)
		}
		return
	}
	t.Fatal("100 Submits after Shutdown all returned ErrClosed (probability 2^-100)")
}

// TestSubmitRacesShutdown is the fixed pool's racing test. On this pool it
// fails in practice on every run, in its first rounds: an accepted job is not
// handled by the time Shutdown returns. So it runs only when asked:
// RACING=1 go test -run SubmitRacesShutdown ./quitchan/
func TestSubmitRacesShutdown(t *testing.T) {
	if os.Getenv("RACING") == "" {
		t.Skip("fails on this pool by design; set RACING=1 to watch it fail")
	}
	scenario.SubmitRacesShutdown(t, newPool, ErrClosed)
}

// TestReplayLostJob replays TLC's counterexample for spec/WorkerPoolQuit.cfg:
//
//	State 2  sd_quit   s1 closes p.quit, then waits in p.workers.Wait
//	State 3  w_select  w1: the queue is empty, so <-p.quit is the only ready case
//	State 4  w_drain   w1: the drain select takes default    -> parked in the hook
//	State 5  c_select  c1: BOTH cases are ready; select picks p.jobs <- job
//	State 6  w_exit    w1 returns, p.workers.Done()
//	State 7  s1        Shutdown returns; c1's accepted job is still queued
//
// States 2-4 and 6-7 are forced by the hook. State 5 is a coin flip inside
// the runtime that no hook can force: the Go spec makes select choose
// "via a uniform pseudo-random selection". Each attempt that returns
// ErrClosed is the other outcome of that same step and leaves the state as
// it was (the queue stays empty), so the test flips again; 100 misses in a
// row has probability 2^-100.
func TestReplayLostJob(t *testing.T) {
	drained, release := make(chan struct{}), make(chan struct{})
	testHookWorkerDrained = func() { close(drained); <-release }
	defer func() { testHookWorkerDrained = func() {} }()

	const job = 1
	rec := &scenario.Recorder{}
	p := New(1, 1, rec.Handle) // Workers = {w1}, QueueSize = 1

	handledAtShutdown := make(chan int)
	go func() { // s1
		p.Shutdown()
		handledAtShutdown <- rec.Count(job)
	}()
	<-drained // States 2-4

	attempts := 1 // State 5
	for ; ; attempts++ {
		err := p.Submit(job)
		if err == nil {
			break
		}
		if !errors.Is(err, ErrClosed) {
			t.Fatalf("Submit = %v", err)
		}
		if attempts == 100 {
			t.Fatal("select chose <-p.quit 100 times in a row")
		}
	}
	t.Logf("Submit returned nil after Shutdown had closed p.quit (attempt %d)", attempts)

	close(release) // States 6-7
	if n := <-handledAtShutdown; n != 0 {
		t.Fatalf("job handled %d times by Shutdown's return; this schedule should lose it", n)
	}
	// Violates ShutdownDrains: Submit returned nil, Shutdown returned, and
	// the job sits in the queue with no worker left to take it.
	if got := len(p.jobs); got != 1 {
		t.Fatalf("len(p.jobs) = %d, want the 1 stranded job", got)
	}
	if n := rec.Count(job); n != 0 {
		t.Fatalf("job handled %d times", n)
	}
}
