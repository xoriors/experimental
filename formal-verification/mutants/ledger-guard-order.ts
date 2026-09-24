import type { TransferResult } from '../src/ledger';

// MUTANT of src/ledger.ts. Bug: the amount is checked before the same-account guard, so a
// self-transfer of a bad amount reports `InvalidAmount` instead of `SameAccount`. Money is
// never at risk, so every restated theorem still holds; only the differential test, which
// pins the exact error, notices.
export function transfer(
  balances: readonly number[],
  from: number,
  to: number,
  amount: number,
): TransferResult {
  const isAccount = (id: number) => Number.isInteger(id) && id >= 0 && id < balances.length;
  if (!isAccount(from) || !isAccount(to)) return { ok: false, error: 'InvalidAccount' };
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, error: 'InvalidAmount' };
  }
  if (from === to) return { ok: false, error: 'SameAccount' };
  if (balances[from] < amount) return { ok: false, error: 'InsufficientFunds' };
  if (amount > Number.MAX_SAFE_INTEGER - balances[to]) {
    return { ok: false, error: 'Overflow' };
  }
  const next = balances.slice();
  next[from] -= amount;
  next[to] += amount;
  return { ok: true, balances: next };
}
