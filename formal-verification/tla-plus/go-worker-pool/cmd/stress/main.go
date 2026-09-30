// Command stress races Submit against Shutdown on the real pools, without
// any test hooks, and reports how often each bug actually fires:
//
//	go run ./cmd/stress                  # all variants, both load profiles
//	go run ./cmd/stress -variant buggy -runs 5000
//	go run -race ./cmd/stress -variant buggy   # see what the race detector says
//	scripts/race-demo.sh                 # that, for every variant, summarised
//
// Each run: `submitters` goroutines submit `jobs` jobs each; once a quarter of
// all jobs have been accepted another goroutine calls Shutdown. A run counts
// as "panicked" if any Submit panicked, and as "lost work" if a job whose
// Submit returned nil was not handled by the time Shutdown returned.
package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/xoriors/experimental/formal-verification/tla-plus/go-worker-pool/buggy"
	"github.com/xoriors/experimental/formal-verification/tla-plus/go-worker-pool/fixed"
	"github.com/xoriors/experimental/formal-verification/tla-plus/go-worker-pool/quitchan"
)

type pool interface {
	Submit(int) error
	Shutdown()
}

var variants = []struct {
	name string
	new  func(workers, queue int, h func(int)) pool
}{
	{"buggy", func(w, q int, h func(int)) pool { return buggy.New(w, q, h) }},
	{"quitchan", func(w, q int, h func(int)) pool { return quitchan.New(w, q, h) }},
	{"fixed", func(w, q int, h func(int)) pool { return fixed.New(w, q, h) }},
}

// A load profile. "idle": big queue, instant handler -- senders almost never
// block, so the only window is the few instructions between Submit's check
// and its send. "backpressure": tiny queue, slow handler -- admitted senders
// sit blocked on the full queue, which widens the window enormously.
type load struct {
	name          string
	workers       int
	queue         int
	submitters    int
	jobs          int
	handlerSpinNs time.Duration
}

var loads = []load{
	{"idle", 4, 1024, 4, 64, 0},
	{"backpressure", 2, 1, 4, 64, 2 * time.Microsecond},
}

type result struct {
	panicked, lostRuns, lostJobs, doubleRuns, accepted int
}

func spin(d time.Duration) {
	for start := time.Now(); time.Since(start) < d; {
	}
}

func runOnce(newPool func(int, int, func(int)) pool, l load) (panicked bool, lost, doubles, accepted int) {
	total := l.submitters * l.jobs
	handled := make([]atomic.Int32, total)
	p := newPool(l.workers, l.queue, func(j int) {
		spin(l.handlerSpinNs)
		handled[j].Add(1)
	})

	ok := make([]atomic.Bool, total) // Submit(j) returned nil
	var nAccepted atomic.Int32
	quarter := make(chan struct{})
	start := make(chan struct{})
	var panics atomic.Int32
	var wg sync.WaitGroup
	for s := range l.submitters {
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					if !strings.Contains(fmt.Sprint(r), "send on closed channel") {
						panic(r)
					}
					panics.Add(1)
				}
			}()
			<-start
			for i := range l.jobs {
				j := s*l.jobs + i
				if p.Submit(j) != nil {
					return
				}
				ok[j].Store(true)
				// Add returns each count to exactly one caller: one close.
				if int(nAccepted.Add(1)) == total/4 {
					close(quarter)
				}
			}
		}()
	}
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()

	handledAtShutdown := make([]int32, total)
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		select {
		case <-quarter:
		case <-done:
		}
		p.Shutdown()
		for j := range handledAtShutdown {
			handledAtShutdown[j] = handled[j].Load()
		}
	}()
	close(start)
	<-done
	<-shutdownDone

	for j := range total {
		if ok[j].Load() {
			accepted++
			if handledAtShutdown[j] == 0 {
				lost++
			}
		}
		if handled[j].Load() > 1 {
			doubles++
		}
	}
	return panics.Load() > 0, lost, doubles, accepted
}

func main() {
	runs := flag.Int("runs", 10000, "runs per variant and load profile")
	only := flag.String("variant", "all", "buggy, quitchan, fixed or all")
	onlyLoad := flag.String("load", "all", "idle, backpressure or all")
	flag.Parse()

	fmt.Printf("%-9s %-13s %7s %16s %16s %12s %10s\n",
		"variant", "load", "runs", "runs w/ panic", "runs w/ lost", "lost jobs", "accepted")
	fixedFailed := false
	for _, v := range variants {
		if *only != "all" && *only != v.name {
			continue
		}
		for _, l := range loads {
			if *onlyLoad != "all" && *onlyLoad != l.name {
				continue
			}
			var r result
			for range *runs {
				panicked, lost, doubles, accepted := runOnce(v.new, l)
				if panicked {
					r.panicked++
				}
				if lost > 0 {
					r.lostRuns++
					r.lostJobs += lost
				}
				if doubles > 0 {
					r.doubleRuns++
				}
				r.accepted += accepted
			}
			fmt.Printf("%-9s %-13s %7d %9d (%5.2f%%) %9d (%5.2f%%) %12d %10d\n",
				v.name, l.name, *runs,
				r.panicked, pct(r.panicked, *runs),
				r.lostRuns, pct(r.lostRuns, *runs),
				r.lostJobs, r.accepted)
			if r.doubleRuns > 0 {
				fmt.Printf("    %d runs handled a job twice\n", r.doubleRuns)
			}
			if v.name == "fixed" && (r.panicked > 0 || r.lostRuns > 0 || r.doubleRuns > 0) {
				fmt.Fprintf(os.Stderr, "stress: the fixed pool violated a property (%s load)\n", l.name)
				fixedFailed = true
			}
		}
	}
	if fixedFailed {
		os.Exit(1)
	}
}

func pct(n, d int) float64 { return 100 * float64(n) / float64(d) }
