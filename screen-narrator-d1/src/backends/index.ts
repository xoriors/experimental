// The backend registry. Backends are built on demand, so naming `pixel-diff` never validates VLM settings or
// needs an API key.
import { LIQUID_MODELS, type LiquidModel, liquidBackend } from "./liquid.ts";
import { pixelDiffBackend } from "./pixel-diff.ts";
import type { Backend } from "./types.ts";
import { vlmBackend } from "./vlm.ts";

export const BACKEND_NAMES = [...LIQUID_MODELS, "pixel-diff", "vlm"] as const;
export type BackendName = (typeof BACKEND_NAMES)[number];

export const isBackendName = (name: string): name is BackendName => (BACKEND_NAMES as readonly string[]).includes(name);

export function backendByName(name: string): Backend {
	if ((LIQUID_MODELS as readonly string[]).includes(name)) return liquidBackend(name as LiquidModel);
	switch (name) {
		case "pixel-diff":
			return pixelDiffBackend();
		case "vlm":
			return vlmBackend();
		default:
			throw new Error(`Unknown backend "${name}". Known: ${BACKEND_NAMES.join(", ")}`);
	}
}
