# formal-verification

Experiments in proving concurrent code correct instead of hoping the tests hit the bad interleaving.

| Directory | Tool | What's in it |
| --- | --- | --- |
| [`tla-plus/`](./tla-plus/) | [TLA+](https://lamport.azurewebsites.net/tla/tla.html) and the TLC model checker | Two demos with real concurrent code, a Rust blocking queue and a Go worker pool. Each has a buggy and a fixed variant, a TLA+ spec of each, and a bridge that ties the spec back to the running code |

TLA+ checks the design: every interleaving of an abstract model. Other tools that could sit next to it
here check the implementation:

- **Rust**: [Loom](https://github.com/tokio-rs/loom) (explores the thread interleavings and memory
  orderings of real code), [Kani](https://github.com/model-checking/kani) (bounded model checking),
  [Verus](https://github.com/verus-lang/verus) and [Creusot](https://github.com/creusot-rs/creusot) (deductive proofs).
- **Go**: [Gobra](https://github.com/viperproject/gobra) (deductive verification).
- **Protocols**: [P](https://github.com/p-org/P), [Quint](https://github.com/informalsystems/quint),
  [Apalache](https://github.com/apalache-mc/apalache) (a symbolic model checker for TLA+).
