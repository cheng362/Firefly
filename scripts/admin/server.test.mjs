import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { passwordHash } from "./auth.mjs";
import { createAdminServer } from "./server.mjs";

test("HTTP admin requires session, same-origin writes and CSRF; static serving cannot expose sources", async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), "firefly-http-test-"));
	const password = randomBytes(24).toString("hex");
	const origin = "http://localhost";
	await mkdir(path.join(root, "ui"));
	await writeFile(path.join(root, "ui/index.html"), "<html>Admin login</html>");
	await mkdir(path.join(root, "dist"));
	await writeFile(path.join(root, "dist/index.html"), "Published site");
	await writeFile(path.join(root, "dist/movie.mp4"), "0123456789");
	await writeFile(path.join(root, ".env.admin"), "PRIVATE");
	const { server, auth } = await createAdminServer({
		root,
		uiDir: path.join(root, "ui"),
		origin,
		username: "owner",
		hash: await passwordHash(password),
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(async () => {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
		await rm(root, { recursive: true, force: true });
	});
	const base = `http://127.0.0.1:${server.address().port}`;
	const send = (route, data, headers = {}, method = "POST") =>
		fetch(`${base}/admin/api/${route}`, {
			method,
			headers: {
				Origin: origin,
				"Content-Type": "application/json",
				...headers,
			},
			body: JSON.stringify(data),
		});
	assert.equal((await fetch(`${base}/admin/api/catalog`)).status, 401);
	assert.equal(
		(await send("content", { file: "src/content/posts/evil.md", body: "test" }))
			.status,
		401,
	);
	assert.equal(
		(
			await send(
				"login",
				{ username: "owner", password },
				{ Origin: "https://attacker.test" },
			)
		).status,
		403,
	);
	assert.equal(
		(await send("login", { username: "owner", password: "wrong" })).status,
		401,
	);
	const login = await send("login", { username: "owner", password });
	assert.equal(login.status, 200);
	const cookie = login.headers.get("set-cookie").split(";")[0];
	assert.ok(login.headers.get("set-cookie").includes("HttpOnly"));
	assert.ok(login.headers.get("set-cookie").includes("SameSite=Strict"));
	const session = await login.json();
	const headers = { Cookie: cookie, "X-CSRF-Token": session.csrf };
	const content = {
		file: "src/content/posts/first.md",
		revision: null,
		body: "Hello",
		meta: { title: "First", published: "2026-09-13", draft: true },
	};
	assert.equal(
		(await send("content", content, { Cookie: cookie })).status,
		403,
	);
	assert.equal(
		(
			await send("content", content, {
				...headers,
				Origin: "https://attacker.test",
			})
		).status,
		403,
	);
	const saved = await send("content", content, headers);
	assert.equal(saved.status, 200);
	assert.equal((await send("content", content, headers)).status, 409);
	const body = await saved.json();
	assert.equal(
		(await send("content", { ...content, file: "../.env.admin" }, headers))
			.status,
		403,
	);
	assert.equal(
		(
			await send(
				"content",
				{ file: content.file, revision: body.revision },
				headers,
				"DELETE",
			)
		).status,
		200,
	);
	assert.equal(await (await fetch(`${base}/`)).text(), "Published site");
	for (const route of [
		"/.env.admin",
		"/.firefly-admin/state.json",
		"/src/config/siteConfig.ts",
		"/admin/api/asset?file=../.env.admin",
	]) {
		const response = await fetch(`${base}${route}`, {
			headers: { Cookie: cookie },
		});
		assert.notEqual(response.status, 200);
		assert.ok(!(await response.text()).includes("PRIVATE"));
	}
	const partial = await fetch(`${base}/movie.mp4`, {
		headers: { Range: "bytes=2-5" },
	});
	assert.equal(partial.status, 206);
	assert.equal(await partial.text(), "2345");
	const page = await fetch(`${base}/admin/`);
	assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow");
	assert.ok(
		!page.headers.get("content-security-policy").includes("unsafe-inline"),
	);
	assert.equal((await send("logout", {}, headers)).status, 200);
	assert.equal(
		(await fetch(`${base}/admin/api/status`, { headers: { Cookie: cookie } }))
			.status,
		401,
	);
	assert.equal(auth.sessions.size, 0);
	for (let i = 0; i < 10; i++)
		await send("login", { username: "owner", password: "wrong" });
	assert.equal(
		(await send("login", { username: "owner", password })).status,
		429,
	);
});
