import { createHash, randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isEditablePath } from "./catalog.mjs";

export class AdminError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}
export const digest = (data) => createHash("sha256").update(data).digest("hex");
export const hasControlCharacters = (value) =>
	Array.from(value).some(
		(character) =>
			character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
	);

export function validRelative(file) {
	if (
		typeof file !== "string" ||
		file.length > 500 ||
		/[\\:]/.test(file) ||
		hasControlCharacters(file) ||
		file.startsWith("/")
	)
		throw new AdminError(400, "无效的文件路径");
	if (
		file
			.split("/")
			.some(
				(part) =>
					!part ||
					part === "." ||
					part === ".." ||
					/[. ]$/.test(part) ||
					/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part),
			)
	)
		throw new AdminError(400, "无效的文件路径");
	return file;
}

// Check every ancestor: a symlink must never turn an allowed path into an arbitrary write.
export async function safePath(root, file) {
	validRelative(file);
	let current = root;
	for (const part of file.split("/")) {
		current = path.join(current, part);
		try {
			if ((await lstat(current)).isSymbolicLink())
				throw new AdminError(400, "不允许访问符号链接");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	return current;
}

export async function atomicWrite(file, bytes) {
	await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
		await rename(temporary, file);
	} finally {
		await unlink(temporary).catch((error) => {
			if (error.code !== "ENOENT") throw error;
		});
	}
}

export async function readOptional(file) {
	try {
		return await readFile(file);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

export async function walk(root, base, accept = () => true) {
	const output = [];
	const directory = await safePath(root, base);
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
	for (const entry of entries) {
		if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
		const file = `${base}/${entry.name}`;
		if (entry.isDirectory()) output.push(...(await walk(root, file, accept)));
		else if (entry.isFile() && accept(file)) output.push(file);
	}
	return output.sort();
}

export class Store {
	constructor(root) {
		this.root = path.resolve(root);
		this.queue = Promise.resolve();
		this.busy = false;
	}
	async init() {
		this.privateDir = await safePath(this.root, ".firefly-admin");
		await mkdir(this.privateDir, { recursive: true, mode: 0o700 });
		this.state = JSON.parse(
			(
				await readOptional(path.join(this.privateDir, "state.json"))
			)?.toString() || '{"version":0}',
		);
	}
	async read(file) {
		if (!isEditablePath(validRelative(file)))
			throw new AdminError(403, "该文件不属于可管理内容");
		const bytes = await readOptional(await safePath(this.root, file));
		return { bytes, revision: bytes === null ? null : digest(bytes) };
	}
	exclusive(action) {
		const task = this.queue.then(action);
		this.queue = task.catch(() => {});
		return task;
	}
	async saveState() {
		await atomicWrite(
			path.join(this.privateDir, "state.json"),
			JSON.stringify(this.state),
		);
	}
	async write(file, bytes, revision, action = "保存") {
		if (this.busy)
			throw new AdminError(409, "网站正在发布，请完成后再修改内容");
		const current = await this.read(file);
		if (revision !== current.revision)
			throw new AdminError(
				409,
				"内容已被修改，请重新打开后再保存；当前输入仍保留在编辑器中",
			);
		const next = bytes === null ? null : Buffer.from(bytes);
		if (current.revision === (next === null ? null : digest(next)))
			return { revision: current.revision };
		const id = `${Date.now()}-${randomUUID()}`;
		const historyDir = await safePath(this.root, ".firefly-admin/history");
		const record = {
			id,
			file,
			action,
			at: new Date().toISOString(),
			before: current.revision,
			after: next === null ? null : digest(next),
		};
		if (current.bytes !== null)
			await atomicWrite(path.join(historyDir, `${id}.bin`), current.bytes);
		await atomicWrite(
			path.join(historyDir, `${id}.json`),
			JSON.stringify(record),
		);
		const target = await safePath(this.root, file);
		if (next === null) await unlink(target);
		else await atomicWrite(target, next);
		this.state.version++;
		await this.saveState();
		return { revision: record.after, historyId: id };
	}
	async history() {
		const files = await walk(this.root, ".firefly-admin/history", (file) =>
			file.endsWith(".json"),
		);
		return Promise.all(
			files
				.reverse()
				.slice(0, 150)
				.map(async (file) =>
					JSON.parse(await readFile(await safePath(this.root, file), "utf8")),
				),
		);
	}
	async restore(id) {
		if (!/^\d+-[a-f0-9-]{36}$/.test(id))
			throw new AdminError(400, "无效的历史记录");
		const record = JSON.parse(
			await readFile(
				await safePath(this.root, `.firefly-admin/history/${id}.json`),
				"utf8",
			),
		);
		const bytes =
			record.before === null
				? null
				: await readFile(
						await safePath(this.root, `.firefly-admin/history/${id}.bin`),
					);
		return this.write(record.file, bytes, record.after, "恢复历史");
	}
}
