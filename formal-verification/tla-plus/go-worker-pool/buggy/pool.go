// Package buggy is the textbook worker pool with a time-of-check/time-of-use
// race: Submit checks closed under the mutex, unlocks, and only then sends.
// A Shutdown that runs in between closes the channel under the sender's feet
// and the send panics with "send on closed channel".
//
// DO NOT USE. It is kept as the counterexample for spec/WorkerPoolBuggy.tla;
// package fixed is the same file plus the lines marked FIX there.
package buggy

import (
	"errors"
	"sync"
)

// ErrClosed is returned by Submit once Shutdown has started.
var ErrClosed = errors.New("workerpool: pool is shut down")

// Test hooks at the interleaving points of the TLA+ spec (no-ops in
// production; only the replay tests set them, the pattern net/http uses).
var (
	testHookSubmitAdmitted = func() {} // between labels c_admit and c_send
	testHookShutdownMarked = func() {} // after label sd_mark
	testHookShutdownClosed = func() {} // after label sd_close
)

// Pool runs handler on every accepted job using a fixed set of workers.
type Pool[J any] struct {
	mu      sync.Mutex
	closed  bool // guarded by mu
	jobs    chan J
	workers sync.WaitGroup
	handler func(J)
}

// New starts workers goroutines that call handler for each submitted job;
// at most queueSize accepted jobs wait in the queue. handler must return (the
// model treats it as one step) and must not call Shutdown on its own pool,
// which would wait for the very worker that runs it.
func New[J any](workers, queueSize int, handler func(J)) *Pool[J] {
	// The model (spec/GoChan.tla) covers buffered channels only, and with no
	// worker a full queue deadlocks (spec/WorkerPoolFixed_NoWorkers.cfg).
	if workers < 1 || queueSize < 1 {
		panic("workerpool: need workers >= 1 and queueSize >= 1")
	}
	p := &Pool[J]{jobs: make(chan J, queueSize), handler: handler}
	p.workers.Add(workers)
	for range workers {
		go p.work()
	}
	return p
}

// Submit queues job, blocking while the queue is full. It returns ErrClosed
// if Shutdown has started; a nil return means the job will be handled.
func (p *Pool[J]) Submit(job J) error {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return ErrClosed
	}
	p.mu.Unlock()
	// BUG: from here on nothing stops Shutdown from closing p.jobs.

	testHookSubmitAdmitted()
	p.jobs <- job
	return nil
}

// Shutdown stops accepting jobs, waits until every accepted job has been
// handled and all workers have exited. Every call, including concurrent and
// repeated ones, returns only after that.
func (p *Pool[J]) Shutdown() {
	p.mu.Lock()
	first := !p.closed
	p.closed = true
	p.mu.Unlock()
	testHookShutdownMarked()

	// Only the first call closes: closing a closed channel panics.
	if first {
		close(p.jobs)
		testHookShutdownClosed()
	}
	p.workers.Wait()
}

func (p *Pool[J]) work() {
	defer p.workers.Done()
	// range keeps receiving buffered jobs after close and stops only once
	// the channel is closed and drained, so no accepted job is dropped.
	for job := range p.jobs {
		p.handler(job)
	}
}
