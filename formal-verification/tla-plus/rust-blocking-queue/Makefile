# rust-blocking-queue: a Mutex + Condvar blocking queue, buggy vs fixed, checked with TLA+.
#
#   make test     cargo fmt --check, clippy -D warnings, cargo test
#   make verify   TLC: every model in spec/ must produce the outcome its EXPECT header names
#   make all      test + verify
#   make trace    record fresh logs from real runs and trace-validate them with TLC
#   make demo     stress the real queues under a watchdog and count how often they hang
#   make sweep    the buggy spec for 120 sizes: deadlock iff producers + consumers > 2 x capacity
CARGO ?= cargo
TLA   := ../tools/tla.sh
TRACE_DIR := target/traces
TRACE_SPECS := spec/BlockingQueueCommon.tla spec/BlockingQueue.tla spec/BlockingQueueFixed.tla \
               spec/BlockingQueueNotifyAll.tla spec/BlockingQueueTransitionMutant.tla \
               spec/BlockingQueueDesigns.tla spec/TraceBlockingQueue.tla

.PHONY: all test verify trace demo sweep clean

all: test verify

test:
	$(CARGO) fmt --check
	$(CARGO) clippy --all-targets -- -D warnings
	$(CARGO) test

verify:
	$(TLA) check spec

# Fresh logs land in target/traces (ignored by git) next to copies of the specs, because TLC
# resolves EXTENDS in the directory of the module it checks.
trace:
	$(CARGO) build --release --bin trace
	rm -rf $(TRACE_DIR) && mkdir -p $(TRACE_DIR) && cp $(TRACE_SPECS) $(TRACE_DIR)/
	target/release/trace --variant fixed --producers 2 --consumers 1 --capacity 1 --items 3 \
	  --out $(TRACE_DIR) --name TraceRunFixed
	target/release/trace --variant fixed --producers 3 --consumers 3 --capacity 2 --items 5 \
	  --out $(TRACE_DIR) --name TraceRunFixedP3C3K2
	target/release/trace --variant notify_all --producers 2 --consumers 2 --capacity 1 --items 4 \
	  --out $(TRACE_DIR) --name TraceRunNotifyAll
	target/release/trace --variant buggy --producers 2 --consumers 1 --capacity 1 --items 3 \
	  --until-hang --trials 1000 --out $(TRACE_DIR) --name TraceRunBuggyHang
	$(TLA) check $(TRACE_DIR)
	@echo "Same logs with Spurious = FALSE (informational):"
	@for cfg in $(TRACE_DIR)/*NoSpurious.cfg; do \
	  base=$${cfg%NoSpurious.cfg}; rc=0; \
	  $(TLA) tlc $$base.tla $$cfg >/dev/null 2>&1 || rc=$$?; \
	  case $$rc in \
	    12) echo "  $$(basename $$base): accepted, every wakeup is explained by a notify";; \
	    0)  echo "  $$(basename $$base): REJECTED, the run needed a spurious (extra) wakeup";; \
	    *)  echo "  $$(basename $$base): TLC error $$rc"; exit 1;; \
	  esac; \
	done

demo:
	$(CARGO) build --release --bin demo
	target/release/demo --trials 200 --producers 2 --consumers 1 --capacity 1 --items 100 --stall-ms 50
	target/release/demo --trials 1000 --producers 4 --consumers 3 --capacity 3 --items 200 --stall-ms 50
	target/release/demo --trials 200 --producers 1 --consumers 1 --capacity 1 --items 1000 --stall-ms 50

sweep:
	./sweep.sh

clean:
	$(CARGO) clean
