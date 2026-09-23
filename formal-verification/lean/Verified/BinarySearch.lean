import Verified.Sorting

/-!
# Binary search

Reference model for `src/search.ts`. It copies the TypeScript loop step for step
(half-open window `[lo, hi)`, the same midpoint, the same three-way branch), so on arrays
with duplicates it returns the *same* index as the implementation, not merely *an*
index. The `while` loop becomes a recursive function whose termination Lean checks:
the window `hi - lo` shrinks on every step.
-/

namespace Verified.BinarySearch

/-- Sorted in non-decreasing order: the same notion as for `insertionSort`. -/
abbrev Sorted (xs : Array Int) : Prop := Sorting.Sorted xs.toList

theorem Sorted.le {xs : Array Int} (h : Sorted xs) {i j : Nat} (hij : i ≤ j)
    (hj : j < xs.size) : xs[i] ≤ xs[j] := by
  rcases Nat.lt_or_eq_of_le hij with hij | rfl
  · have := List.pairwise_iff_getElem.mp h i j (by simpa using Nat.lt_trans hij hj)
      (by simpa using hj) hij
    simpa using this
  · exact Int.le_refl _

/-- The loop `while (lo < hi)`, run from the window `[lo, hi)`. The hypothesis
`hi ≤ xs.size` makes every read `xs[mid]` provably in bounds, so the model has no
out-of-bounds case at all. -/
def go (xs : Array Int) (target : Int) (lo hi : Nat) (hhi : hi ≤ xs.size) : Option Nat :=
  if h : lo < hi then
    let mid := lo + (hi - lo) / 2
    have : mid < xs.size := by omega
    if xs[mid] = target then some mid
    else if xs[mid] < target then go xs target (mid + 1) hi hhi
    else go xs target lo mid (by omega)
  else none
termination_by hi - lo

/-- `binarySearch` in TypeScript; `none` is its `-1`. -/
def search (xs : Array Int) (target : Int) : Option Nat :=
  go xs target 0 xs.size (Nat.le_refl _)

theorem go_sound {xs : Array Int} {target : Int} {lo hi : Nat} {hhi : hi ≤ xs.size}
    {i : Nat} (h : go xs target lo hi hhi = some i) :
    lo ≤ i ∧ i < hi ∧ ∃ hi' : i < xs.size, xs[i] = target := by
  fun_induction go xs target lo hi hhi with
  | case1 lo hi hhi hlt mid hmid heq =>
    simp at h
    subst h
    exact ⟨by omega, by omega, hmid, heq⟩
  | case2 lo hi hhi hlt mid hmid hne hless ih =>
    have : mid = lo + (hi - lo) / 2 := rfl
    obtain ⟨h₁, h₂, h₃⟩ := ih h
    exact ⟨by omega, h₂, h₃⟩
  | case3 lo hi hhi hlt mid hmid hne hless ih =>
    have : mid = lo + (hi - lo) / 2 := rfl
    obtain ⟨h₁, h₂, h₃⟩ := ih h
    exact ⟨h₁, by omega, h₃⟩
  | case4 => simp at h

/-- **Theorem (soundness).** A returned index really holds the target. This needs no
sortedness at all: on unsorted input the search may miss, but it never lies. -/
theorem search_sound {xs : Array Int} {target : Int} {i : Nat}
    (h : search xs target = some i) : ∃ hi : i < xs.size, xs[i] = target :=
  (go_sound h).2.2

theorem go_complete {xs : Array Int} {target : Int} (hs : Sorted xs) {lo hi : Nat}
    {hhi : hi ≤ xs.size} {k : Nat} (hlo : lo ≤ k) (hk : k < hi)
    (hkt : xs[k]'(by omega) = target) : (go xs target lo hi hhi).isSome := by
  fun_induction go xs target lo hi hhi with
  | case1 => simp
  | case2 lo hi hhi hlt mid hmid hne hless ih =>
    -- `xs[mid] < target`, so every index `≤ mid` holds something `< target`:
    -- the target can only be to the right of `mid`.
    have hmk : mid < k := Nat.lt_of_not_le fun hkm => by
      have := hs.le hkm hmid
      omega
    exact ih hmk hk hkt
  | case3 lo hi hhi hlt mid hmid hne hless ih =>
    -- `xs[mid] > target`, so every index `≥ mid` holds something `> target`:
    -- the target can only be to the left of `mid`.
    have hkm : k < mid := Nat.lt_of_not_le fun hmk => by
      have := hs.le hmk (by omega)
      omega
    exact ih hlo hkm hkt
  | case4 => omega

/-- **Theorem (completeness).** On a sorted array, if the target is present it is found. -/
theorem search_complete {xs : Array Int} {target : Int} (hs : Sorted xs)
    (hmem : target ∈ xs) : (search xs target).isSome := by
  obtain ⟨k, hk, rfl⟩ := Array.mem_iff_getElem.mp hmem
  exact go_complete hs (Nat.zero_le k) hk rfl

/-- **Theorem.** On a sorted array, `binarySearch(xs, t) === -1` exactly when `t` is absent. -/
theorem search_eq_none_iff {xs : Array Int} {target : Int} (hs : Sorted xs) :
    search xs target = none ↔ target ∉ xs := by
  constructor
  · intro h hmem
    have := search_complete hs hmem
    simp_all
  · intro hmem
    cases h : search xs target with
    | none => rfl
    | some i =>
      obtain ⟨hi, rfl⟩ := search_sound h
      exact absurd (Array.getElem_mem hi) hmem

/-- **Theorem (composition).** Searching the output of the verified sort finds exactly the
elements of the original, unsorted list. Two verified pieces compose into a verified whole. -/
theorem search_after_sort (l : List Int) (target : Int) :
    (search (Sorting.insertionSort l).toArray target).isSome ↔ target ∈ l := by
  have hs : Sorted (Sorting.insertionSort l).toArray := by
    simpa [Sorted] using Sorting.insertionSort_sorted l
  have hperm := Sorting.insertionSort_perm l
  constructor
  · intro h
    cases hr : search (Sorting.insertionSort l).toArray target with
    | none => simp [hr] at h
    | some i =>
      obtain ⟨hi, rfl⟩ := search_sound hr
      exact hperm.mem_iff.mp (by simp)
  · intro h
    exact search_complete hs (by simp [hperm.mem_iff.mpr h])

end Verified.BinarySearch
