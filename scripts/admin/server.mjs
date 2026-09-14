import { createReadStream } from "node:fs";
import {
	mkdir,
	open,
	readFile,
	realpath,
	stat,
	unlink,
} from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AssetManager, isAsset } from "./assets.mjs";
import { Auth } from "./auth.mjs";
import { buildUI } from "./build-ui.mjs";
import { configCatalog, imageExtensions } from "./catalog.mjs";
import { ConfigEditor } from "./config-editor.mjs";
import {
	ContentEditor,
	contentKind,
	dynamicFields,
	postFields,
	previewMarkdown,
} from "./content.mjs";
import { Publisher } from "./publisher.mjs";
import { AdminError, Store, safePath } from "./storage.mjs";

const mime = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".lrc": "text/plain; charset=utf-8",
	".xml": "application/xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".avif": "image/avif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
	".m4a": "audio/mp4",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".wasm": "application/wasm",
};
const adminCsp =
	"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: http: data:; connect-src 'self'; font-src 'self'; media-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";

export async function readBody(request, limit = 2 * 1024 * 1024) {
	if (Number(request.headers["content-length"]) > limit)
		throw new AdminError(
			413,
			`请求超过 ${Math.round(limit / 1024 / 1024)} MB 限制`,
		);
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > limit) throw new AdminError(413, "上传内容过大");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}
async function jsonBody(request) {
	if (!request.headers["content-type"]?.startsWith("application/json"))
		throw new AdminError(415, "请求必须使用 JSON 格式");
	try {
		const value = JSON.parse((await readBody(request)).toString());
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error();
		return value;
	} catch (error) {
		if (error instanceof AdminError) throw error;
		throw new AdminError(400, "无效的 JSON 请求");
	}
}
function json(response, value, status = 200) {
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	response.end(JSON.stringify(value));
}

