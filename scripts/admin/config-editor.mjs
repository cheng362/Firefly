import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { configCatalog } from "./catalog.mjs";
import { AdminError, digest, safePath } from "./storage.mjs";

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const opaque = (text) => ({ $expression: text });
const blockedKey = (key) =>
	["__proto__", "constructor", "prototype", "$expression"].includes(key);

function literal(node, source, checker) {
	if (ts.isStringLiteralLike(node)) return node.text;
	if (ts.isNumericLiteral(node)) return Number(node.text);
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (node.kind === ts.SyntaxKind.NullKeyword) return null;
	if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand))
		return node.operator === ts.SyntaxKind.MinusToken
			? -Number(node.operand.text)
			: Number(node.operand.text);
	if (ts.isArrayLiteralExpression(node))
		return node.elements.map((child) => literal(child, source, checker));
	if (ts.isObjectLiteralExpression(node)) {
		const result = {};
		for (const property of node.properties) {
			if (
				ts.isPropertyAssignment(property) &&
				!ts.isComputedPropertyName(property.name) &&
				!blockedKey(property.name.text)
			)
				result[property.name.text] = literal(
					property.initializer,
					source,
					checker,
				);
			else if (
				ts.isShorthandPropertyAssignment(property) &&
				!blockedKey(property.name.text)
			)
				result[property.name.text] = opaque(property.name.text);
			else return opaque(node.getText(source));
		}
		return result;
	}
	if (ts.isPropertyAccessExpression(node)) {
		const constant = checker.getConstantValue(node);
		if (constant !== undefined) return constant;
	}
	return opaque(node.getText(source));
}

function typeSchema(type, checker, depth = 0) {
	if (!type || depth > 9) return { kind: "unknown" };
	if (type.isUnion()) {
		const types = type.types.filter(
			(part) => !(part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Never)),
		);
		if (types.every((part) => part.flags & ts.TypeFlags.BooleanLiteral))
			return { kind: "boolean" };
		if (types.every((part) => part.isLiteral()))
			return {
				kind: typeof types[0].value,
				options: types.map((part) => part.value),
			};
		if (types.length === 1) return typeSchema(types[0], checker, depth + 1);
		return {
			kind: "union",
			variants: types.map((part) => typeSchema(part, checker, depth + 1)),
		};
	}
	if (type.flags & ts.TypeFlags.StringLike)
		return {
			kind: "string",
			...(type.isLiteral() ? { options: [type.value] } : {}),
		};
	if (type.flags & ts.TypeFlags.NumberLike)
		return {
			kind: "number",
			...(type.isLiteral() ? { options: [type.value] } : {}),
		};
	if (type.flags & ts.TypeFlags.BooleanLike) return { kind: "boolean" };
	if (type.flags & ts.TypeFlags.Null) return { kind: "null" };
	if (checker.isArrayType(type) || checker.isTupleType(type))
		return {
			kind: "array",
			item: typeSchema(checker.getTypeArguments(type)[0], checker, depth + 1),
		};
	if (type.getCallSignatures().length) return { kind: "unknown" };
	if (type.flags & ts.TypeFlags.Object || type.isIntersection()) {
		const fields = {};
		for (const prop of type.getProperties()) {
			if (blockedKey(prop.name)) continue;
			fields[prop.name] = {
				...typeSchema(
					checker.getTypeOfSymbolAtLocation(
						prop,
						prop.valueDeclaration || prop.declarations?.[0],
					),
					checker,
					depth + 1,
				),
				optional: Boolean(prop.flags & ts.SymbolFlags.Optional),
				help: ts.displayPartsToString(prop.getDocumentationComment(checker)),
			};
		}
		const index = checker.getIndexTypeOfType(type, ts.IndexKind.String);
		return {
			kind: "object",
			fields,
			...(index ? { item: typeSchema(index, checker, depth + 1) } : {}),
		};
	}
	return { kind: "unknown" };
}

