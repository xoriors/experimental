# ice-cube-simulator

A single-file, dependency-free canvas simulator answering one question: **why does ice
float in water, and what actually happens when it melts back into water?**

Open `index.html` in any browser — no build step, nothing to install. Responsive and
touch-friendly; it is built to be used on a phone.

## What it shows

- **The tank** — an ice cube floating with exactly **91.7 % submerged / 8.3 % above**
  the line (Archimedes: the submerged fraction *is* the density ratio). Drag the cube,
  push it under, let go — buoyancy bobs it back. Weight vs buoyancy arrows and the
  above/below percentages update live while it moves.
- **Molecular views** — two same-sized frames with live molecule counts: ice's open
  hexagonal lattice (H₂O molecules H-bonded at the honeycomb vertices, vibrating in
  place) next to liquid water (same molecules, no lattice, ~9 % more of them in the
  same frame). The ice frame is tied to the melt: the lattice collapses edge-first as
  the cube shrinks, bonds fade, freed molecules tumble into the holes, and extra
  molecules flow in until both frames match.
- **The exact numbers** — ρ_ice = 0.9167 g/cm³ and ρ_water = 0.9998 g/cm³ at 0 °C
  (CRC Handbook), ratio 0.9168 ≈ 11∶12, +9.1 % volume expansion on freezing, latent
  heat of fusion 334 J/g, and the fact that the water level never moves as floating
  ice melts.
- **Controls** — start/pause melting, reset, water temperature 0–40 °C (at exactly
  0 °C ice and water coexist and nothing melts).

## Implementation notes

- Buoyancy: `a = −g·(ρw/ρi · submergedFraction − 1)` with linear drag; pointer-event
  dragging with `touch-action: pan-y` so the page still scrolls on mobile unless the
  touch starts on the cube.
- Ice lattice: a honeycomb graph built from a hexagon tiling; each molecule's two H
  atoms point along its lattice bonds. Melt order runs from the frame edge inward;
  released molecules become soft-repulsion liquid particles that avoid still-frozen
  sites.
- Melt model: `dV/dt ∝ −A·ΔT` with `A ∝ V^⅔` — roughly ×30 faster than a real cube
  in still 20 °C water. Latent heat is represented by the cube staying at 0 °C.
- Theme-aware (light/dark via CSS tokens), respects `prefers-reduced-motion`,
  no external dependencies (Google Fonts only, with system fallbacks).
