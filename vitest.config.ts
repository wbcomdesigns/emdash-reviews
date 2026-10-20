import { emdashPluginTest } from "@emdash-cms/plugin-test/config";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [emdashPluginTest()],
	// One test file at a time: each file's sandbox setup rebuilds the plugin into dist/, and two files
	// writing dist/manifest.json together left one reading it half written ("Unexpected end of JSON
	// input" across a whole file). Long timeouts so a slow sandbox start or dispose cannot cascade.
	// tests/block-check.ts checks every admin answer with EmDash's own Block Kit validator.
	test: { fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000, setupFiles: ["tests/block-check.ts"] },
});
