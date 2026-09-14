import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { isAsset } from "./assets.mjs";
import { AdminError, walk } from "./storage.mjs";

function parseContent(raw) {
	const language = matter.language(raw).name.toLowerCase();
	if (
		raw.startsWith("---") &&
		language &&
		!["yaml", "yml", "json"].includes(language)
	)
		throw new AdminError(400, "内容信息只支持 YAML 或 JSON 格式");
	return matter(raw, {
		engines: {
			javascript: () => {
				throw new AdminError(400, "不支持可执行内容信息");
			},
		},
	});
}

export const postFields = {
	title: { kind: "string", help: "文章标题" },
	published: { kind: "string", help: "发布时间（含时区的日期时间）" },
	updated: { kind: "string", optional: true, help: "最后更新时间" },
	description: { kind: "string", optional: true, help: "文章摘要" },
	image: {
		kind: "string",
		optional: true,
		help: "封面图片地址，可从文件库复制",
	},
	tags: { kind: "array", item: { kind: "string" }, optional: true },
	category: { kind: "string", optional: true },
	draft: { kind: "boolean", optional: true },
	pinned: { kind: "boolean", optional: true },
	comment: { kind: "boolean", optional: true },
	author: { kind: "string", optional: true },
	lang: { kind: "string", optional: true },
	slug: {
		kind: "string",
		optional: true,
		help: "自定义文章网址，留空使用文件标识",
	},
	series: { kind: "string", optional: true },
	seriesOrder: { kind: "number", optional: true },
	password: { kind: "string", optional: true },
	passwordHint: { kind: "string", optional: true },
	sourceLink: { kind: "string", optional: true },
	licenseName: { kind: "string", optional: true },
	licenseUrl: { kind: "string", optional: true },
};
export const dynamicFields = {
	published: postFields.published,
	pinned: postFields.pinned,
	location: { kind: "string", optional: true },
};

export function contentKind(file) {
	if (/^src\/content\/posts\/.+\.mdx?$/.test(file)) return "posts";
	if (/^src\/content\/dynamic\/.+\.md$/.test(file)) return "dynamic";
	if (/^src\/content\/spec\/(about|friends|guestbook)\.mdx?$/.test(file))
		return "spec";
	if (file === "src/config/FooterConfig.html") return "footer";
	if (file === "public/anime-list.json") return "anime";
	if (/^public\/gallery\/[a-zA-Z0-9_-]+\/urls\.txt$/.test(file))
		return "photos";
	throw new AdminError(403, "该文件不能作为文章或页面编辑");
}

