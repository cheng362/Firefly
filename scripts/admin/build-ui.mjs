import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { compile } from "svelte/compiler";

export async function buildUI(root) {
	const directory = path.join(root, ".firefly-admin/ui");
	await mkdir(directory, { recursive: true });
	await build({
		entryPoints: [path.join(root, "src/components/admin/main.ts")],
		bundle: true,
		outfile: path.join(directory, "app.js"),
		format: "esm",
		minify: true,
		conditions: ["svelte", "browser"],
		platform: "browser",
		target: "es2022",
		plugins: [
			{
				name: "svelte-admin",
				setup(builder) {
					builder.onLoad(
						{ filter: /\.svelte$/ },
						async ({ path: filename }) => {
							const source = await readFile(filename, "utf8");
							// Svelte 5 strips type-only TypeScript itself and preserves imports used by templates.
							const compiled = compile(source, {
								filename,
								generate: "client",
								css: "external",
							});
							return {
								contents: compiled.js.code,
								loader: "js",
								resolveDir: path.dirname(filename),
							};
						},
					);
				},
			},
		],
	});
	await writeFile(
		path.join(directory, "index.html"),
		'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Firefly · 管理后台</title><link rel="stylesheet" href="/admin/assets/app.css"><script type="module" src="/admin/assets/app.js"></script></head><body><div id="app"></div><noscript>请启用 JavaScript 以使用管理员后台。</noscript></body></html>',
	);
	return directory;
}