function enrich(schema, value, node, source) {
	if (value?.$expression) return { kind: "readonly" };
	let result = schema;
	if (schema.kind === "unknown")
		result = {
			kind:
				value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
			fields: {},
			item: { kind: "unknown" },
		};
	if (schema.kind === "union") return schema;
	if (
		result.kind === "object" &&
		value &&
		!Array.isArray(value) &&
		typeof value === "object"
	) {
		const fields = { ...result.fields };
		for (const [key, child] of Object.entries(value)) {
			const prop =
				node && ts.isObjectLiteralExpression(node)
					? node.properties.find((item) => item.name?.text === key)
					: undefined;
			const comments = prop
				? source.text
						.slice(prop.pos, prop.getStart(source))
						.replace(/\/\*\*?|\*\/|\/\/|^\s*\*/gm, "")
						.trim()
				: "";
			fields[key] = {
				...enrich(
					fields[key] || result.item || { kind: "unknown" },
					child,
					prop?.initializer,
					source,
				),
				help: comments || fields[key]?.help || "",
			};
		}
		return { ...result, fields };
	}
	return result;
}

export function validateValue(value, schema, oldValue, trail = "配置") {
	if (same(value, oldValue)) return;
	if (schema.kind === "readonly" || value?.$expression)
		throw new AdminError(400, `${trail} 是由程序计算的字段`);
	if (schema.kind === "union") {
		for (const variant of schema.variants) {
			try {
				validateValue(value, variant, oldValue, trail);
				return;
			} catch {}
		}
		throw new AdminError(400, `${trail} 的值不符合可选类型`);
	}
	if (schema.kind === "array") {
		if (!Array.isArray(value) || value.length > 3000)
			throw new AdminError(400, `${trail} 必须是列表，最多 3000 项`);
		value.forEach((item, i) => {
			const previous =
				oldValue?.find?.((old) => same(old, item)) ?? oldValue?.[i];
			validateValue(item, schema.item, previous, `${trail}[${i + 1}]`);
		});
		return;
	}
	if (schema.kind === "object") {
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new AdminError(400, `${trail} 必须为表单对象`);
		for (const [key, field] of Object.entries(schema.fields)) {
			if (!field.optional && !(key in value))
				throw new AdminError(400, `${trail}.${key} 不能为空`);
		}
		for (const [key, child] of Object.entries(value)) {
			const field = schema.fields[key] || schema.item;
			if (blockedKey(key) || !field)
				throw new AdminError(400, `${trail} 包含未知字段`);
			validateValue(child, field, oldValue?.[key], `${trail}.${key}`);
		}
		return;
	}
	if (schema.kind === "null" ? value !== null : typeof value !== schema.kind)
		throw new AdminError(400, `${trail} 的类型不正确`);
	if (schema.options && !schema.options.includes(value))
		throw new AdminError(400, `${trail} 不在允许的选项中`);
	if (typeof value === "number" && !Number.isFinite(value))
		throw new AdminError(400, `${trail} 必须为有限数字`);
	if (
		typeof value === "string" &&
		(value.length > 100000 || /^\s*(javascript|vbscript|data):/i.test(value))
	)
		throw new AdminError(400, `${trail} 包含无效内容或不安全链接`);
}

// Preserve unchanged AST nodes, comments and existing expressions. New values are JSON literals only.
function render(value, node, source, checker, depth = 0) {
	const old = node ? literal(node, source, checker) : undefined;
	if (node && same(value, old)) return node.getText(source);
	if (value?.$expression)
		throw new AdminError(400, "不能新增或移动计算表达式，请保留原字段");
	const indent = "\t".repeat(depth + 1);
	if (Array.isArray(value)) {
		const elements =
			node && ts.isArrayLiteralExpression(node) ? [...node.elements] : [];
		return `[\n${value
			.map((item, index) => {
				const matched =
					elements.find((element) =>
						same(literal(element, source, checker), item),
					) || elements[index];
				return `${indent}${render(item, matched, source, checker, depth + 1)}`;
			})
			.join(",\n")}\n${"\t".repeat(depth)}]`;
	}
	if (value && typeof value === "object") {
		const properties =
			node && ts.isObjectLiteralExpression(node) ? [...node.properties] : [];
		return `{\n${Object.entries(value)
			.map(([key, child]) => {
				const prop = properties.find((property) => property.name?.text === key);
				if (
					prop &&
					ts.isShorthandPropertyAssignment(prop) &&
					same(child, old[key])
				)
					return `${indent}${prop.getText(source)}`;
				const comment = prop
					? source.text.slice(prop.pos, prop.getStart(source)).trim()
					: "";
				return `${comment ? `${indent}${comment}\n` : ""}${indent}${JSON.stringify(key)}: ${render(child, prop?.initializer, source, checker, depth + 1)}`;
			})
			.join(",\n")}\n${"\t".repeat(depth)}}`;
	}
	return JSON.stringify(value);
}

