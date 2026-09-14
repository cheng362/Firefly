// Isolated, disposable browser QA. This never writes to the blog's source directories.
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { AssetManager } from "./assets.mjs";
import { passwordHash } from "./auth.mjs";
import { buildUI } from "./build-ui.mjs";
import { Publisher } from "./publisher.mjs";
import { createAdminServer } from "./server.mjs";
import { Store } from "./storage.mjs";

const project = process.cwd();
const uiDir = await buildUI(project);
const root = await mkdtemp(path.join(project, ".firefly-admin/qa-"));
for (const directory of [
	"src/config",
	"src/types",
	"src/utils",
	"src/content",
	"public/gallery",
]) {
	await cp(path.join(project, directory), path.join(root, directory), {
		recursive: true,
	});
}
await cp(path.join(project, "tsconfig.json"), path.join(root, "tsconfig.json"));
await mkdir(path.join(root, "dist"));
await writeFile(
	path.join(root, "dist/index.html"),
	"<!doctype html><html lang=zh-CN><meta charset=utf-8><title>QA preview</title><p>独立测试站点，不是线上博客。</p></html>",
);
const store = new Store(root);
await store.init();
const publisher = new Publisher(store, async (command, env) => {
	if (command === "build")
		await writeFile(
			path.join(env.FIREFLY_OUT_DIR, "index.html"),
			"<!doctype html><html lang=zh-CN><meta charset=utf-8><title>QA published</title><p>独立测试站点发布成功。</p></html>",
		);
});
const password = randomBytes(24).toString("base64url");
const port = Number(process.env.ADMIN_QA_PORT || 18473);
const { server } = await createAdminServer({
	root,
	store,
	publisher,
	uiDir,
	username: "admin",
	hash: await passwordHash(password),
	origin: `http://localhost:${port}`,
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
console.log(
	JSON.stringify({
		url: `http://localhost:${port}/admin/`,
		username: "admin",
		password,
		root,
		pid: process.pid,
		files: (await new AssetManager(store).list()).length,
	}),
);
process.once("SIGINT", () => {
	server.closeAllConnections();
	server.close();
});
process.once("SIGTERM", () => {
	server.closeAllConnections();
	server.close();
});
