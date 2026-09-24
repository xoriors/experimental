import Verified

/-!
# The oracle

Compiles the proven models into a native executable that the TypeScript test suite
drives over stdin/stdout. The answers come from the very definitions the theorems are
about. The parsing and printing around them are not proven; the `#guard` examples at the
bottom pin them down, and the build fails if one is wrong.

Protocol: one request per line, one response per line, flushed immediately so the TS side
can hold a single long-lived process and ask thousands of questions. Integers are
space-separated and groups are separated by `;`.

| request                               | response                                  |
|---------------------------------------|-------------------------------------------|
| `sort 3 1 2`                          | `1 2 3`                                   |
| `search 7 ; 1 3 7 9`                  | `2` (or `-1` when absent)                 |
| `encode 5 5 2`                        | `5 2 ; 2 1`                               |
| `decode 5 2 ; 2 1`                    | `5 5 2`                                   |
| `transfer 0 1 30 ; 100 0`             | `ok 70 30` or `err InsufficientFunds`     |
| `settle 100 0 ; 0 1 30 ; 1 0 99`      | `70 30`                                   |

A malformed request gets `error <reason>`; the TS client treats that as a test failure.
-/

open Verified

namespace Oracle

def words (s : String) : List String :=
  (s.splitOn " ").filter (· ≠ "")

def parseInts (s : String) : Except String (List Int) :=
  (words s).mapM fun w => match w.toInt? with
    | some i => .ok i
    | none => .error s!"not an integer: {w}"

def parseInt (s : String) : Except String Int := do
  match ← parseInts s with
  | [i] => return i
  | _ => throw s!"expected one integer: {s}"

def showInts (xs : List Int) : String :=
  " ".intercalate (xs.map toString)

/-- Split the payload into `;`-separated groups, dropping blank ones. -/
def groups (s : String) : List String :=
  (s.splitOn ";").filter fun g => !(words g).isEmpty

def parseRun (g : String) : Except String RunLength.Run := do
  match ← parseInts g with
  | [v, n] => if n < 0 then throw s!"negative count: {g}" else return (v, n.toNat)
  | _ => throw s!"expected `value count`: {g}"

def showRuns (runs : List RunLength.Run) : String :=
  " ; ".intercalate (runs.map fun (v, n) => s!"{v} {n}")

def parseTransfer (g : String) : Except String Ledger.Transfer := do
  match ← parseInts g with
  | [src, dst, amount] => return { src, dst, amount }
  | _ => throw s!"expected `src dst amount`: {g}"

def errorName : Ledger.TransferError → String
  | .invalidAccount => "InvalidAccount"
  | .sameAccount => "SameAccount"
  | .invalidAmount => "InvalidAmount"
  | .insufficientFunds => "InsufficientFunds"
  | .overflow => "Overflow"

def parseSearch (payload : String) : Except String (Int × List Int) :=
  match payload.splitOn ";" with
  | [t, xs] => do return (← parseInt t, ← parseInts xs)
  | _ => throw "expected `target ; xs`"

def parseTransferReq (payload : String) : Except String (Ledger.Transfer × List Int) :=
  match payload.splitOn ";" with
  | [t, bs] => do return (← parseTransfer t, ← parseInts bs)
  | _ => throw "expected `src dst amount ; balances`"

def parseSettle (payload : String) : Except String (List Int × List Ledger.Transfer) :=
  match payload.splitOn ";" with
  | bs :: ts => do
    return (← parseInts bs, ← (ts.filter fun g => !(words g).isEmpty).mapM parseTransfer)
  | [] => throw "expected `balances ; transfers`"

def answer (cmd payload : String) : Except String String := do
  match cmd with
  | "sort" =>
    return showInts (Sorting.insertionSort (← parseInts payload))
  | "search" =>
    let (target, xs) ← parseSearch payload
    return match BinarySearch.search xs.toArray target with
      | some i => toString i
      | none => "-1"
  | "encode" =>
    return showRuns (RunLength.encode (← parseInts payload))
  | "decode" =>
    return showInts (RunLength.decode (← (groups payload).mapM parseRun))
  | "transfer" =>
    let (t, bs) ← parseTransferReq payload
    return match Ledger.transfer bs t.src t.dst t.amount with
      | .ok bs' => " ".intercalate ("ok" :: bs'.map toString)
      | .error e => s!"err {errorName e}"
  | "settle" =>
    let (bs, ts) ← parseSettle payload
    return showInts (Ledger.settle bs ts)
  | _ => throw s!"unknown command: {cmd}"

def respond (line : String) : String :=
  let line := line.trimAscii.toString
  let (cmd, payload) := match line.splitOn " " with
    | cmd :: rest => (cmd, " ".intercalate rest)
    | [] => ("", "")
  match answer cmd payload with
  | .ok out => out
  | .error msg => s!"error {msg}"

/-! Protocol examples, evaluated at compile time. -/
#guard respond "sort 3 1 2" == "1 2 3"
#guard respond "sort" == ""
#guard respond "search 7 ; 1 3 7 9" == "2"
#guard respond "search 4 ; 1 3 7 9" == "-1"
#guard respond "search 4 ;" == "-1"
#guard respond "encode 5 5 2" == "5 2 ; 2 1"
#guard respond "encode" == ""
#guard respond "decode 5 2 ; 2 1" == "5 5 2"
#guard respond "decode" == ""
#guard respond "transfer 0 1 30 ; 100 0" == "ok 70 30"
#guard respond "transfer 0 1 300 ; 100 0" == "err InsufficientFunds"
#guard respond "transfer 0 0 30 ; 100 0" == "err SameAccount"
#guard respond "transfer 0 1 1 ; 100 9007199254740991" == "err Overflow"
#guard respond "transfer 0 1 9007199254740992 ; 100 0" == "err InvalidAmount"
#guard respond "settle 100 0 ; 0 1 30 ; 1 0 99" == "70 30"
#guard respond "settle 100 0" == "100 0"
#guard respond "sort 1 x" == "error not an integer: x"

end Oracle

def main : IO Unit := do
  let stdin ← IO.getStdin
  let stdout ← IO.getStdout
  repeat
    let line ← stdin.getLine
    -- `getLine` keeps the newline, so only true end-of-input is the empty string.
    if line.isEmpty then break
    stdout.putStrLn (Oracle.respond line)
    stdout.flush
