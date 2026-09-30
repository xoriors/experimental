// Package scenario holds the test scenarios shared by the pool variants, so
// that exactly the same schedule runs against buggy, fixed and quitchan.
// It is imported only by _test.go files.
package scenario

import (
	"errors"
	"maps"
	"runtime"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Pool is what every variant implements (with J = int).
type Pool interface {
	Submit(job int) error
	Shutdown()
}

// New builds a pool of one variant.
type New func(workers, queueSize int, handler func(int)) Pool

// Recorder is a handler that counts how often each job was handled.
type Recorder struct {
	mu    sync.Mutex
	count map[int]int
}

// Handle is the handler to pass to New.
func (r *Recorder) Handle(job int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.count == nil {
		r.count = make(map[int]int)
	}
	r.count[job]++
}

// Count reports how often job was handled.
func (r *Recorder) Count(job int) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.count[job]
}

// Snapshot copies all counts.
func (r *Recorder) Snapshot() map[int]int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return maps.Clone(r.count)
}

// checkExactlyOnce fails unless handled holds every accepted job exactly
// once and nothing else (HandledAtMostOnce, HandledOnlyIfAccepted and
// ShutdownDrains in the spec). It reports whether that held.
func checkExactlyOnce(t *testing.T, accepted []int, handled map[int]int) (ok bool) {
	t.Helper()
	ok = true
	want := make(map[int]int, len(accepted))
	for _, j := range accepted {
		want[j]++
	}
	for j, n := range want {
		if n != 1 {
			t.Fatalf("job %d accepted %d times (test bug)", j, n)
		}
		if handled[j] != 1 {
			t.Errorf("accepted job %d handled %d times, want exactly once", j, handled[j])
			ok = false
		}
	}
	for j, n := range handled {
		if want[j] == 0 {
			t.Errorf("job %d handled %d times but was never accepted", j, n)
			ok = false
		}
	}
	return ok
}

// AcceptedJobsAreHandled: sequential Submits, then Shutdown.
func AcceptedJobsAreHandled(t *testing.T, newPool New) {
	for _, size := range []struct{ workers, queue int }{{1, 1}, {3, 2}, {4, 64}} {
		rec := &Recorder{}
		p := newPool(size.workers, size.queue, rec.Handle)
		var accepted []int
		for j := range 100 {
			if err := p.Submit(j); err != nil {
				t.Fatalf("workers=%d queue=%d: Submit(%d) = %v before Shutdown", size.workers, size.queue, j, err)
			}
			accepted = append(accepted, j)
		}
		p.Shutdown()
		checkExactlyOnce(t, accepted, rec.Snapshot())
	}
}

// ConcurrentSubmitters: many goroutines submit; Shutdown after they finish.
func ConcurrentSubmitters(t *testing.T, newPool New) {
	const submitters, perSubmitter = 8, 50
	rec := &Recorder{}
	p := newPool(3, 4, rec.Handle)
	var wg sync.WaitGroup
	for s := range submitters {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range perSubmitter {
				if err := p.Submit(s*perSubmitter + i); err != nil {
					t.Errorf("Submit before Shutdown: %v", err)
					return
				}
			}
		}()
	}
	wg.Wait()
	p.Shutdown()
	accepted := make([]int, submitters*perSubmitter)
	for j := range accepted {
		accepted[j] = j
	}
	checkExactlyOnce(t, accepted, rec.Snapshot())
}

// SubmitAfterShutdownFails: once Shutdown returned, Submit must report
// errClosed and the handler must not run.
func SubmitAfterShutdownFails(t *testing.T, newPool New, errClosed error) {
	rec := &Recorder{}
	p := newPool(2, 4, rec.Handle)
	p.Shutdown()
	for j := range 100 {
		if err := p.Submit(j); !errors.Is(err, errClosed) {
			t.Fatalf("Submit(%d) after Shutdown = %v, want %v", j, err, errClosed)
		}
	}
	if got := rec.Snapshot(); len(got) != 0 {
		t.Fatalf("handler ran after Shutdown: %v", got)
	}
}

// RepeatedAndConcurrentShutdown: concurrent and repeated Shutdown calls
// neither panic (close of closed channel) nor return before the queue is
// drained.
func RepeatedAndConcurrentShutdown(t *testing.T, newPool New) {
	rec := &Recorder{}
	p := newPool(2, 8, rec.Handle)
	accepted := make([]int, 20)
	for j := range accepted {
		accepted[j] = j
		if err := p.Submit(j); err != nil {
			t.Fatalf("Submit(%d) = %v", j, err)
		}
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p.Shutdown()
			// Every call, not only the first, returns after the drain.
			if n := len(rec.Snapshot()); n != len(accepted) {
				t.Errorf("a Shutdown call returned with %d of %d jobs handled", n, len(accepted))
			}
		}()
	}
	wg.Wait()
	p.Shutdown()
	p.Shutdown()
	checkExactlyOnce(t, accepted, rec.Snapshot())
}

