/-!
# Run-length encoding

Reference model for `src/rle.ts`. `encode [5, 5, 5, 2, 5]` is `[(5, 3), (2, 1), (5, 1)]`.

The TypeScript encoder is a left-to-right loop that bumps the count of the last run.
The model below recurses from the right instead, because that shape is easy to reason
about. The two are *not* proven equal here; the differential tests check that they
agree, which is the division of labour this project demonstrates.
-/

namespace Verified.RunLength

abbrev Run := Int × Nat

def encode : List Int → List Run
  | [] => []
  | x :: xs =>
    match encode xs with
    | [] => [(x, 1)]
    | (y, n) :: runs => if x = y then (y, n + 1) :: runs else (x, 1) :: (y, n) :: runs

def decode (runs : List Run) : List Int :=
  runs.flatMap fun (v, n) => List.replicate n v

/-- A run list is canonical when every count is positive and neighbouring runs hold
different values. These are exactly the lists `encode` can produce. -/
def Canonical : List Run → Prop
  | [] => True
  | [(_, n)] => 0 < n
  | (v, n) :: (w, m) :: runs => 0 < n ∧ v ≠ w ∧ Canonical ((w, m) :: runs)

/-- Unfold `encode` on a cons cell only (plain `unfold` would also unfold the recursive
call on the right-hand side). -/
theorem encode_cons (x : Int) (xs : List Int) :
    encode (x :: xs) =
      match encode xs with
      | [] => [(x, 1)]
      | (y, n) :: runs => if x = y then (y, n + 1) :: runs else (x, 1) :: (y, n) :: runs :=
  rfl

@[simp] theorem decode_nil : decode [] = [] := rfl

@[simp] theorem decode_cons (v : Int) (n : Nat) (runs : List Run) :
    decode ((v, n) :: runs) = List.replicate n v ++ decode runs := rfl

/-- **Theorem (round trip).** Decoding an encoding gives back the input. -/
theorem decode_encode (xs : List Int) : decode (encode xs) = xs := by
  induction xs with
  | nil => rfl
  | cons x xs ih =>
    rw [encode_cons]
    split
    · rename_i h
      rw [h] at ih
      simp_all
    · rename_i y n runs h
      rw [h, decode_cons] at ih
      split
      · rename_i hxy
        subst hxy
        simp [List.replicate_succ, ih]
      · simp [ih]

/-- **Theorem.** Every encoding is canonical: no empty runs, and no two neighbouring runs
that should have been merged. -/
theorem encode_canonical (xs : List Int) : Canonical (encode xs) := by
  induction xs with
  | nil => trivial
  | cons x xs ih =>
    rw [encode_cons]
    split
    · simp [Canonical]
    · rename_i y n runs h
      rw [h] at ih
      split
      · -- `x` extends the first run: its count grows, its neighbours are unchanged.
        cases runs with
        | nil => simp [Canonical]
        | cons r runs =>
          obtain ⟨_, hne, hrest⟩ := ih
          exact ⟨by omega, hne, hrest⟩
      · -- `x` opens a new run in front of a run of a different value.
        refine ⟨by omega, by assumption, ih⟩

theorem canonical_tail {r : Run} {runs : List Run} (h : Canonical (r :: runs)) :
    Canonical runs := by
  match runs, h with
  | [], _ => trivial
  | _ :: _, h => exact h.2.2

/-- Prepending `n + 1` copies of `v` to a list whose encoding does not start with `v`
adds exactly one run. -/
theorem encode_replicate_append (v : Int) (n : Nat) (ys : List Int)
    (h : ∀ m runs, encode ys ≠ (v, m) :: runs) :
    encode (List.replicate (n + 1) v ++ ys) = (v, n + 1) :: encode ys := by
  induction n with
  | zero =>
    rw [List.replicate_one, List.singleton_append, encode_cons]
    cases he : encode ys with
    | nil => rfl
    | cons r runs =>
      obtain ⟨y, m⟩ := r
      have : v ≠ y := fun hvy => h m runs (by rw [he, hvy])
      simp [this]
  | succ n ih =>
    rw [List.replicate_succ, List.cons_append, encode_cons, ih]
    simp

/-- **Theorem (canonical round trip).** Encoding a decoded canonical run list gives it
back. Together with `decode_encode`, `encode` is a bijection between integer lists and
canonical run lists, so the encoding of a list is unique. -/
theorem encode_decode {runs : List Run} (h : Canonical runs) : encode (decode runs) = runs := by
  induction runs with
  | nil => rfl
  | cons r runs ih =>
    obtain ⟨v, n⟩ := r
    have hn : 0 < n := by
      cases runs with
      | nil => exact h
      | cons _ _ => exact h.1
    obtain ⟨n, rfl⟩ : ∃ k, n = k + 1 := ⟨n - 1, by omega⟩
    rw [decode_cons, encode_replicate_append, ih (canonical_tail h)]
    intro m rest he
    rw [ih (canonical_tail h)] at he
    subst he
    exact h.2.1 rfl

/-- **Theorem.** Encoding never produces more runs than there were elements. -/
theorem encode_length_le (xs : List Int) : (encode xs).length ≤ xs.length := by
  induction xs with
  | nil => simp [encode]
  | cons x xs ih =>
    rw [encode_cons]
    split
    · simp
    · rename_i y n runs h
      rw [h] at ih
      split <;> simp at ih ⊢ <;> omega

end Verified.RunLength
