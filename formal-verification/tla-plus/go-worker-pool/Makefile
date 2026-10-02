# go-worker-pool: Submit racing Shutdown in a Go worker pool, model-checked
# with TLA+ and replayed against the real code. See README.md.
#
#   make all      test + verify
#   make test     go vet, gofmt check, go test -race (functional + replay tests)
#   make verify   PlusCal translations are fresh; every TLC model gives its EXPECTed outcome
#   make replay   only the counterexample replay tests, verbosely
#   make demo     stress the real pools without hooks; then the same under the race detector
#   make pcal     re-translate the PlusCal specs after editing them

GO         ?= go
TLA        := ../tools/tla.sh
PCAL_SPECS := spec/WorkerPoolBuggy.tla spec/WorkerPoolFixed.tla spec/WorkerPoolFixedMutex.tla \
              spec/WorkerPoolQuit.tla spec/GoChanCheck.tla
DEMO_RUNS  ?= 20000
RACE_RUNS  ?= 500
RACE_PROCS ?= 300

.PHONY: all test verify replay demo pcal

all: test verify

test:
	$(GO) vet ./...
	@out="$$(gofmt -l .)"; if [ -n "$$out" ]; then echo "gofmt: unformatted files:"; echo "$$out"; exit 1; fi
	$(GO) test -race -count=1 ./...

verify:
	$(TLA) pcal-check $(PCAL_SPECS)
	$(TLA) check spec

replay:
	$(GO) test -race -count=1 -v -run Replay ./...

demo:
	$(GO) run ./cmd/stress -runs $(DEMO_RUNS)
	scripts/race-demo.sh $(RACE_RUNS) $(RACE_PROCS)

pcal:
	$(TLA) pcal $(PCAL_SPECS)