export class ConfigEditor {
	constructor(store) {
		this.store = store;
	}
	async program() {
		const directory = path.join(this.store.root, "src/config");
		const names = (await readdir(directory)).filter((name) =>
			name.endsWith(".ts"),
		);
		const sources = await Promise.all(
			names.map(async (name) =>
				readFile(await safePath(this.store.root, `src/config/${name}`), "utf8"),
			),
		);
		const key = digest(sources.join("\n"));
		if (key !== this.cacheKey) {
			const configFile = ts.readConfigFile(
				path.join(this.store.root, "tsconfig.json"),
				ts.sys.readFile,
			);
			const config = ts.parseJsonConfigFileContent(
				configFile.config,
				ts.sys,
				this.store.root,
			);
			this.options = config.options;
			this.rootNames = names.map((name) => path.join(directory, name));
			this.cached = ts.createProgram(this.rootNames, this.options);
			this.cacheKey = key;
		}
		return this.cached;
	}
	async inspect(id) {
		if (!Object.hasOwn(configCatalog, id))
			throw new AdminError(404, "配置不存在");
		const file = `src/config/${id}.ts`;
		const current = await this.store.read(file);
		const program = await this.program();
		const source = program.getSourceFile(path.join(this.store.root, file));
		const checker = program.getTypeChecker();
		const blocks = [];
		for (const statement of source.statements) {
			if (!ts.isVariableStatement(statement)) continue;
			for (const declaration of statement.declarationList.declarations) {
				let node = declaration.initializer;
				if (!node) continue;
				let type = checker.getTypeAtLocation(declaration.name);
				if (
					ts.isCallExpression(node) &&
					[
						"resolveSiteLang",
						"resolvePageToggles",
						"resolveDisplaySettingsConfig",
					].includes(node.expression.getText(source))
				) {
					node = node.arguments[0];
					type =
						checker.getContextualType(node) || checker.getTypeAtLocation(node);
				}
				if (!node || ts.isArrowFunction(node) || ts.isFunctionExpression(node))
					continue;
				const value = literal(node, source, checker);
				if (value?.$expression) continue;
				blocks.push({
					id: declaration.name.getText(source),
					value,
					schema: enrich(typeSchema(type, checker), value, node, source),
					node,
				});
			}
		}
		return {
			file,
			revision: current.revision,
			blocks,
			source,
			checker,
			program,
		};
	}
	async read(id) {
		const { file, revision, blocks } = await this.inspect(id);
		return {
			file,
			revision,
			blocks: blocks.map(({ node, ...block }) => block),
		};
	}
	async save(id, input) {
		const state = await this.inspect(id);
		if (state.revision !== input.revision)
			throw new AdminError(409, "配置已被修改，请重新打开后再保存");
		if (
			!Array.isArray(input.blocks) ||
			input.blocks.length !== state.blocks.length
		)
			throw new AdminError(400, "配置表单不完整");
		const edits = [];
		for (const block of state.blocks) {
			const changed = input.blocks.find((item) => item.id === block.id);
			if (!changed) throw new AdminError(400, "配置表单不完整");
			validateValue(changed.value, block.schema, block.value, block.id);
			if (block.id === "galleryConfig") {
				const ids = changed.value.albums.map((album) => album.id);
				if (
					ids.some(
						(album) => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(album),
					) ||
					new Set(ids).size !== ids.length
				)
					throw new AdminError(
						400,
						"相册标识必须唯一，只能使用字母、数字、横线或下划线",
					);
			}
			if (!same(changed.value, block.value))
				edits.push({
					start: block.node.getStart(state.source),
					end: block.node.end,
					text: render(changed.value, block.node, state.source, state.checker),
				});
		}
		let output = state.source.text;
		for (const edit of edits.sort((a, b) => b.start - a.start))
			output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
		const host = ts.createCompilerHost(this.options);
		const originalRead = host.readFile.bind(host);
		const target = path.resolve(this.store.root, state.file);
		host.readFile = (file) =>
			path.resolve(file) === target ? output : originalRead(file);
		const candidate = ts.createProgram(this.rootNames, this.options, host);
		const source = candidate.getSourceFile(target);
		const errors = [
			...candidate.getSyntacticDiagnostics(source),
			...candidate.getSemanticDiagnostics(source),
		].filter(
			(diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
		);
		if (errors.length)
			throw new AdminError(
				400,
				`配置校验失败：${ts.flattenDiagnosticMessageText(errors[0].messageText, " ")}`,
			);
		return this.store.write(state.file, output, input.revision);
	}
}
