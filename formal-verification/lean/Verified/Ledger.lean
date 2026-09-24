/-!
# Ledger

Reference model for `src/ledger.ts`: account balances in minor units (cents), held in
an array indexed by account number, with a `transfer` that either succeeds or reports
exactly one error.

The guards are checked in the same order as in TypeScript, so the differential tests can
insist on the *same* error, not just "some" error. The model also includes JavaScript's
number limit: a JS `number` holds integers exactly only up to `2^53 - 1`
(`Number.MAX_SAFE_INTEGER`). The implementation rejects amounts above it
(`Number.isSafeInteger`) and any transfer that would push a balance past it, and the
theorems below show that balances therefore never leave the range where JS arithmetic
is exact.
-/

namespace Verified.Ledger

/-- `Number.MAX_SAFE_INTEGER`. -/
def maxSafe : Int := 2 ^ 53 - 1

inductive TransferError where
  | invalidAccount
  | sameAccount
  | invalidAmount
  | insufficientFunds
  | overflow
  deriving Repr, DecidableEq

def transfer (bs : List Int) (src dst amount : Int) : Except TransferError (List Int) :=
  if hs : 0 ≤ src ∧ src < bs.length then
    if hd : 0 ≤ dst ∧ dst < bs.length then
      if src = dst then .error .sameAccount
      else if amount ≤ 0 ∨ amount > maxSafe then .error .invalidAmount
      else
        have : src.toNat < bs.length := by omega
        have : dst.toNat < bs.length := by omega
        if bs[src.toNat] < amount then .error .insufficientFunds
        else if amount > maxSafe - bs[dst.toNat] then .error .overflow
        else .ok ((bs.set src.toNat (bs[src.toNat] - amount)).set dst.toNat
                    (bs[dst.toNat] + amount))
    else .error .invalidAccount
  else .error .invalidAccount

structure Transfer where
  src : Int
  dst : Int
  amount : Int

/-- Apply a batch in order. A rejected transfer is skipped and the batch carries on. -/
def settle (bs : List Int) : List Transfer → List Int
  | [] => bs
  | t :: ts =>
    match transfer bs t.src t.dst t.amount with
    | .ok bs' => settle bs' ts
    | .error _ => settle bs ts

/-- Every balance is a non-negative JS safe integer. -/
def Valid (bs : List Int) : Prop := ∀ b ∈ bs, 0 ≤ b ∧ b ≤ maxSafe

theorem sum_set (l : List Int) (i : Nat) (v : Int) (h : i < l.length) :
    (l.set i v).sum = l.sum - l[i] + v := by
  induction l generalizing i with
  | nil => simp at h
  | cons x xs ih =>
    cases i with
    | zero => simp; omega
    | succ i =>
      simp only [List.set_cons_succ, List.sum_cons, List.getElem_cons_succ]
      rw [ih i (by simpa using h)]
      omega

