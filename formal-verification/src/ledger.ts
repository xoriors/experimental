/**
 * Account balances in minor units (cents), indexed by account number.
 *
 * Model: `Verified.Ledger` in `lean/Verified/Ledger.lean`. Proven there, for balances that
 * start as non-negative safe integers: every transfer and every batch conserves the total
 * (`transfer_sum`, `settle_sum`), and no balance ever goes negative or past
 * `Number.MAX_SAFE_INTEGER` (`transfer_valid`, `settle_valid`).
 */

export type TransferError =
  | 'InvalidAccount'
  | 'SameAccount'
  | 'InvalidAmount'
  | 'InsufficientFunds'
  | 'Overflow';

export type TransferResult =
  | { ok: true; balances: number[] }
  | { ok: false; error: TransferError };

export interface Transfer {
  from: number;
  to: number;
  amount: number;
}

function isAccount(balances: readonly number[], id: number): boolean {
  return Number.isInteger(id) && id >= 0 && id < balances.length;
}

/**
 * Move `amount` from account `from` to account `to`. The guards run in a fixed order and
 * the first one that fails is the error reported; the Lean model uses the same order.
 */
export function transfer(
  balances: readonly number[],
  from: number,
  to: number,
  amount: number,
): TransferResult {
  if (!isAccount(balances, from) || !isAccount(balances, to)) {
    return { ok: false, error: 'InvalidAccount' };
  }
  // Rejected rather than treated as a no-op. Code that computes both new balances from
  // the old array mints money here: see `transferNoGuard_mints_money` in the Lean model.
  if (from === to) return { ok: false, error: 'SameAccount' };
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, error: 'InvalidAmount' };
  }
  if (balances[from] < amount) return { ok: false, error: 'InsufficientFunds' };
  // `MAX_SAFE_INTEGER - balance` is exact for any valid balance, whereas
  // `balance + amount` can round once it passes 2^53.
  if (amount > Number.MAX_SAFE_INTEGER - balances[to]) {
    return { ok: false, error: 'Overflow' };
  }
  const next = balances.slice();
  next[from] -= amount;
  next[to] += amount;
  return { ok: true, balances: next };
}

/** Apply transfers in order, skipping any that are rejected. */
export function settle(balances: readonly number[], transfers: readonly Transfer[]): number[] {
  let current = balances.slice();
  for (const { from, to, amount } of transfers) {
    const result = transfer(current, from, to, amount);
    if (result.ok) current = result.balances;
  }
  return current;
}
