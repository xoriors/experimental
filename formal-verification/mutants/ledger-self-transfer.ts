import type { TransferResult } from '../src/ledger';

// MUTANT of src/ledger.ts. Bug: no `SameAccount` guard, and both new balances are computed
// from the old array, so moving money from an account to itself credits it without the
// debit. This is `transferNoGuard` in lean/Verified/Ledger.lean, where
// `transferNoGuard_mints_money` shows [10] becoming [15].
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
  if (balances[from] < amount) return { ok: false, error: 'InsufficientFunds' };
  if (amount > Number.MAX_SAFE_INTEGER - balances[to]) {
    return { ok: false, error: 'Overflow' };
  }
  const next = balances.slice();
  next[from] = balances[from] - amount;
  next[to] = balances[to] + amount;
  return { ok: true, balances: next };
}
