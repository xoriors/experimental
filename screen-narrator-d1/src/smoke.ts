// `pnpm tsx src/smoke.ts`: one tiny real call to each Liquid model, to check the key and the request/answer shapes.
// Two 64×48 images ≈ 2 × 9 tokens per question, so the whole check costs a fraction of a cent.
import "./env.ts";
import { PNG } from "pngjs";
import { askLiquid, LIQUID_MODELS, toPrediction } from "./backends/liquid.ts";
import { CORE_QUESTIONS, pairState } from "./questions.ts";

function solid(r: number, g: number, b: number, box?: [number, number, number, number]): string {
	const png = new PNG({ width: 64, height: 48 });
	for (let y = 0; y < 48; y++)
		for (let x = 0; x < 64; x++) {
			const inBox = box && x >= box[0] && y >= box[1] && x < box[2] && y < box[3];
			const i = (y * 64 + x) * 4;
			png.data[i] = inBox ? 200 : r;
			png.data[i + 1] = inBox ? 30 : g;
			png.data[i + 2] = inBox ? 30 : b;
			png.data[i + 3] = 255;
		}
	return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

const before = solid(240, 240, 240);
const after = solid(240, 240, 240, [8, 8, 56, 40]);
for (const model of LIQUID_MODELS) {
	const t = Date.now();
	const res = await askLiquid({ model, state: pairState(), questions: CORE_QUESTIONS, images: [before, after] });
	console.log(model, `${Date.now() - t} ms`, `${res.inputTokens} tokens`);
	console.log(JSON.stringify(res.answers, null, 1));
	console.log("prediction:", JSON.stringify(toPrediction(res.answers)));
}