async function sendFile(
	request,
	response,
	directory,
	relative,
	attachment = false,
) {
	let file = await safePath(directory, relative);
	let info;
	try {
		info = await stat(file);
	} catch (error) {
		if (error.code === "ENOENT") throw new AdminError(404, "文件不存在");
		throw error;
	}
	if (info.isDirectory()) {
		file = await safePath(directory, `${relative}/index.html`);
		info = await stat(file);
	}
	if (!info.isFile()) throw new AdminError(404, "文件不存在");
	const extension = path.extname(file).toLowerCase();
	response.setHeader(
		"Content-Type",
		mime[extension] || "application/octet-stream",
	);
	if (attachment || [".pdf", ".zip"].includes(extension))
		response.setHeader(
			"Content-Disposition",
			`attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
		);
	response.setHeader("Accept-Ranges", "bytes");
	let start = 0;
	let end = info.size - 1;
	if (request.headers.range) {
		const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
		if (!match || (!match[1] && !match[2]))
			throw new AdminError(416, "无效的文件范围");
		start = match[1]
			? Number(match[1])
			: Math.max(0, info.size - Number(match[2]));
		end =
			match[1] && match[2]
				? Math.min(Number(match[2]), info.size - 1)
				: info.size - 1;
		if (
			!Number.isSafeInteger(start) ||
			!Number.isSafeInteger(end) ||
			start > end ||
			start >= info.size
		) {
			response.setHeader("Content-Range", `bytes */${info.size}`);
			throw new AdminError(416, "文件范围超出大小");
		}
		response.statusCode = 206;
		response.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
	}
	response.setHeader("Content-Length", Math.max(0, end - start + 1));
	if (request.method === "HEAD" || info.size === 0) {
		response.end();
		return;
	}
	await new Promise((resolve, reject) => {
		const stream = createReadStream(file, { start, end });
		stream.on("error", reject);
		response.on("close", () => {
			stream.destroy();
			resolve();
		});
		stream.on("end", resolve);
		stream.pipe(response);
	});
}

export async function createAdminServer(options) {
	const store = options.store || new Store(await realpath(options.root));
	if (!store.state) await store.init();
	const auth = new Auth(options);
	const configs = new ConfigEditor(store);
	const contents = new ContentEditor(store);
	const assets = new AssetManager(store);
	const publisher = options.publisher || new Publisher(store);
	const uploadLimit = Math.min(
		Math.max(options.uploadLimit || 64 * 1024 * 1024, 1024),
		256 * 1024 * 1024,
	);
	const server = createServer(async (request, response) => {
		response.setHeader("X-Content-Type-Options", "nosniff");
		response.setHeader("Referrer-Policy", "no-referrer");
		try {
			const url = new URL(request.url, auth.origin);
			const pathname = decodeURIComponent(url.pathname);
			if (pathname === "/admin") {
				response.writeHead(302, { Location: "/admin/" });
				response.end();
				return;
			}
			if (pathname.startsWith("/admin/")) {
				response.setHeader("Cache-Control", "no-store");
				response.setHeader("Content-Security-Policy", adminCsp);
				response.setHeader("X-Frame-Options", "DENY");
				response.setHeader("X-Robots-Tag", "noindex, nofollow");
				if (pathname.startsWith("/admin/api/")) {
					const route = pathname.slice(11);
					if (route === "session" && request.method === "GET") {
						const session = auth.session(request);
						json(
							response,
							session
								? {
										authenticated: true,
										username: session.username,
										csrf: session.csrf,
									}
								: { authenticated: false },
						);
						return;
					}
					if (route === "login" && request.method === "POST") {
						auth.checkOrigin(request);
						const input = await jsonBody(request);
						const { session, token } = await auth.login(
							request,
							input.username,
							input.password,
						);
						response.setHeader("Set-Cookie", auth.cookie(token));
						json(response, {
							authenticated: true,
							username: session.username,
							csrf: session.csrf,
						});
						return;
					}
					const write = !["GET", "HEAD"].includes(request.method);
					const session = auth.require(request, write);
					if (route === "logout" && request.method === "POST") {
						auth.sessions.delete(session.id);
						response.setHeader("Set-Cookie", auth.cookie("", 0));
						json(response, { ok: true });
						return;
					}
					if (request.method === "GET") {
						if (route === "catalog")
							json(response, { configs: configCatalog, uploadLimit });
						else if (route === "content-schema")
							json(response, {
								postSchema: { kind: "object", fields: postFields },
								dynamicSchema: { kind: "object", fields: dynamicFields },
							});
						else if (route === "status") json(response, publisher.snapshot());
						else if (route === "contents")
							json(response, await contents.list(url.searchParams.get("kind")));
						else if (route === "content")
							json(response, await contents.read(url.searchParams.get("file")));
						else if (route === "config")
							json(response, await configs.read(url.searchParams.get("id")));
						else if (route === "assets") json(response, await assets.list());
						else if (route === "history") json(response, await store.history());
						else if (route === "asset") {
							const file = url.searchParams.get("file");
							if (!file || !isAsset(file))
								throw new AdminError(403, "该文件不属于素材库");
							if (url.searchParams.has("info")) {
								const current = await store.read(file);
								json(response, {
									revision: current.revision,
									references: await assets.references(file),
								});
							} else
								await sendFile(
									request,
									response,
									store.root,
									file,
									!imageExtensions.includes(path.extname(file).toLowerCase()),
								);
						} else throw new AdminError(404, "接口不存在");
						return;
					}
					if (route === "upload" && request.method === "POST") {
						if (store.busy)
							throw new AdminError(409, "网站正在发布，请完成后再上传");
						const bytes = await readBody(request, uploadLimit);
						const filename = decodeURIComponent(
							request.headers["x-file-name"] || "",
						);
						const album = request.headers["x-album-id"] || "";
						if (album) {
							const gallery = await configs.read("galleryConfig");
							if (
								!gallery.blocks[0].value.albums.some(
									(item) => item.id === album,
								)
							)
								throw new AdminError(400, "请先在相册设置中保存这个相册");
						}
						json(
							response,
							await store.exclusive(() =>
								assets.upload(bytes, filename, album),
							),
						);
						return;
					}
					const input = await jsonBody(request);
					if (request.method === "POST") {
						if (route === "asset-url")
							json(
								response,
								await store.exclusive(() => assets.publicUrl(input.file)),
							);
						else if (route === "content")
							json(response, await store.exclusive(() => contents.save(input)));
						else if (route === "convert")
							json(
								response,
								await store.exclusive(() => contents.convert(input)),
							);
						else if (route === "config")
							json(
								response,
								await store.exclusive(() => configs.save(input.id, input)),
							);
						else if (route === "preview")
							json(response, {
								html: await previewMarkdown(input.body, input.file),
							});
						else if (route === "restore")
							json(
								response,
								await store.exclusive(() => store.restore(input.id)),
							);
						else if (route === "publish")
							json(
								response,
								await store.exclusive(() => publisher.start()),
								202,
							);
						else if (route === "rollback")
							json(response, await store.exclusive(() => publisher.rollback()));
						else throw new AdminError(404, "接口不存在");
					} else if (request.method === "DELETE") {
						if (route === "asset")
							json(
								response,
								await store.exclusive(() =>
									assets.remove(input.file, input.revision),
								),
							);
						else if (route === "content") {
							if (!["posts", "dynamic"].includes(contentKind(input.file)))
								throw new AdminError(403, "固定页面请清空正文，不能删除");
							json(
								response,
								await store.exclusive(() =>
									store.write(input.file, null, input.revision, "删除内容"),
								),
							);
						} else throw new AdminError(404, "接口不存在");
					} else throw new AdminError(405, "不支持此请求方法");
					return;
				}
				if (!["GET", "HEAD"].includes(request.method))
					throw new AdminError(405, "不支持此请求方法");
				if (pathname === "/admin/")
					await sendFile(request, response, options.uiDir, "index.html");
				else if (
					["/admin/assets/app.js", "/admin/assets/app.css"].includes(pathname)
				)
					await sendFile(
						request,
						response,
						options.uiDir,
						path.basename(pathname),
					);
				else throw new AdminError(404, "页面不存在");
				return;
			}
			if (!["GET", "HEAD"].includes(request.method))
				throw new AdminError(405, "不支持此请求方法");
			if (pathname.split("/").some((part) => part.startsWith(".")))
				throw new AdminError(404, "页面不存在");
			const active = store.state.active?.directory || "dist";
			const directory = await safePath(store.root, active);
			response.setHeader("Cache-Control", "no-cache");
			try {
				await sendFile(
					request,
					response,
					directory,
					pathname === "/"
						? "index.html"
						: pathname.slice(1).replace(/\/$/, ""),
				);
			} catch (error) {
				if (error.status !== 404 && error.code !== "ENOENT") throw error;
				response.statusCode = 404;
				try {
					await sendFile(request, response, directory, "404.html");
				} catch {
					response.setHeader("Content-Type", "text/plain; charset=utf-8");
					response.end("页面不存在，或网站尚未发布。");
				}
			}
		} catch (error) {
			if (response.headersSent) {
				response.destroy();
				return;
			}
			response.removeHeader("Content-Length");
			const status =
				error instanceof AdminError
					? error.status
					: error instanceof URIError || error instanceof TypeError
						? 400
						: error.code === "ENOENT"
							? 404
							: 500;
			if (status === 500) console.error("[admin]", error);
			json(
				response,
				{
					error:
						error instanceof AdminError
							? error.message
							: status === 404
								? "内容不存在"
								: status === 400
									? "请求参数无效"
									: "操作未完成，请查看服务器日志",
				},
				status,
			);
		}
	});
	server.requestTimeout = 120000;
	server.headersTimeout = 15000;
	return { server, store, publisher, auth };
}

async function main() {
	const root = await realpath(process.cwd());
	const port = Number(process.env.ADMIN_PORT || 4322);
	const store = new Store(root);
	await store.init();
	const lockFile = await safePath(root, ".firefly-admin/server.lock");
	await mkdir(store.privateDir, { recursive: true });
	try {
		let lock;
		try {
			lock = await open(lockFile, "wx", 0o600);
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			const pid = Number(await readFile(lockFile, "utf8"));
			if (!Number.isSafeInteger(pid) || pid <= 0) throw error;
			try {
				process.kill(pid, 0);
				throw error;
			} catch (probe) {
				if (probe.code !== "ESRCH") throw probe;
			}
			await unlink(lockFile);
			lock = await open(lockFile, "wx", 0o600);
		}
		await lock.writeFile(String(process.pid));
		await lock.close();
	} catch (error) {
		if (error.code === "EEXIST")
			throw new Error(
				"后台锁文件已存在。请确认没有其他后台服务运行；若上次异常退出，删除 .firefly-admin/server.lock 后重启。",
			);
		throw error;
	}
	try {
		const origin = process.env.ADMIN_ORIGIN || `http://localhost:${port}`;
		// Fail closed before doing any compilation when credentials are missing.
		new Auth({
			origin,
			username: process.env.ADMIN_USERNAME,
			hash: process.env.ADMIN_PASSWORD_HASH,
		});
		const uiDir = await buildUI(root);
		const { server, publisher } = await createAdminServer({
			root,
			store,
			uiDir,
			origin,
			username: process.env.ADMIN_USERNAME,
			hash: process.env.ADMIN_PASSWORD_HASH,
		});
		const shutdown = async () => {
			if (publisher.task && store.busy) {
				console.log("等待当前发布完成后退出…");
				await publisher.task;
			}
			server.close(async () => {
				await unlink(lockFile);
				process.exit(0);
			});
		};
		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
		await new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen(port, process.env.ADMIN_HOST || "127.0.0.1", resolve);
		});
		console.log(`Firefly 管理后台：${origin}/admin/`);
	} catch (error) {
		await unlink(lockFile);
		throw error;
	}
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
