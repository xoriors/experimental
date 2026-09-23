/-!
# Sorting

Reference model for `src/sort.ts`.

The TypeScript implementation is a bottom-up **merge sort**. The model here is a plain
**insertion sort**, which is a different algorithm, and that is on purpose: we prove
below (`sorted_unique`) that a sorted permutation of a list is unique. So *any* correct
sort must give exactly the output of this one, and the differential tests may compare
the fast TypeScript sort against this slow-but-obviously-right model element for
element.
-/

namespace Verified.Sorting

/-- `l` is in non-decreasing order. -/
abbrev Sorted (l : List Int) : Prop := l.Pairwise (· ≤ ·)

/-- Insert `x` in front of the first element that is `≥ x`. -/
def insert (x : Int) : List Int → List Int
  | [] => [x]
  | y :: ys => if x ≤ y then x :: y :: ys else y :: insert x ys

def insertionSort : List Int → List Int
  | [] => []
  | x :: xs => insert x (insertionSort xs)

theorem insert_perm (x : Int) (l : List Int) : (insert x l).Perm (x :: l) := by
  induction l with
  | nil => simp [insert]
  | cons y ys ih =>
    unfold insert
    split
    · exact .refl _
    · exact (ih.cons y).trans (.swap x y ys)

theorem mem_insert {x z : Int} {l : List Int} : z ∈ insert x l ↔ z = x ∨ z ∈ l := by
  simpa using (insert_perm x l).mem_iff

theorem insert_sorted (x : Int) {l : List Int} (h : Sorted l) : Sorted (insert x l) := by
  induction l with
  | nil => simp [insert]
  | cons y ys ih =>
    obtain ⟨hy, hys⟩ := List.pairwise_cons.mp h
    unfold insert
    split
    · refine List.Pairwise.cons ?_ h
      intro z hz
      rcases List.mem_cons.mp hz with rfl | hz
      · assumption
      · exact Int.le_trans ‹x ≤ y› (hy z hz)
    · refine List.Pairwise.cons ?_ (ih hys)
      intro z hz
      rcases mem_insert.mp hz with rfl | hz
      · omega
      · exact hy z hz

/-- **Theorem.** The output is sorted. -/
theorem insertionSort_sorted (l : List Int) : Sorted (insertionSort l) := by
  induction l with
  | nil => simp [insertionSort]
  | cons x xs ih => exact insert_sorted x ih

/-- **Theorem.** The output is a permutation of the input: nothing lost, nothing added,
duplicates kept. -/
theorem insertionSort_perm (l : List Int) : (insertionSort l).Perm l := by
  induction l with
  | nil => simp [insertionSort]
  | cons x xs ih => exact (insert_perm x _).trans (ih.cons x)

/-- **Theorem.** Sorted permutations are unique: two sorted lists holding the same
elements are equal. This is what lets a merge sort be tested against an insertion sort. -/
theorem sorted_unique {l₁ l₂ : List Int} (h₁ : Sorted l₁) (h₂ : Sorted l₂)
    (hp : l₁.Perm l₂) : l₁ = l₂ :=
  hp.eq_of_pairwise (fun _ _ _ _ hab hba => Int.le_antisymm hab hba) h₁ h₂

/-- **Theorem.** Any function that sorts and permutes is `insertionSort`. -/
theorem eq_insertionSort (f : List Int → List Int)
    (hs : ∀ l, Sorted (f l)) (hp : ∀ l, (f l).Perm l) (l : List Int) :
    f l = insertionSort l :=
  sorted_unique (hs l) (insertionSort_sorted l) ((hp l).trans (insertionSort_perm l).symm)

/-- **Theorem.** Sorting is idempotent. -/
theorem insertionSort_idem (l : List Int) :
    insertionSort (insertionSort l) = insertionSort l :=
  sorted_unique (insertionSort_sorted _) (insertionSort_sorted _) (insertionSort_perm _)

end Verified.Sorting
