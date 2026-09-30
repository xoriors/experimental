# Formal verification demos with TLA+.
#
#   make verify   model-check every spec; each model asserts its expected outcome
#   make test     run the Rust and Go test suites
#   make all      both
PROJECTS := rust-blocking-queue go-worker-pool

.PHONY: all verify test fetch $(PROJECTS)

all: test verify

fetch:
	tools/tla.sh fetch

verify: fetch
	@for p in $(PROJECTS); do $(MAKE) --no-print-directory -C $$p verify || exit 1; done

test:
	@for p in $(PROJECTS); do $(MAKE) --no-print-directory -C $$p test || exit 1; done
