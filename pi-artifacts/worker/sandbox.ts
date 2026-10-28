import { Files } from "@cloudflare/sandbox";
import { DurableObject } from "cloudflare:workers";

const WORKSPACE = "/workspace";
const INACTIVITY_TIMEOUT_MS = 10 * 60_000;
const RUN_TIMEOUT_SECONDS = 60;
const MAX_OUTPUT_CHARS = 20_000;

export interface SandboxFile {
  name: string;
  bytes: ArrayBuffer;
}

export interface SandboxRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Files the script wrote to /workspace/out. */
  outputs: SandboxFile[];
}

/**
 * One Linux container per chat for code the agent wants to run. No internet:
 * data comes in as files the agent picks from R2, and results go back the
 * same way. Each run starts with fresh ./files and ./out; anything else under
 * /workspace stays while the container is up (10 minutes after the last run).
 */
export class Sandbox extends DurableObject<Env> {
  async runPython(code: string, inputs: SandboxFile[]): Promise<SandboxRun> {
    return this.#run({ name: "main.py", contents: code }, ["python3", "main.py"], inputs);
  }

  /** A bash script, run as written: it stops at the first failing command only if it says `set -e`. */
  async runBash(script: string, inputs: SandboxFile[]): Promise<SandboxRun> {
    return this.#run({ name: "run.sh", contents: script }, ["bash", "run.sh"], inputs);
  }

  async #run(entry: { name: string; contents: string }, argv: string[], inputs: SandboxFile[]): Promise<SandboxRun> {
    const container = await this.#ensureRunning();
    const files = new Files(container);

    await this.#exec(container, ["sh", "-c", "rm -rf /workspace/files /workspace/out && mkdir -p /workspace/files /workspace/out"]);
    for (const input of inputs) await files.writeFile(`${WORKSPACE}/files/${input.name}`, input.bytes);
    await files.writeFile(`${WORKSPACE}/${entry.name}`, entry.contents);

    const run = await this.#exec(container, ["timeout", String(RUN_TIMEOUT_SECONDS), ...argv]);

    const outputs: SandboxFile[] = [];
    for (const entry of await files.readDirectory(`${WORKSPACE}/out`)) {
      if (entry.type !== "file") continue;
      const response = await files.readFile(`${WORKSPACE}/out/${entry.name}`);
      outputs.push({ name: entry.name, bytes: await response.arrayBuffer() });
    }
    return { ...run, outputs };
  }

  async #exec(container: Container, argv: string[]): Promise<Omit<SandboxRun, "outputs">> {
    const process = await container.exec(argv, { cwd: WORKSPACE });
    const output = await process.output();
    const decoder = new TextDecoder();
    return {
      exitCode: output.exitCode,
      stdout: decoder.decode(output.stdout).slice(-MAX_OUTPUT_CHARS),
      stderr: decoder.decode(output.stderr).slice(-MAX_OUTPUT_CHARS),
    };
  }

  async #ensureRunning(): Promise<Container> {
    const container = this.ctx.container;
    if (!container) throw new Error("This Worker has no container binding for the sandbox.");
    if (!container.running) {
      container.start({ image: container.images.sandbox, instance: "lite", enableInternet: false });
      await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    }
    return container;
  }
}
