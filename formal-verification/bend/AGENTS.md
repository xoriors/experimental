# AGENTS.md

When using Bend:
- run `bend guide` to learn it
- use `LAWS.bend` to keep important rules
- run `bend PROOF.bend` before committing
- parallelize the code whenever possible

## This project

- `LAWS.bend` is the spec. It is written by a human; do not edit it to make a
  proof go through. If a law looks wrong, say so instead.
- `PROOF.bend` proves every law in `LAWS.bend` (law `x` is proven by
  `def Laws.x`). Helper lemmas live there too.
- `tree.bend` is the code under test; `main.bend` is the runnable program.
- `bend PROOF.bend` must print `All terms check.` before any commit.