/-- Everything a successful transfer tells us, in one place. -/
theorem transfer_ok {bs bs' : List Int} {src dst amount : Int}
    (h : transfer bs src dst amount = .ok bs') :
    ∃ (hs : src.toNat < bs.length) (hd : dst.toNat < bs.length),
      0 ≤ src ∧ 0 ≤ dst ∧ src ≠ dst ∧ 0 < amount ∧ amount ≤ bs[src.toNat] ∧ bs[dst.toNat] + amount ≤ maxSafe ∧
      bs' = (bs.set src.toNat (bs[src.toNat] - amount)).set dst.toNat (bs[dst.toNat] + amount) := by
  unfold transfer at h
  split at h
  · split at h
    · split at h
      · simp at h
      · split at h
        · simp at h
        · dsimp only at h
          split at h
          · simp at h
          · split at h
            · simp at h
            · refine ⟨by omega, by omega, by omega, by omega, by assumption, by omega, by omega,
                by omega, ?_⟩
              simp only [Except.ok.injEq] at h
              exact h.symm
    · simp at h
  · simp at h

/-- **Theorem.** A transfer never changes the number of accounts. -/
theorem transfer_length {bs bs' : List Int} {src dst amount : Int}
    (h : transfer bs src dst amount = .ok bs') : bs'.length = bs.length := by
  obtain ⟨_, _, _, _, _, _, _, _, rfl⟩ := transfer_ok h
  simp

/-- **Theorem (conservation).** A transfer moves money; it never creates or destroys it. -/
theorem transfer_sum {bs bs' : List Int} {src dst amount : Int}
    (h : transfer bs src dst amount = .ok bs') : bs'.sum = bs.sum := by
  obtain ⟨hs, hd, _, _, hne, _, _, _, rfl⟩ := transfer_ok h
  have hne' : src.toNat ≠ dst.toNat := by omega
  rw [sum_set _ _ _ (by simpa using hd), sum_set _ _ _ hs, List.getElem_set_ne hne']
  omega

/-- **Theorem (safety).** If every balance is a non-negative JS safe integer before a
transfer, the same holds after it: no overdraft, and no balance JS cannot represent. -/
theorem transfer_valid {bs bs' : List Int} {src dst amount : Int} (hv : Valid bs)
    (h : transfer bs src dst amount = .ok bs') : Valid bs' := by
  obtain ⟨hs, hd, _, _, _, hpos, hfunds, hcap, rfl⟩ := transfer_ok h
  have hsrc := hv _ (List.getElem_mem hs)
  have hdst := hv _ (List.getElem_mem hd)
  intro b hb
  rcases List.mem_or_eq_of_mem_set hb with hb | rfl
  · rcases List.mem_or_eq_of_mem_set hb with hb | rfl
    · exact hv b hb
    · omega
  · omega

/-- **Theorem (conservation, any batch).** However a batch mixes good and bad transfers,
the total is the same afterwards. -/
theorem settle_sum (bs : List Int) (ts : List Transfer) : (settle bs ts).sum = bs.sum := by
  induction ts generalizing bs with
  | nil => rfl
  | cons t ts ih =>
    unfold settle
    split
    · rename_i bs' h
      rw [ih, transfer_sum h]
    · exact ih bs

/-- **Theorem (safety, any batch).** Validity is an invariant of the whole ledger. -/
theorem settle_valid {bs : List Int} (ts : List Transfer) (hv : Valid bs) :
    Valid (settle bs ts) := by
  induction ts generalizing bs with
  | nil => exact hv
  | cons t ts ih =>
    unfold settle
    split
    · rename_i bs' h
      exact ih (transfer_valid hv h)
    · exact ih hv

/-- **Theorem.** A batch never adds or removes accounts. -/
theorem settle_length (bs : List Int) (ts : List Transfer) :
    (settle bs ts).length = bs.length := by
  induction ts generalizing bs with
  | nil => rfl
  | cons t ts ih =>
    unfold settle
    split
    · rename_i bs' h
      rw [ih, transfer_length h]
    · exact ih bs

/-! ### Why the `sameAccount` guard exists

The obvious implementation computes both new balances from the *old* array. Without the
`src = dst` guard, a self-transfer then credits the account without debiting it. Lean
finds this by evaluation: the counterexample below is checked by the kernel with `rfl`. The
TypeScript mutant `mutants/ledger-self-transfer.ts` has the same bug, and the mutant
tests show the Lean oracle catching it. -/

/-- `transfer` with the `sameAccount` guard deleted. -/
def transferNoGuard (bs : List Int) (src dst amount : Int) : Except TransferError (List Int) :=
  if hs : 0 ≤ src ∧ src < bs.length then
    if hd : 0 ≤ dst ∧ dst < bs.length then
      if amount ≤ 0 ∨ amount > maxSafe then .error .invalidAmount
      else
        have : src.toNat < bs.length := by omega
        have : dst.toNat < bs.length := by omega
        if bs[src.toNat] < amount then .error .insufficientFunds
        else if amount > maxSafe - bs[dst.toNat] then .error .overflow
        else .ok ((bs.set src.toNat (bs[src.toNat] - amount)).set dst.toNat
                    (bs[dst.toNat] + amount))
    else .error .invalidAccount
  else .error .invalidAccount

/-- **Counterexample.** Moving 5 from account 0 to itself turns 10 into 15. -/
theorem transferNoGuard_mints_money : transferNoGuard [10] 0 0 5 = .ok [15] := rfl

end Verified.Ledger