export class ContentEditor {
	constructor(store) {
		this.store = store;
	}
	async list(kind) {
		if (!["posts", "dynamic", "spec"].includes(kind))
			throw new AdminError(400, "未知内容类型");
		const files = await walk(this.store.root, `src/content/${kind}`, (file) =>
			/\.mdx?$/.test(file),
		);
		const items = await Promise.all(
			files.map(async (file) => {
				const { bytes, revision } = await this.store.read(file);
				const { data, content } = parseContent(bytes.toString());
				return {
					file,
					revision,
					title: String(
						data.title ||
							content
								.replace(/[#*!\n]/g, " ")
								.trim()
								.slice(0, 60) ||
							path.basename(file),
					),
					published: data.published || "",
					draft: data.draft === true,
					pinned: data.pinned === true,
				};
			}),
		);
		return items.sort(
			(a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0),
		);
	}
	async read(file) {
		const kind = contentKind(file);
		const { bytes, revision } = await this.store.read(file);
		if (bytes === null && !["photos", "footer"].includes(kind))
			throw new AdminError(404, "内容不存在");
		const raw = bytes?.toString() || "";
		if (!["posts", "dynamic", "spec"].includes(kind))
			return {
				file,
				revision,
				kind,
				body: raw,
				meta: {},
				schema: { kind: "object", fields: {} },
			};
		const { data, content } = parseContent(raw);
		const fields =
			kind === "posts"
				? postFields
				: kind === "dynamic"
					? dynamicFields
					: { title: postFields.title, description: postFields.description };
		const meta = {};
		for (const key of Object.keys(fields)) {
			if (data[key] !== undefined && data[key] !== null)
				meta[key] =
					data[key] instanceof Date ? data[key].toISOString() : data[key];
		}
		return {
			file,
			revision,
			kind,
			body: content,
			meta,
			schema: { kind: "object", fields },
			mdx: file.endsWith(".mdx"),
		};
	}
	async save(input) {
		const { file, revision, body, meta = {} } = input;
		const kind = contentKind(file);
		if (typeof body !== "string" || Buffer.byteLength(body) > 1024 * 1024)
			throw new AdminError(400, "正文最多 1 MB");
		const current = await this.store.read(file);
		if (current.revision !== revision)
			throw new AdminError(409, "内容已被修改，请重新打开后再保存");
		if (kind === "photos") {
			for (const line of body
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line && !line.startsWith("#"))) {
				try {
					if (!["https:", "http:"].includes(new URL(line).protocol))
						throw new Error();
				} catch {
					throw new AdminError(
						400,
						"远程照片每行填写一个完整的 HTTP 或 HTTPS 地址",
					);
				}
			}
		}
		if (kind === "anime") {
			try {
				if (!Array.isArray(JSON.parse(body).items)) throw new Error();
			} catch {
				throw new AdminError(400, "追番列表必须包含 items 数组");
			}
		}
		if (!["posts", "dynamic", "spec"].includes(kind))
			return { ...(await this.store.write(file, body, revision)), file };
		const fields =
			kind === "posts"
				? postFields
				: kind === "dynamic"
					? dynamicFields
					: { title: postFields.title, description: postFields.description };
		if (!meta || typeof meta !== "object" || Array.isArray(meta))
			throw new AdminError(400, "文章信息格式错误");
		const previous =
			current.bytes === null
				? { data: {}, content: "" }
				: parseContent(current.bytes.toString());
		const data = { ...previous.data };
		for (const key of Object.keys(fields)) delete data[key];
		for (const [key, value] of Object.entries(meta)) {
			const field = fields[key];
			if (
				!field ||
				(field.kind === "array"
					? !Array.isArray(value) ||
						!value.every((item) => typeof item === "string")
					: typeof value !== field.kind)
			)
				throw new AdminError(400, `文章字段 ${key} 无效`);
			if (typeof value === "string" && value.length > 10000)
				throw new AdminError(400, "文章信息过长");
			data[key] = value;
		}
		if (kind === "posts" && !data.title?.trim())
			throw new AdminError(400, "请填写文章标题");
		for (const key of ["published", "updated"]) {
			if ((key === "published" && kind !== "spec") || data[key]) {
				if (!data[key] || !Number.isFinite(Date.parse(data[key])))
					throw new AdminError(400, "请填写有效的发布日期和更新时间");
				data[key] = new Date(data[key]);
			} else delete data[key];
		}
		if (data.slug && !/^[\p{L}\p{N}][\p{L}\p{N}/_-]*$/u.test(data.slug))
			throw new AdminError(
				400,
				"文章网址只能包含文字、数字、斜线、横线和下划线",
			);
		if (file.endsWith(".mdx") && body !== previous.content)
			throw new AdminError(
				400,
				"此文件含 MDX 组件。请先转换为 Markdown，再编辑正文",
			);
		if (
			current.bytes === null &&
			!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.md$/.test(
				file.replace(/^src\/content\/(posts|dynamic)\//, ""),
			) &&
			kind !== "spec"
		)
			throw new AdminError(
				400,
				"新内容的标识只能使用字母、数字、斜线、横线和下划线",
			);
		// The editor body is always text, including leading Markdown rules or frontmatter examples.
		const output = Object.keys(data).length
			? matter.stringify({ content: body, data: {} }, data)
			: `---\n{}\n---\n${body}`;
		return {
			...(await this.store.write(file, output, revision)),
			file,
		};
	}
	async convert(input) {
		const original = await this.read(input.file);
		if (!original.mdx) throw new AdminError(400, "该内容不是 MDX 文件");
		if (original.revision !== input.revision)
			throw new AdminError(409, "内容已被修改，请重新打开");
		const nextFile = input.file.replace(/\.mdx$/, ".md");
		if ((await this.store.read(nextFile)).bytes !== null)
			throw new AdminError(409, "同名 Markdown 文件已存在");
		// The source is backed up by Store. Markdown treats MDX expressions as text, never server code.
		const raw = await this.store.read(input.file);
		const result = {
			...(await this.store.write(nextFile, raw.bytes, null, "转换为 Markdown")),
			file: nextFile,
		};
		try {
			await this.store.write(
				input.file,
				null,
				input.revision,
				"转换为 Markdown",
			);
		} catch (error) {
			await this.store.write(
				nextFile,
				null,
				result.revision,
				"撤销未完成的转换",
			);
			throw error;
		}
		return result;
	}
}

export async function previewMarkdown(body, file) {
	if (typeof body !== "string" || body.length > 1024 * 1024)
		throw new AdminError(400, "正文过长");
	return sanitizeHtml(await marked.parse(body), {
		transformTags: {
			img: (tagName, attributes) => {
				const src = attributes.src || "";
				if (src && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src)) {
					const location = decodeURIComponent(src.split(/[?#]/)[0]);
					const target = location.startsWith("/")
						? `public${location}`
						: file
							? path.posix.join(path.posix.dirname(file), location)
							: "";
					if (isAsset(target))
						attributes.src = `/admin/api/asset?file=${encodeURIComponent(target)}`;
				}
				return { tagName, attribs: attributes };
			},
		},
		allowedTags: [
			...sanitizeHtml.defaults.allowedTags,
			"img",
			"h1",
			"h2",
			"details",
			"summary",
		],
		allowedAttributes: {
			...sanitizeHtml.defaults.allowedAttributes,
			img: ["src", "alt", "title"],
			a: ["href", "title"],
		},
		allowedSchemes: ["http", "https", "mailto"],
		allowProtocolRelative: false,
	});
}
