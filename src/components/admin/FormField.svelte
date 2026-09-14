<script lang="ts">
import Field from "./FormField.svelte";
import { defaultValue, labelFor, type Schema, type Value } from "./types";

let {
	name,
	value,
	schema,
	onchange,
	onpick,
	depth = 0,
}: {
	name: string;
	value: Value;
	schema: Schema;
	onchange: (value: Value) => void;
	onpick?: (choose: (url: string) => void) => void;
	depth?: number;
} = $props();
const id = $props.id();
let newKey = $state("");
const actualKind = $derived(
	value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
);
const selectedSchema = $derived(
	schema.kind === "union"
		? schema.variants?.find(
				(variant) =>
					variant.kind === actualKind &&
					(!variant.options ||
						variant.options.includes(value as string | number)),
			) ||
				schema.variants?.[0] ||
				schema
		: schema,
);
const object = $derived(
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, Value>)
		: {},
);
const fields = $derived(selectedSchema.fields || {});
const list = $derived(Array.isArray(value) ? value : []);
const isFile = $derived(
	/avatar|cover|image|qrCode|imgurl|^src$|^url$|playerUrl|desktop|mobile|^lrc$|^value(Dark)?$/i.test(
		name,
	),
);
const multiline = $derived(
	/content|description|^desc$|bio|usage|^lrc$/.test(name) ||
		(typeof value === "string" && (value.includes("\n") || value.length > 180)),
);
function changeKey(key: string, next: Value) {
	onchange({ ...object, [key]: next });
}
function removeKey(key: string) {
	const next = { ...object };
	delete next[key];
	onchange(next);
}
function move(index: number, offset: number) {
	const next = [...list];
	[next[index], next[index + offset]] = [next[index + offset], next[index]];
	onchange(next);
}
function itemTitle(item: Value, index: number): string {
	if (item && typeof item === "object" && !Array.isArray(item))
		return String(item.name || item.title || item.id || `第 ${index + 1} 项`);
	return `第 ${index + 1} 项`;
}
</script>