// ShutdownWaitsForRunningHandler: Shutdown must not return while a handler
// is still running.
func ShutdownWaitsForRunningHandler(t *testing.T, newPool New) {
	started, release := make(chan struct{}), make(chan struct{})
	var finished atomic.Bool
	p := newPool(1, 1, func(int) {
		close(started)
		<-release
		finished.Store(true)
	})
	if err := p.Submit(1); err != nil {
		t.Fatal(err)
	}
	<-started
	done := make(chan bool)
	go func() {
		p.Shutdown()
		done <- finished.Load()
	}()
	close(release)
	if !<-done {
		t.Fatal("Shutdown returned while the handler was still running")
	}
}

// SubmitRacesShutdown: Submits race Shutdown for real (no hooks). Checks
// every property of the spec on every round. It passes every time only for a
// correct pool. Both buggy pools fail it -- in practice on every run, within
// a few rounds -- so their packages run it only when asked (RACING=1).
func SubmitRacesShutdown(t *testing.T, newPool New, errClosed error) {
	const rounds, submitters, perSubmitter = 300, 4, 16
	ran, overlapped := 0, 0 // overlapped: rounds in which some Submits were accepted and some rejected
	defer func() { t.Logf("%d of %d rounds overlapped Submit with Shutdown", overlapped, ran) }()
	for round := range rounds {
		ran++
		rec := &Recorder{}
		p := newPool(2, 1, rec.Handle)
		start := make(chan struct{})
		var (
			wg       sync.WaitGroup
			mu       sync.Mutex
			accepted []int
			rejected atomic.Int32
		)
		for s := range submitters {
			wg.Add(1)
			go func() {
				defer wg.Done()
				defer func() {
					if r := recover(); r != nil {
						t.Errorf("round %d: Submit panicked: %v", round, r)
					}
				}()
				<-start
				for i := range perSubmitter {
					job := s*perSubmitter + i
					err := p.Submit(job)
					if errors.Is(err, errClosed) {
						rejected.Add(1)
						return
					}
					if err != nil {
						t.Errorf("round %d: Submit = %v", round, err)
						return
					}
					mu.Lock()
					accepted = append(accepted, job)
					mu.Unlock()
				}
			}()
		}
		var atShutdown map[int]int
		shutdownDone := make(chan struct{})
		go func() {
			defer close(shutdownDone)
			<-start
			runtime.Gosched() // let some Submits in first; any interleaving is valid
			p.Shutdown()
			atShutdown = rec.Snapshot()
		}()
		close(start)
		wg.Wait()
		<-shutdownDone
		// ShutdownDrains: everything accepted was handled BEFORE Shutdown
		// returned (atShutdown), exactly once, and nothing else was.
		if !checkExactlyOnce(t, accepted, atShutdown) {
			t.Errorf("round %d failed the exactly-once check above", round)
		}
		if !maps.Equal(atShutdown, rec.Snapshot()) {
			t.Errorf("round %d: handler ran after Shutdown returned", round)
		}
		if len(accepted) > 0 && rejected.Load() > 0 {
			overlapped++
		}
		if t.Failed() {
			return
		}
	}
}

// Hooks points at one package's test hooks (unexported variables, so each
// package's test file passes their addresses).
type Hooks struct {
	SubmitAdmitted *func() // between spec labels c_admit and c_send
	ShutdownMarked *func() // after sd_mark
	ShutdownClosed *func() // after sd_close
}

// AfterMark is what the pool under test does in TLC's state 3 (s1 has run
// sd_mark, c1 is parked between c_admit and c_send), which is where the
// buggy and the fixed spec differ.
type AfterMark int

const (
	// ClosesJobs: sd_close is enabled (WorkerPoolBuggy.tla), so s1 closes
	// p.jobs. The driver waits for testHookShutdownClosed.
	ClosesJobs AfterMark = iota
	// WaitsForSender: sd_close is not enabled (WorkerPoolFixed.tla: s1 is at
	// sd_wait_senders and senders = 1), so s1 blocks in p.senders.Wait. The
	// driver waits until the goroutine dump shows s1 blocked there, and fails
	// if p.jobs gets closed instead.
	WaitsForSender
)

// Replay is what a counterexample replay observed.
type Replay struct {
	SubmitErr         error    // Submit's result (nil if it panicked)
	Panic             any      // what Submit panicked with, if it did
	HandledAtShutdown int      // handler calls for the job when Shutdown returned
	Handled           int      // handler calls for the job at the end
	Events            []string // hook events, in the order they happened
}

type eventLog struct {
	mu sync.Mutex
	ev []string
}

func (l *eventLog) add(e string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.ev = append(l.ev, e)
}

func (l *eventLog) list() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return slices.Clone(l.ev)
}

// Event names used in Replay.Events.
const (
	EvAdmitted = "c1 admitted (c_admit)"
	EvMarked   = "s1 marked closed (sd_mark)"
	EvWaiting  = "s1 blocked in p.senders.Wait (sd_wait_senders)"
	EvClosed   = "s1 closed p.jobs (sd_close)"
	EvResumed  = "c1 resumes its send (c_send)"
)

