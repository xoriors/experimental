import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Transfer, TransferError, TransferResult } from '../src/ledger';
import type { Run } from '../src/rle';

export const ORACLE_PATH = fileURLToPath(
  new URL('../lean/.lake/build/bin/oracle', import.meta.url),
);

/** The oracle itself misbehaved, as opposed to the TypeScript disagreeing with it. */
export class OracleError extends Error {}

/**
 * A long-lived `oracle` process: the Lean models compiled to native code (see
 * `lean/Oracle.lean` for the line protocol). One request goes out per line and exactly one
 * response line comes back, so replies are matched to requests by order.
 */
export class LeanOracle {
  private readonly proc: ChildProcessByStdio<Writable, Readable, null>;
  private readonly waiting: { resolve: (line: string) => void; reject: (e: Error) => void }[] =
    [];
  private exited: OracleError | undefined;

  static start(): LeanOracle {
    if (!existsSync(ORACLE_PATH)) {
      throw new OracleError(
        `Lean oracle not found at ${ORACLE_PATH}. Build it with \`pnpm lean:build\` ` +
          '(needs elan: https://lean-lang.org/install).',
      );
    }
    return new LeanOracle();
  }

  private constructor() {
    this.proc = spawn(ORACLE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      this.waiting.shift()?.resolve(line);
    });
    this.proc.on('exit', (code, signal) => {
      this.exited = new OracleError(`oracle exited (code ${code}, signal ${signal})`);
      for (const w of this.waiting.splice(0)) w.reject(this.exited);
    });
  }

  async stop(): Promise<void> {
    if (this.exited) return;
    const done = new Promise((resolve) => this.proc.once('exit', resolve));
    this.proc.stdin.end();
    await done;
  }

  async ask(request: string): Promise<string> {
    if (this.exited) throw this.exited;
    const reply = new Promise<string>((resolve, reject) => {
      this.waiting.push({ resolve, reject });
    });
    this.proc.stdin.write(`${request}\n`);
    const line = await reply;
    if (line.startsWith('error ')) {
      throw new OracleError(`oracle rejected ${JSON.stringify(request)}: ${line}`);
    }
    return line;
  }

  async sort(xs: readonly number[]): Promise<number[]> {
    return ints(await this.ask(`sort ${xs.join(' ')}`));
  }

  async binarySearch(xs: readonly number[], target: number): Promise<number> {
    return Number(await this.ask(`search ${target} ; ${xs.join(' ')}`));
  }

  async encode(xs: readonly number[]): Promise<Run[]> {
    const line = await this.ask(`encode ${xs.join(' ')}`);
    return groups(line).map((g) => {
      const [value, count] = ints(g);
      return [value, count];
    });
  }

  async decode(runs: readonly (readonly [number, number])[]): Promise<number[]> {
    return ints(await this.ask(`decode ${runs.map(([v, n]) => `${v} ${n}`).join(' ; ')}`));
  }

  async transfer(
    balances: readonly number[],
    from: number,
    to: number,
    amount: number,
  ): Promise<TransferResult> {
    const line = await this.ask(`transfer ${from} ${to} ${amount} ; ${balances.join(' ')}`);
    if (line === 'ok' || line.startsWith('ok ')) {
      return { ok: true, balances: ints(line.slice(2)) };
    }
    if (line.startsWith('err ')) return { ok: false, error: line.slice(4) as TransferError };
    throw new OracleError(`unexpected transfer reply: ${line}`);
  }

  async settle(balances: readonly number[], transfers: readonly Transfer[]): Promise<number[]> {
    const txs = transfers.map((t) => ` ; ${t.from} ${t.to} ${t.amount}`).join('');
    return ints(await this.ask(`settle ${balances.join(' ')}${txs}`));
  }
}

function ints(s: string): number[] {
  const words = s.split(' ').filter((w) => w !== '');
  return words.map((w) => {
    const n = Number(w);
    // Lean integers are unbounded; a reply JS cannot hold exactly is a finding, not noise.
    if (!Number.isSafeInteger(n)) throw new OracleError(`not a safe integer: ${w}`);
    return n;
  });
}

function groups(s: string): string[] {
  return s.split(';').filter((g) => g.trim() !== '');
}
