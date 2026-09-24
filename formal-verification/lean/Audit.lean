import Lean
import Verified

/-!
# Axiom audit

A proof is only as trustworthy as what it assumes. This file fails the build unless
every theorem in the `Verified` namespace depends on nothing beyond Lean's three standard
axioms (`propext`, `Quot.sound`, `Classical.choice`). That rules out:

* `sorryAx`: an unfinished proof. `warningAsError` in the lakefile already catches
  these, and this is a second, independent check.
* `Lean.ofReduceBool`: `native_decide`, which trusts the compiler instead of the kernel.
* any `axiom` someone added to make a proof go through.
-/

open Lean Elab Command

elab "#audit_axioms" : command => do
  let env ← getEnv
  let standard := #[``propext, ``Quot.sound, ``Classical.choice]
  let theorems := env.constants.fold (init := #[]) fun acc name info =>
    if (`Verified).isPrefixOf name && !name.isInternal && info matches .thmInfo _ then
      acc.push name
    else acc
  if theorems.isEmpty then
    throwError "no theorems found under `Verified`: is the import right?"
  for name in theorems do
    let axioms ← collectAxioms name
    let extra := axioms.filter (!standard.contains ·)
    unless extra.isEmpty do
      throwError "{name} depends on non-standard axioms: {extra}"
  logInfo m!"{theorems.size} theorems under `Verified` use only {standard}"

#audit_axioms