// ReplayTOCTOU drives a pool through the counterexample TLC prints for
// spec/WorkerPoolBuggy.cfg (1 worker, queue of 1, client c1, Shutdown s1):
//
//	State 2  c_admit  c1 passes the closed check      -> parked in SubmitAdmitted
//	State 3  sd_mark  s1 sets p.closed = true         -> ShutdownMarked fires
//	State 4  sd_close s1 runs close(p.jobs)           -> ShutdownClosed fires
//	State 5  c_send   c1 resumes and sends            -> the buggy pool panics
//
// SubmitAdmitted is a rendezvous: c1 stays parked in the window until the
// driver releases it. ShutdownMarked and ShutdownClosed only notify the
// driver, which waits for them before it moves on, so each step happens in
// TLC's order. State 4 is where the variants differ (see AfterMark): the
// fixed pool cannot take it, so the driver instead makes sure s1 is blocked
// in p.senders.Wait before it releases c1. The fixed pool then runs the send,
// and the close follows it.
func ReplayTOCTOU(t *testing.T, newPool New, hooks Hooks, afterMark AfterMark) Replay {
	t.Helper()
	var (
		ev       eventLog
		res      Replay
		admitted = make(chan struct{})
		resume   = make(chan struct{})
		marked   = make(chan struct{})
		closed   = make(chan struct{})
	)
	saved := []func(){*hooks.SubmitAdmitted, *hooks.ShutdownMarked, *hooks.ShutdownClosed}
	*hooks.SubmitAdmitted = func() { ev.add(EvAdmitted); close(admitted); <-resume }
	*hooks.ShutdownMarked = func() { ev.add(EvMarked); close(marked) }
	*hooks.ShutdownClosed = func() { ev.add(EvClosed); close(closed) }
	release := sync.OnceFunc(func() { close(resume) })
	defer func() {
		release() // on a failed replay, do not leave c1 parked
		*hooks.SubmitAdmitted, *hooks.ShutdownMarked, *hooks.ShutdownClosed = saved[0], saved[1], saved[2]
	}()

	const job = 1
	rec := &Recorder{}
	p := newPool(1, 1, rec.Handle) // Workers = {w1}, QueueSize = 1

	clientDone := make(chan struct{})
	go func() { // client c1
		defer close(clientDone)
		defer func() { res.Panic = recover() }()
		res.SubmitErr = p.Submit(job)
	}()
	<-admitted // State 2

	shutdownDone := make(chan struct{})
	go func() { // Shutdown caller s1
		defer close(shutdownDone)
		p.Shutdown()
		res.HandledAtShutdown = rec.Count(job)
	}()
	<-marked // State 3

	switch afterMark {
	case ClosesJobs:
		<-closed // State 4
	case WaitsForSender:
		waitUntilBlockedInSendersWait(t, closed)
		ev.add(EvWaiting)
	}
	ev.add(EvResumed)
	release() // State 5

	<-clientDone
	<-shutdownDone
	res.Handled = rec.Count(job)
	res.Events = ev.list()
	return res
}

// waitUntilBlockedInSendersWait returns once the goroutine dump shows the
// replay's Shutdown goroutine blocked in sync.(*WaitGroup).Wait. While c1 is
// parked in the window, that can only be p.senders.Wait: s1 reaches
// p.workers.Wait only after closing p.jobs, and a close fails the test.
func waitUntilBlockedInSendersWait(t *testing.T, closed <-chan struct{}) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		blocked := shutdownBlockedInWaitGroup()
		// Checked after the dump: s1 fires ShutdownClosed before it can
		// block in p.workers.Wait, so a dump that caught s1 there is caught
		// here too.
		select {
		case <-closed:
			t.Fatal("s1 closed p.jobs while c1 was admitted and had not sent: " +
				"Shutdown did not wait for the in-flight sender")
		default:
		}
		if blocked {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("s1 never blocked in p.senders.Wait")
		}
		time.Sleep(time.Millisecond)
	}
}

// shutdownBlockedInWaitGroup reports whether some goroutine started by
// ReplayTOCTOU is blocked in sync.(*WaitGroup).Wait called from Shutdown.
func shutdownBlockedInWaitGroup() bool {
	buf := make([]byte, 1<<20)
	buf = buf[:runtime.Stack(buf, true)]
	for g := range strings.SplitSeq(string(buf), "\n\n") {
		header, frames, _ := strings.Cut(g, "\n")
		// Go 1.24 reports "[sync.WaitGroup.Wait]", earlier versions "[semacquire]".
		blocked := strings.Contains(header, "[sync.WaitGroup.Wait") || strings.Contains(header, "[semacquire")
		if blocked && strings.Contains(frames, "sync.(*WaitGroup).Wait(") &&
			strings.Contains(frames, ").Shutdown(") && strings.Contains(frames, "scenario.ReplayTOCTOU") {
			return true
		}
	}
	return false
}
