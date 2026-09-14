import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { assetExtensions, assetRoots, imageExtensions } from "./catalog.mjs";
import {
	AdminError,
	digest,
	hasControlCharacters,
	safePath,
	walk,
} from "./storage.mjs";

export function isAsset(file) {
	return (
		assetRoots.some((root) => file.startsWith(`${root}/`)) &&
		assetExtensions.includes(path.extname(file).toLowerCase())
	);
}
export function assetUrl(file) {
	return file.startsWith("public/")
		? `/${file.slice(7)}`
		: file.startsWith("src/assets/")
			? file.slice(4)
			: file;
}

export async function validateUpload(bytes, extension) {
	if (!assetExtensions.includes(extension))
		throw new AdminError(
			400,
			"不支持此文件格式。允许图片、音视频、PDF、ZIP、文本、歌词与字体",
		);
	if (!bytes.length) throw new AdminError(400, "不能上传空文件");
	if (imageExtensions.includes(extension)) {
		try {
			const info = await sharp(bytes, {
				limitInputPixels: 50000000,
			}).metadata();
			const expected = {
				".jpg": "jpeg",
				".jpeg": "jpeg",
				".png": "png",
				".webp": "webp",
				".avif": "heif",
				".gif": "gif",
			};
			if (info.format !== expected[extension] || !info.width || !info.height)
				throw new Error();
		} catch {
			throw new AdminError(400, "图片损坏、尺寸过大或格式与扩展名不符");
		}
		return;
	}
	const head = bytes.subarray(0, 16).toString("latin1");
	const signatures = {
		".pdf": () => head.startsWith("%PDF-"),
		".zip": () =>
			head.startsWith("PK\x03\x04") || head.startsWith("PK\x05\x06"),
		".mp3": () =>
			head.startsWith("ID3") || (bytes[0] === 255 && (bytes[1] & 224) === 224),
		".wav": () => head.startsWith("RIFF") && head.slice(8, 12) === "WAVE",
		".ogg": () => head.startsWith("OggS"),
		".mp4": () => head.slice(4, 8) === "ftyp",
		".m4a": () => head.slice(4, 8) === "ftyp",
		".webm": () => bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])),
		".woff": () => head.startsWith("wOFF"),
		".woff2": () => head.startsWith("wOF2"),
		".ttf": () => bytes.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0])),
		".otf": () => head.startsWith("OTTO"),
		".txt": () => !bytes.includes(0),
		".lrc": () => !bytes.includes(0),
	};
	if (!signatures[extension]?.())
		throw new AdminError(400, "文件内容与扩展名不符");
}

export class AssetManager {
	constructor(store) {
		this.store = store;
	}
	async list() {
		const files = (
			await Promise.all(
				assetRoots.map((root) => walk(this.store.root, root, isAsset)),
			)
		).flat();
		return Promise.all(
			files.map(async (file) => {
				const info = await stat(await safePath(this.store.root, file));
				return {
					file,
					url: assetUrl(file),
					name: path.basename(file),
					size: info.size,
					modified: info.mtime.toISOString(),
					image: imageExtensions.includes(path.extname(file).toLowerCase()),
				};
			}),
		);
	}
	async upload(bytes, filename, album) {
		if (
			typeof filename !== "string" ||
			!filename ||
			filename.length > 200 ||
			/[\\/:]/.test(filename) ||
			hasControlCharacters(filename)
		)
			throw new AdminError(400, "文件名无效");
		const extension = path.extname(filename).toLowerCase();
		await validateUpload(bytes, extension);
		let directory = "public/uploads";
		if (album) {
			if (
				!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(album) ||
				!imageExtensions.includes(extension)
			)
				throw new AdminError(400, "相册只允许上传图片");
			directory = `public/gallery/${album}`;
		}
		const stem =
			path
				.basename(filename, path.extname(filename))
				.replace(/[^\p{L}\p{N}_-]/gu, "-")
				.slice(0, 70) || "file";
		const file = `${directory}/${stem}-${randomUUID().slice(0, 8)}${extension}`;
		return {
			...(await this.store.write(file, bytes, null, "上传文件")),
			file,
			url: assetUrl(file),
		};
	}
	async references(file) {
		const sources = [
			...(await walk(this.store.root, "src/content", (item) =>
				/\.mdx?$/.test(item),
			)),
			...(await walk(this.store.root, "src/config", (item) =>
				/\.(ts|html)$/.test(item),
			)),
			...(await walk(this.store.root, "public/gallery", (item) =>
				item.endsWith("urls.txt"),
			)),
		];
		const url = assetUrl(file);
		const matches = [];
		for (const source of sources) {
			const text = await readFile(
				await safePath(this.store.root, source),
				"utf8",
			);
			if (
				text.includes(url) ||
				text.includes(encodeURI(url)) ||
				text.includes(path.basename(file))
			)
				matches.push(source);
		}
		return matches;
	}
	async publicUrl(file) {
		if (!isAsset(file)) throw new AdminError(403, "该文件不属于素材库");
		const source = await this.store.read(file);
		if (!source.bytes) throw new AdminError(404, "文件不存在");
		if (file.startsWith("public/")) return { url: assetUrl(file) };
		// Source images have no stable public URL. Reuse a content-addressed copy.
		const extension = path.extname(file).toLowerCase();
		await validateUpload(source.bytes, extension);
		const target = `public/uploads/media-${digest(source.bytes)}${extension}`;
		const existing = await this.store.read(target);
		await this.store.write(target, source.bytes, existing.revision, "复用素材");
		return { url: assetUrl(target) };
	}
	async remove(file, revision) {
		if (!isAsset(file)) throw new AdminError(403, "该文件不属于素材库");
		const references = await this.references(file);
		if (references.length)
			throw new AdminError(
				409,
				`文件仍被引用，请先修改这些内容：${references.slice(0, 5).join("、")}`,
			);
		return this.store.write(file, null, revision, "删除文件");
	}
}
