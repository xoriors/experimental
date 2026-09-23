import type { TransferResult } from '../src/ledger';

// MUTANT of src/ledger.ts. Bug: no `Overflow` guard. A credit that takes a balance past
// 2^53 - 1 is silently rounded by JavaScript, creating or destroying money.
export function transfer(
  balances: readonly number[],
  from: number,
  to: number,
  amount: number,
): TransferResult {
  const isAccount = (id: number) => Number.isInteger(id) && id >= 0 && id < balances.length;
  if (!isAccount(from) || !isAccount(to)) return { ok: false, error: 'InvalidAccount' };
  if (from === to) return { ok: false, error: 'SameAccount' };
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, error: 'InvalidAmount' };
  }
  if (balances[from] < amount) return { ok: false, error: 'InsufficientFunds' };
  const next = balances.slice();
  next[from] -= amount;
  next[to] += amount;
  return { ok: true, balances: next };
}
