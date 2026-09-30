// Package quitchan is the "never close the job channel" worker pool:
// Shutdown closes a separate quit channel, and Submit and the workers select
// on it. Nothing is ever sent on a closed channel, so it cannot panic, and
// there is no data race for the race detector to report -- yet it silently
// loses accepted jobs, because select does not prefer the case written
// first: when both cases are ready it picks one uniformly at random.
//
// DO NOT USE. It is kept as the counterexample for spec/WorkerPoolQuit.tla.
package quitchan

import (
	"errors"
	"sync"
)

// ErrClosed is returned by Submit once Shutdown has started (sometimes).
var ErrClosed = errors.New("workerpool: pool is shut down")

// Test hook at an interleaving point of the TLA+ spec (no-op in production).
var testHookWorkerDrained = func() {} // between labels w_drain and w_exit

// Pool runs handler on accepted jobs using a fixed set of workers.
type Pool[J any] struct {
	jobs    chan J
	quit    chan struct{}
	once    sync.Once
	workers sync.WaitGroup
	handler func(J)
}

// New starts workers goroutines that call handler for each submitted job.
func New[J any](workers, queueSize int, handler func(J)) *Pool[J] {
	if workers < 1 || queueSize < 1 {
		panic("workerpool: need workers >= 1 and queueSize >= 1")
	}
	p := &Pool[J]{
		jobs:    make(chan J, queueSize),
		quit:    make(chan struct{}),
		handler: handler,
	}
	p.workers.Add(workers)
	for range workers {
		go p.work()
	}
	return p
}

// Submit queues job, blocking while the queue is full.
func (p *Pool[J]) Submit(job J) error {
	select {
	case <-p.quit:
		return ErrClosed
	case p.jobs <- job: // BUG: if quit is closed too, still chosen half the time
		return nil
	}
}

// Shutdown signals the workers to finish and waits for them.
func (p *Pool[J]) Shutdown() {
	p.once.Do(func() { close(p.quit) }) // repeated calls must not close twice
	p.workers.Wait()
}

func (p *Pool[J]) work() {
	defer p.workers.Done()
	for {
		select {
		case job := <-p.jobs:
			p.handler(job)
		case <-p.quit:
			// Finish what is already queued, then exit. A job that Submit
			// enqueues after this loop saw an empty queue is never handled.
			for {
				select {
				case job := <-p.jobs:
					p.handler(job)
				default:
					testHookWorkerDrained()
					return
				}
			}
		}
	}
}
