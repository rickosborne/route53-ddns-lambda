import * as esbuild from "esbuild";
import { readFileSync } from "fs";
import console from "node:console";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { rimraf } from "rimraf";

export const buildFunction = async (): Promise<string> => {
	await mkdir("dist", { recursive: true });
	await rimraf("dist", { preserveRoot: true });
	console.log("Building ...");
	await esbuild.build({
		allowOverwrite: true,
		banner: {
			js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
		},
		bundle: true,
		charset: "utf8",
		color: true,
		entryPoints: [ "src/index.ts" ],
		external: [ "buffer", "node:*" ],
		format: "esm",
		keepNames: true,
		minify: false,
		outfile: "dist/index.mjs",
		packages: "bundle",
		platform: "node",
		sourcemap: "inline",
		target: [ "node22" ],
		treeShaking: true,
	});
	const code = readFileSync("dist/index.mjs", { encoding: "utf-8" });
	return createHash("sha256").update(code).digest("base64");
};
