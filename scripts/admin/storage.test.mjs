import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AssetManager, validateUpload } from "./assets.mjs";
import { ConfigEditor } from "./config-editor.mjs";
import { ContentEditor, previewMarkdown } from "./content.mjs";
import { Publisher } from "./publisher.mjs";
import { Store, safePath } from "./storage.mjs";

async function fixture(t) {
	const root = await mkdtemp(path.join(os.tmpdir(), "firefly-admin-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const store = new Store(root);
	await store.init();
	return store;
}

test("writes detect stale revisions, preserve backups and restore deletions", async (t) => {
	const store = await fixture(t);
	const file = "src/content/posts/example.md";
	const first = await store.write(file, "first", null);
	await assert.rejects(store.write(file, "overwrite", null), { status: 409 });
	const second = await store.write(file, "second", first.revision);
	await assert.rejects(store.write(file, "stale", first.revision), {
		status: 409,
	});
	const deleted = await store.write(file, null, second.revision);
	assert.equal((await store.read(file)).bytes, null);
	await store.restore(deleted.historyId);
	assert.equal((await store.read(file)).bytes.toString(), "second");
	assert.equal((await store.history()).length, 4);
	const restarted = new Store(store.root);
	await restarted.init();
	assert.equal(restarted.state.version, 4);
});

test("filesystem boundary rejects traversal, scripts and linked directories", async (t) => {
	const store = await fixture(t);
	for (const file of [
		"../secret",
		"public/uploads/../../.env",
		"public/uploads/a\\b.png",
		"public/uploads/C:x.png",
		"public/uploads/con.png",
		"public/uploads/a.txt.",
	])
		await assert.rejects(store.read(file), { status: 400 });
	await assert.rejects(store.write("package.json", "{}", null), {
		status: 403,
	});
	await assert.rejects(
		store.write("public/uploads/evil.js", "alert(1)", null),
		{ status: 403 },
	);
	await mkdir(path.join(store.root, "outside"));
	await mkdir(path.join(store.root, "public"));
	await symlink(
		path.join(store.root, "outside"),
		path.join(store.root, "public/uploads"),
		process.platform === "win32" ? "junction" : "dir",
	);
	await assert.rejects(safePath(store.root, "public/uploads/secret.txt"), {
		status: 400,
	});
});

test("configuration forms save escaped literals, retain comments and validate declared types", async (t) => {
	const store = await fixture(t);
	await writeFile(
		path.join(store.root, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: { target: "ESNext", strict: true, skipLibCheck: true },
		}),
	);
	await mkdir(path.join(store.root, "src/config"), { recursive: true });
	const source =
		'type Config = { title: string; mode: "on" | "off"; entries: { name: string; cover?: string }[] };\nexport const announcementConfig: Config = {\n// Keep this comment\ntitle: "before", mode: "on", entries: []\n};\n';
	await writeFile(
		path.join(store.root, "src/config/announcementConfig.ts"),
		source,
	);
	const editor = new ConfigEditor(store);
	const document = await editor.read("announcementConfig");
	assert.equal(
		document.blocks[0].schema.fields.entries.item.fields.cover.optional,
		true,
	);
	document.blocks[0].value.title = '"; process.exit(1); //';
	document.blocks[0].value.entries.push({
		name: "Hello",
		cover: "/uploads/a.png",
	});
	await editor.save("announcementConfig", document);
	const saved = await readFile(
		path.join(store.root, "src/config/announcementConfig.ts"),
		"utf8",
	);
	assert.ok(saved.includes("Keep this comment"));
	assert.equal(
		(await editor.read("announcementConfig")).blocks[0].value.title,
		document.blocks[0].value.title,
	);
	await assert.rejects(editor.save("announcementConfig", document), {
		status: 409,
	});
	const invalid = await editor.read("announcementConfig");
	invalid.blocks[0].value.mode = "invalid";
	await assert.rejects(editor.save("announcementConfig", invalid), {
		status: 400,
	});
	invalid.blocks[0].value.mode = "on";
	invalid.blocks[0].value.entries = [
		{ name: "bad", cover: "javascript:alert(1)" },
	];
	await assert.rejects(editor.save("announcementConfig", invalid), {
		status: 400,
	});
});

test("content editing preserves metadata, respects drafts and prevents MDX execution through edits", async (t) => {
	const store = await fixture(t);
	const editor = new ContentEditor(store);
	const file = "src/content/posts/example.md";
	const created = await editor.save({
		file,
		revision: null,
		body: "Hello",
		meta: {
			title: "Title",
			published: "2026-09-13T08:00:00+08:00",
			draft: true,
			tags: ["Test"],
		},
	});
	const content = await editor.read(file);
	assert.equal(content.meta.published, "2026-09-13T00:00:00.000Z");
	assert.equal((await editor.list("posts"))[0].draft, true);
	await assert.rejects(
		editor.save({ ...content, meta: { ...content.meta, title: "" } }),
		{ status: 400 },
	);
	await assert.rejects(
		editor.save({
			...content,
			meta: { ...content.meta, published: "invalid" },
		}),
		{ status: 400 },
	);
	await store.write(
		"src/content/posts/complex.mdx",
		"---\ntitle: Complex\npublished: 2026-09-13\ncustom: keep\n---\nText",
		null,
	);
	const mdx = await editor.read("src/content/posts/complex.mdx");
	await assert.rejects(editor.save({ ...mdx, body: "{process.exit()}" }), {
		status: 400,
	});
	mdx.meta.title = "Updated";
	await editor.save(mdx);
	assert.ok(
		(await store.read(mdx.file)).bytes.toString().includes("custom: keep"),
	);
	assert.equal(created.revision, content.revision);
	const exampleBody =
		"---js\n(globalThis.__fireflyFrontmatterExecuted = true)\n---\nA frontmatter example";
	await editor.save({ ...content, body: exampleBody });
	assert.equal(globalThis.__fireflyFrontmatterExecuted, undefined);
	assert.equal((await editor.read(content.file)).body.trim(), exampleBody);
	await store.write("src/content/posts/unsafe.md", exampleBody, null);
	await assert.rejects(editor.read("src/content/posts/unsafe.md"), {
		status: 400,
	});
	assert.equal(globalThis.__fireflyFrontmatterExecuted, undefined);
	await assert.rejects(editor.read("src/config/announcementConfig.ts"), {
		status: 403,
	});
});

test("preview strips executable markup and uploads verify actual image contents", async () => {
	const html = await previewMarkdown(
		'<script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a>\n\n**Hello**',
	);
	assert.ok(!html.includes("script"));
	assert.ok(!html.includes("onerror"));
	assert.ok(html.includes("<strong>Hello</strong>"));
	const images = await previewMarkdown(
		"![New](/uploads/new.png)\n![Local](images/photo.png)",
		"src/content/posts/example.md",
	);
	assert.ok(
		images.includes("/admin/api/asset?file=public%2Fuploads%2Fnew.png"),
	);
	assert.ok(
		images.includes(
			"/admin/api/asset?file=src%2Fcontent%2Fposts%2Fimages%2Fphoto.png",
		),
	);
	await assert.rejects(
		validateUpload(Buffer.from("<svg onload='alert(1)'></svg>"), ".png"),
		{ status: 400 },
	);
	await assert.rejects(
		validateUpload(Buffer.from("<script></script>"), ".html"),
		{ status: 400 },
	);
	await assert.rejects(validateUpload(Buffer.from("not pdf"), ".pdf"), {
		status: 400,
	});
	await validateUpload(Buffer.from("%PDF-1.4\n"), ".pdf");
});

test("files referenced by content cannot be deleted", async (t) => {
	const store = await fixture(t);
	const assets = new AssetManager(store);
	const result = await assets.upload(Buffer.from("document"), "notes.txt", "");
	await store.write(
		"src/content/posts/example.md",
		`[Download](${result.url})`,
		null,
	);
	await assert.rejects(assets.remove(result.file, result.revision), {
		status: 409,
	});
	assert.ok((await store.read(result.file)).bytes);
});

test("source assets get reusable public URLs for Markdown and config fields", async (t) => {
	const store = await fixture(t);
	const assets = new AssetManager(store);
	const source = "src/content/posts/images/notes.txt";
	await store.write(source, "attachment", null);
	const first = await assets.publicUrl(source);
	assert.ok(first.url.startsWith("/uploads/media-"));
	assert.equal(
		(await store.read(`public${first.url}`)).bytes.toString(),
		"attachment",
	);
	const version = store.state.version;
	assert.deepEqual(await assets.publicUrl(source), first);
	assert.equal(store.state.version, version);
	assert.deepEqual(await assets.publicUrl(`public${first.url}`), first);
	await assert.rejects(assets.publicUrl("src/config/siteConfig.ts"), {
		status: 403,
	});
});

test("publication switches only after every check succeeds, locks edits and supports rollback", async (t) => {
	const store = await fixture(t);
	let fail = false;
	const calls = [];
	const publisher = new Publisher(store, async (command, env) => {
		calls.push(command);
		assert.equal(env.ADMIN_PASSWORD_HASH, undefined);
		await assert.rejects(
			store.write("public/uploads/during.txt", "blocked", null),
			{ status: 409 },
		);
		if (fail) throw new Error("intentional failure");
		if (command === "build")
			await writeFile(
				path.join(env.FIREFLY_OUT_DIR, "index.html"),
				"published",
			);
	});
	await publisher.start();
	await assert.rejects(publisher.start(), { status: 409 });
	await publisher.task;
	assert.deepEqual(calls, ["check", "type-check", "build"]);
	const first = store.state.active.directory;
	await store.write("public/uploads/change.txt", "new", null);
	fail = true;
	await publisher.start();
	await publisher.task;
	assert.equal(store.state.active.directory, first);
	assert.equal(publisher.snapshot().phase, "failed");
	assert.equal(publisher.snapshot().dirty, true);
	fail = false;
	await publisher.start();
	await publisher.task;
	assert.notEqual(store.state.active.directory, first);
	await publisher.rollback();
	assert.equal(store.state.active.directory, first);
	const restarted = new Store(store.root);
	await restarted.init();
	assert.equal(restarted.state.active.directory, first);
});
