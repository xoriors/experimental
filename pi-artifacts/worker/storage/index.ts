import { UID_PATTERN } from "../../shared/protocol.ts";
import { ArtifactStore } from "./artifacts.ts";
import { deriveUserKey } from "./keys.ts";
import { UserFiles } from "./user-files.ts";

export { newId } from "./artifacts.ts";
export type { ArtifactStore } from "./artifacts.ts";
export type { FileEntry, UserFiles } from "./user-files.ts";
export { PathError } from "./paths.ts";

/**
 * The only code that touches the R2 bucket or the Artifacts repos
 * (test/storage-boundary.test.ts fails the build otherwise). Everything else
 * gets an ArtifactStore, or a UserFiles scoped to one user and encrypted with
 * that user's key.
 */
export class Storage {
  readonly artifacts: ArtifactStore;
  readonly #env: Env;

  constructor(env: Env) {
    this.#env = env;
    this.artifacts = new ArtifactStore(env.REPOS, env.FILES);
  }

  /** One user's files. `uid` must come from a verified identity, never from a request body or a model. */
  async userFiles(uid: string): Promise<UserFiles> {
    if (!UID_PATTERN.test(uid)) throw new Error("Invalid user id.");
    return new UserFiles(this.#env.FILES, uid, await deriveUserKey(masterSecret(this.#env), uid));
  }
}

/** A fixed key for local demo mode only, so `pnpm dev` works without secrets. */
const DEMO_MASTER_KEY = btoa("pi-artifacts local demo key, never used when deployed");

function masterSecret(env: Env): string {
  const secret = (env as { FILES_MASTER_KEY?: string }).FILES_MASTER_KEY;
  if (secret) return secret;
  if (env.AUTH_MODE === "demo") return DEMO_MASTER_KEY;
  throw new Error("FILES_MASTER_KEY is not set; user files are unavailable.");
}