<div class:field-group={selectedSchema.kind === "object" || selectedSchema.kind === "array"} class="field">
	{#if object.$expression || selectedSchema.kind === "readonly"}
		<div class="field-label">{labelFor(name)}</div><p class="field-help">由站点自动计算，相关设置请在对应表单中修改。</p>
	{:else if selectedSchema.kind === "object"}
		<details open={depth < 1} class="object-section">
			<summary>{labelFor(name)} <span class="muted">{Object.keys(object).length} 项设置</span></summary>
			<div class="nested-fields">
				{#each Object.entries(object) as [key, child] (key)}
					<div class="optional-field">
						<Field name={key} value={child} schema={fields[key] || selectedSchema.item || { kind: "unknown" }} onchange={(next) => changeKey(key, next)} {onpick} depth={depth + 1} />
						{#if fields[key]?.optional || (!fields[key] && selectedSchema.item)}<button type="button" class="text-button optional-remove" onclick={() => removeKey(key)} aria-label={`移除${labelFor(key)}`}>移除</button>{/if}
					</div>
				{/each}
				{#if Object.entries(fields).some(([key, field]) => field.optional && !(key in object))}
					<label class="add-optional">添加可选设置<select aria-label={`添加${labelFor(name)}的可选设置`} value="" onchange={(event) => { const key = event.currentTarget.value; if (key) changeKey(key, defaultValue(fields[key])); event.currentTarget.value = ""; }}><option value="">选择一项…</option>{#each Object.entries(fields).filter(([key, field]) => field.optional && !(key in object)) as [key]}<option value={key}>{labelFor(key)}</option>{/each}</select></label>
				{/if}
				{#if selectedSchema.item && selectedSchema.item.kind !== "unknown"}
					<div class="inline-actions"><input aria-label="新增设置名称" placeholder="新增设置名称" bind:value={newKey} /><button type="button" onclick={() => { if (newKey && !["__proto__", "constructor", "prototype"].includes(newKey) && !(newKey in object)) { changeKey(newKey, defaultValue(selectedSchema.item!)); newKey = ""; } }}>添加</button></div>
				{/if}
			</div>
		</details>
	{:else if selectedSchema.kind === "array"}
		<div class="field-heading"><span class="field-label">{labelFor(name)} <span class="count">{list.length}</span></span><button type="button" class="text-button" onclick={() => onchange([...list, defaultValue(selectedSchema.item || { kind: "string" })])}>＋ 添加</button></div>
		{#if list.length === 0}<p class="empty-inline">还没有内容，点击“添加”创建第一项。</p>{/if}
		{#each list as item, index}
			<div class="array-item">
				<div class="array-controls"><span>{itemTitle(item, index)}</span><div><button type="button" disabled={index === 0} onclick={() => move(index, -1)} aria-label={`上移第 ${index + 1} 项`}>↑</button><button type="button" disabled={index === list.length - 1} onclick={() => move(index, 1)} aria-label={`下移第 ${index + 1} 项`}>↓</button><button type="button" class="danger-text" onclick={() => onchange(list.filter((_, i) => i !== index))} aria-label={`删除第 ${index + 1} 项`}>移除</button></div></div>
				<Field name={typeof item === "object" ? "内容" : name} value={item} schema={selectedSchema.item || { kind: "string" }} onchange={(next) => onchange(list.map((old, i) => i === index ? next : old))} {onpick} depth={depth + 1} />
			</div>
		{/each}
	{:else if selectedSchema.kind === "boolean"}
		<label class="toggle-field" for={id}><span>{labelFor(name)}</span><input id={id} type="checkbox" role="switch" checked={value === true} onchange={(event) => onchange(event.currentTarget.checked)} /></label>
	{:else if selectedSchema.options}
		<label for={id}>{labelFor(name)}</label><select id={id} value={String(value)} onchange={(event) => onchange(selectedSchema.kind === "number" ? Number(event.currentTarget.value) : event.currentTarget.value)}>{#each selectedSchema.options as option}<option value={String(option)}>{String(option)}</option>{/each}</select>
	{:else if selectedSchema.kind === "number"}
		<label for={id}>{labelFor(name)}</label><input id={id} type="number" step="any" value={value as number} oninput={(event) => onchange(event.currentTarget.valueAsNumber)} />
	{:else if selectedSchema.kind === "string" || selectedSchema.kind === "unknown"}
		<label for={id}>{labelFor(name)}</label>
		{#if multiline}<textarea id={id} rows="4" value={String(value ?? "")} oninput={(event) => onchange(event.currentTarget.value)}></textarea>
		{:else}<div class="input-with-action"><input id={id} type={/password|auth|token|secret/i.test(name) ? "password" : "text"} value={String(value ?? "")} oninput={(event) => onchange(event.currentTarget.value)} />{#if isFile && onpick}<button type="button" onclick={() => onpick?.((url) => onchange(url))}>选择文件</button>{/if}</div>{/if}
	{:else}<p class="field-help">此项使用默认值。</p>{/if}
	{#if schema.kind === "union" && !object.$expression}<label class="variant-picker">输入方式<select value={selectedSchema.kind} onchange={(event) => { const selected = schema.variants?.find((variant) => variant.kind === event.currentTarget.value); if (selected) onchange(defaultValue(selected)); }}>{#each schema.variants || [] as variant}<option value={variant.kind}>{({ string: "单个值", array: "列表", object: "详细设置", boolean: "开关", number: "数字", null: "不设置" } as Record<string, string>)[variant.kind] || variant.kind}</option>{/each}</select></label>{/if}
	{#if schema.help && depth < 3}<p class="field-help">{schema.help.split("\n").filter((line) => line.trim() && !/^[-─=]/.test(line.trim())).slice(0, 2).join(" ").slice(0, 220)}</p>{/if}
</div>
