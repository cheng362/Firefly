<script lang="ts">
import { onMount } from "svelte";
import Field from "./FormField.svelte";
import {
	type Asset,
	type ConfigDocument,
	type ContentDocument,
	type ContentItem,
	type HistoryItem,
	labelFor,
	type PublishStatus,
	type Session,
	type Value,
} from "./types";

let session = $state<Session>({ authenticated: false });
let booting = $state(true);
let working = $state(false);
let username = $state("admin");
let password = $state("");
let error = $state("");
let notice = $state("");
let view = $state("overview");
let configId = $state("");
let configs = $state<Record<string, [string, string]>>({});
let configDoc = $state<ConfigDocument | null>(null);
let contentDoc = $state<ContentDocument | null>(null);
let savedValue = $state("");
let items = $state<ContentItem[]>([]);
let allPosts = $state<ContentItem[]>([]);
let allDynamic = $state<ContentItem[]>([]);
let assets = $state<Asset[]>([]);
let history = $state<HistoryItem[]>([]);
let status = $state<PublishStatus | null>(null);
let search = $state("");
let assetSearch = $state("");
let assetFilter = $state("all");
let album = $state("");
let albums = $state<{ id: string; name: string }[]>([]);
let preview = $state("");
let previewing = $state(false);
let uploadLimit = $state(64 * 1024 * 1024);
let uploadProgress = $state("");
let pick = $state<((url: string) => void) | null>(null);
let editor: HTMLTextAreaElement | undefined;
let mobileNav = $state(false);
let initialized = false;
const sections = [
	["overview", "工作台", "◈"],
	["posts", "文章", "▤"],
	["dynamic", "动态", "◌"],
	["announcementConfig", "公告", "◁"],
	["galleryConfig", "相册", "▧"],
	["assets", "文件库", "▱"],
	["friendsConfig", "友情链接", "♧"],
	["booknavConfig", "书签导航", "⌑"],
	["musicConfig", "音乐", "♫"],
	["sponsorConfig", "赞助", "♡"],
	["spec", "页面内容", "▣"],
	["settings", "站点设置", "⚙"],
	["publish", "发布网站", "↗"],
	["history", "修改历史", "↶"],
];
const dirty = $derived(
	Boolean(configDoc || contentDoc) &&
		JSON.stringify(configDoc || contentDoc) !== savedValue,
);
const publishing = $derived(status?.phase === "running");
const pageTitle = $derived(
	view === "config"
		? configs[configId]?.[0] || "配置"
		: view === "photos"
			? "相册照片"
			: sections.find((entry) => entry[0] === view)?.[1] || "工作台",
);
const filteredItems = $derived(
	items.filter((item) =>
		`${item.title} ${item.file}`.toLowerCase().includes(search.toLowerCase()),
	),
);
const filteredAssets = $derived(
	assets.filter(
		(item) =>
			`${item.name} ${item.file}`
				.toLowerCase()
				.includes(assetSearch.toLowerCase()) &&
			(assetFilter !== "images" || item.image) &&
			(!album || item.file.startsWith(`public/gallery/${album}/`)),
	),
);

async function api<T>(
	route: string,
	data?: unknown,
	method = data === undefined ? "GET" : "POST",
): Promise<T> {
	const response = await fetch(`/admin/api/${route}`, {
		method,
		credentials: "same-origin",
		headers: {
			...(data !== undefined ? { "Content-Type": "application/json" } : {}),
			...(session.csrf ? { "X-CSRF-Token": session.csrf } : {}),
		},
		...(data !== undefined ? { body: JSON.stringify(data) } : {}),
	});
	const result = await response.json();
	if (!response.ok) {
		if (response.status === 401 && route !== "login")
			session = { authenticated: false };
		throw new Error(result.error || "操作未完成，请稍后重试");
	}
	return result as T;
}
async function perform(action: () => Promise<void>) {
	if (working) return;
	working = true;
	error = "";
	notice = "";
	try {
		await action();
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "操作失败，请重试";
	} finally {
		working = false;
	}
}
async function refreshStatus() {
	status = await api<PublishStatus>("status");
}
async function initialize() {
	const [catalog, posts, dynamics, publishingStatus] = await Promise.all([
		api<{ configs: Record<string, [string, string]>; uploadLimit: number }>(
			"catalog",
		),
		api<ContentItem[]>("contents?kind=posts"),
		api<ContentItem[]>("contents?kind=dynamic"),
		api<PublishStatus>("status"),
	]);
	configs = catalog.configs;
	uploadLimit = catalog.uploadLimit;
	allPosts = posts;
	allDynamic = dynamics;
	status = publishingStatus;
	initialized = true;
}
async function login(event: SubmitEvent) {
	event.preventDefault();
	await perform(async () => {
		session = await api<Session>("login", { username, password });
		password = "";
		if (!initialized) await initialize();
	});
}
async function logout() {
	if (dirty && !confirm("当前有未保存的内容，确定退出登录？")) return;
	await perform(async () => {
		await api("logout", {});
		session = { authenticated: false };
		configDoc = null;
		contentDoc = null;
		initialized = false;
		view = "overview";
	});
}
async function loadAssets() {
	assets = await api<Asset[]>("assets");
}
async function loadAlbums() {
	const gallery = await api<ConfigDocument>("config?id=galleryConfig");
	const value = gallery.blocks.find((block) => block.id === "galleryConfig")
		?.value as { albums: { id: string; name: string }[] };
	albums = value.albums;
}
async function navigate(next: string) {
	if (dirty && !confirm("当前修改尚未保存，确定离开？")) return;
	await perform(async () => {
		configDoc = null;
		contentDoc = null;
		preview = "";
		savedValue = "";
		search = "";
		mobileNav = false;
		if (configs[next]) {
			view = "config";
			configId = next;
			configDoc = await api<ConfigDocument>(
				`config?id=${encodeURIComponent(next)}`,
			);
			savedValue = JSON.stringify(configDoc);
		} else {
			view = next;
			configId = "";
		}
		if (["posts", "dynamic", "spec"].includes(next))
			items = await api<ContentItem[]>(`contents?kind=${next}`);
		if (next === "assets" || next === "photos") {
			album = "";
			assetSearch = "";
			await Promise.all([loadAssets(), loadAlbums()]);
		}
		if (next === "history") history = await api<HistoryItem[]>("history");
		if (next === "overview") await initialize();
		if (next === "publish") await refreshStatus();
	});
}
async function openContent(file: string) {
	if (dirty && !confirm("当前修改尚未保存，确定打开其他内容？")) return;
	await perform(async () => {
		contentDoc = await api<ContentDocument>(
			`content?file=${encodeURIComponent(file)}`,
		);
		configDoc = null;
		preview = "";
		savedValue = JSON.stringify(contentDoc);
	});
}
async function newContent(kind: string) {
	if (dirty && !confirm("当前修改尚未保存，确定新建？")) return;
	await perform(async () => {
		const schemaSource = items[0]
			? await api<ContentDocument>(
					`content?file=${encodeURIComponent(items[0].file)}`,
				)
			: await api<{
					postSchema: ContentDocument["schema"];
					dynamicSchema: ContentDocument["schema"];
				}>("content-schema");
		const schema =
			"schema" in schemaSource
				? schemaSource.schema
				: kind === "posts"
					? schemaSource.postSchema
					: schemaSource.dynamicSchema;
		contentDoc = {
			file: `src/content/${kind}/${Date.now()}.md`,
			revision: null,
			kind,
			body: "",
			meta:
				kind === "posts"
					? {
							title: "",
							published: new Date().toISOString(),
							description: "",
							tags: [],
							category: "",
							draft: true,
							comment: true,
						}
					: {
							published: new Date().toISOString(),
							pinned: false,
							location: "",
						},
			schema,
		};
		preview = "";
		savedValue = "";
	});
}
async function save() {
	await perform(async () => {
		if (configDoc) {
			await api("config", {
				id: configId,
				revision: configDoc.revision,
				blocks: configDoc.blocks.map(({ id, value }) => ({ id, value })),
			});
			configDoc = await api<ConfigDocument>(`config?id=${configId}`);
			savedValue = JSON.stringify(configDoc);
		} else if (contentDoc) {
			const result = await api<{ file: string }>("content", contentDoc);
			contentDoc = await api<ContentDocument>(
				`content?file=${encodeURIComponent(result.file)}`,
			);
			savedValue = JSON.stringify(contentDoc);
			if (["posts", "dynamic", "spec"].includes(view))
				items = await api<ContentItem[]>(`contents?kind=${view}`);
		}
		await refreshStatus();
		notice = "已保存。发布网站后，访客就能看到这些修改。";
	});
}
async function deleteContent(item: ContentItem) {
	if (
		!confirm(
			`删除“${item.title}”？保存后可在修改历史中恢复，发布后从网站移除。`,
		)
	)
		return;
	await perform(async () => {
		await api(
			"content",
			{ file: item.file, revision: item.revision },
			"DELETE",
		);
		items = items.filter((entry) => entry.file !== item.file);
		if (contentDoc?.file === item.file) contentDoc = null;
		await refreshStatus();
		notice = "内容已删除，可在修改历史中恢复。";
	});
}
async function renderPreview() {
	if (!contentDoc) return;
	const body = contentDoc.body;
	const file = contentDoc.file;
	await perform(async () => {
		const result = await api<{ html: string }>("preview", {
			body,
			file,
		});
		preview = result.html;
		previewing = true;
	});
}
function insert(before: string, after = "") {
	if (!contentDoc || !editor) return;
	const start = editor.selectionStart;
	const end = editor.selectionEnd;
	contentDoc.body =
		contentDoc.body.slice(0, start) +
		before +
		contentDoc.body.slice(start, end) +
		after +
		contentDoc.body.slice(end);
	editor.focus();
}
async function chooseFile(callback: (url: string) => void) {
	await perform(async () => {
		await loadAssets();
		assetSearch = "";
		album = "";
		pick = callback;
	});
}
function openDialog(node: HTMLDialogElement) {
	node.showModal();
	return {
		destroy() {
			node.close();
		},
	};
}
async function upload(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const files = Array.from(input.files || []);
	input.value = "";
	await perform(async () => {
		let completed = 0;
		try {
			for (const file of files) {
				if (file.size > uploadLimit)
					throw new Error(
						`${file.name} 超出 ${Math.round(uploadLimit / 1024 / 1024)} MB 限制`,
					);
				uploadProgress = `上传 ${completed + 1} / ${files.length}：${file.name}`;
				const response = await fetch("/admin/api/upload", {
					method: "POST",
					credentials: "same-origin",
					headers: {
						"Content-Type": "application/octet-stream",
						"X-CSRF-Token": session.csrf || "",
						"X-File-Name": encodeURIComponent(file.name),
						...(album ? { "X-Album-Id": album } : {}),
					},
					body: file,
				});
				const result = await response.json();
				if (!response.ok) {
					if (response.status === 401) session = { authenticated: false };
					throw new Error(
						`${completed} 个文件上传成功；${file.name}：${result.error}`,
					);
				}
				completed++;
			}
			notice = `已上传 ${completed} 个文件。可以选择使用或复制地址。`;
		} finally {
			uploadProgress = "";
			await loadAssets();
			await refreshStatus();
		}
	});
}
async function copyAsset(asset: Asset) {
	await perform(async () => {
		const url = await usableAssetUrl(asset);
		await navigator.clipboard.writeText(url);
		notice = `已复制：${url}`;
	});
}
async function usableAssetUrl(asset: Asset) {
	if (asset.file.startsWith("public/")) return asset.url;
	const result = await api<{ url: string }>("asset-url", { file: asset.file });
	await refreshStatus();
	return result.url;
}
async function selectAsset(asset: Asset) {
	await perform(async () => {
		const url = await usableAssetUrl(asset);
		pick?.(url);
		pick = null;
	});
}
async function deleteAsset(asset: Asset) {
	await perform(async () => {
		const info = await api<{ revision: string; references: string[] }>(
			`asset?info=1&file=${encodeURIComponent(asset.file)}`,
		);
		if (info.references.length)
			throw new Error(
				`该文件仍被引用，请先修改：${info.references.slice(0, 5).join("、")}`,
			);
		if (
			!confirm(
				`删除文件“${asset.name}”？如果它是相册照片，发布后也会从相册移除。`,
			)
		)
			return;
		await api("asset", { file: asset.file, revision: info.revision }, "DELETE");
		await loadAssets();
		await refreshStatus();
		notice = "文件已删除，可从修改历史恢复。";
	});
}
async function publish() {
	if (dirty) {
		error = "请先保存当前内容，再发布网站。";
		return;
	}
	await perform(async () => {
		status = await api<PublishStatus>("publish", {});
		view = "publish";
		configDoc = null;
		contentDoc = null;
	});
}
const sizeLabel = (size: number) =>
	size >= 1024 * 1024
		? `${(size / 1024 / 1024).toFixed(1)} MB`
		: `${Math.max(1, Math.round(size / 1024))} KB`;
const dateLabel = (date: string) =>
	date ? new Date(date).toLocaleString("zh-CN", { hour12: false }) : "—";

onMount(() => {
	void perform(async () => {
		session = await api<Session>("session");
		if (session.authenticated) await initialize();
	}).finally(() => {
		booting = false;
	});
	const timer = setInterval(() => {
		if (session.authenticated && !working)
			void refreshStatus().catch((cause) => {
				error = cause.message;
			});
	}, 4000);
	const beforeUnload = (event: BeforeUnloadEvent) => {
		if (dirty) {
			event.preventDefault();
			event.returnValue = "";
		}
	};
	window.addEventListener("beforeunload", beforeUnload);
	return () => {
		clearInterval(timer);
		window.removeEventListener("beforeunload", beforeUnload);
	};
});
</script>

{#snippet assetPanel(inPicker = false)}
	<div class="asset-toolbar"><input aria-label="搜索文件" type="search" placeholder="搜索文件名或路径…" bind:value={assetSearch} /><select aria-label="文件类型" bind:value={assetFilter}><option value="all">全部文件</option><option value="images">只看图片</option></select>{#if !inPicker}<select aria-label="相册筛选与上传位置" bind:value={album}><option value="">公共文件库</option>{#each albums as entry}<option value={entry.id}>{entry.name}</option>{/each}</select>{/if}<label class="button primary upload-button">＋ 上传文件<input type="file" multiple accept={album ? ".jpg,.jpeg,.png,.webp,.avif,.gif" : ".jpg,.jpeg,.png,.webp,.avif,.gif,.mp3,.wav,.ogg,.m4a,.mp4,.webm,.pdf,.zip,.txt,.lrc,.woff,.woff2,.ttf,.otf"} onchange={upload} disabled={working || publishing} /></label></div>
	<p class="muted">{album ? "图片会加入选中的相册；发布网站后对访客可见。" : "上传图片、音视频和附件。选择文件即可填入地址，也可以复制到正文中。"} 单个文件最多 {Math.round(uploadLimit / 1024 / 1024)} MB。</p>
	{#if uploadProgress}<p class="status-note" role="status">{uploadProgress}</p>{/if}
	<div class="asset-grid">{#each filteredAssets as asset (asset.file)}<article class="asset-card"><div class="asset-thumbnail">{#if asset.image}<img src={`/admin/api/asset?file=${encodeURIComponent(asset.file)}`} alt={asset.name} loading="lazy" />{:else}<span class="file-symbol">{asset.name.split(".").pop()?.toUpperCase()}</span>{/if}</div><div class="asset-info"><strong title={asset.name}>{asset.name}</strong><span>{sizeLabel(asset.size)}</span><small title={asset.file}>{asset.url}</small><div class="inline-actions">{#if inPicker}<button class="primary" disabled={working || publishing} onclick={() => selectAsset(asset)}>选择</button>{:else}<button onclick={() => copyAsset(asset)}>复制地址</button><a class="button" href={`/admin/api/asset?file=${encodeURIComponent(asset.file)}`} target="_blank" rel="noreferrer">查看</a><button class="danger-text" disabled={working || publishing} onclick={() => deleteAsset(asset)}>删除</button>{/if}</div></div></article>{/each}</div>
	{#if !filteredAssets.length}<div class="empty-state"><span>▱</span><h3>这里还没有文件</h3><p>上传第一张照片或第一个附件，开始整理你的内容。</p></div>{/if}
{/snippet}

{#if booting}
	<div class="boot-screen"><span class="brand-mark">✦</span><p>正在打开你的创作空间…</p></div>
{:else if !session.authenticated}
	<main class="login-page"><div class="login-intro"><a class="brand" href="/"><span class="brand-mark">✦</span> Firefly <small>STUDIO</small></a><div><span class="eyebrow">YOUR STORIES, YOUR SPACE</span><h1>专注记录，<br />让灵感有处安放。</h1><p>文章、相册与生活片刻，<br />从这里开始，慢慢积累。</p></div><small>一个属于你的内容管理空间</small></div><div class="login-panel"><form onsubmit={login}><span class="eyebrow">WELCOME BACK</span><h2>欢迎回来</h2><p class="muted">登录后，继续打理你的博客。</p>{#if error}<div role="alert" class="message error">{error}</div>{/if}<label for="username">管理员账号</label><input id="username" autocomplete="username" bind:value={username} required /><label for="password">密码</label><input id="password" type="password" autocomplete="current-password" bind:value={password} required /><button class="primary login-submit" disabled={working}>{working ? "正在登录…" : "进入工作台 →"}</button><a class="back-link" href="/">← 返回博客</a></form></div></main>
{:else}
	<div class="admin-shell"><aside class:mobile-open={mobileNav} class="sidebar"><a class="brand" href="/admin/" onclick={(event) => { event.preventDefault(); void navigate("overview"); }}><span class="brand-mark">✦</span> Firefly <small>STUDIO</small></a><span class="nav-caption">创作与管理</span><nav aria-label="管理功能">{#each sections as [key, title, symbol]}<button class:active={view === key || (view === "config" && configId === key) || (key === "galleryConfig" && view === "photos")} onclick={() => navigate(key)} disabled={working}><span class="nav-icon" aria-hidden="true">{symbol}</span>{title}{#if key === "publish" && status?.dirty}<span class="pending-dot" aria-label="有待发布内容"></span>{/if}</button>{/each}</nav><div class="sidebar-bottom"><span class="account-avatar">{(session.username || "A")[0].toUpperCase()}</span><div><strong>{session.username}</strong><small>博客管理员</small></div><button class="text-button" onclick={logout} disabled={working}>退出</button></div></aside>
	<div class="workspace"><header class="topbar"><div class="breadcrumbs"><button class="mobile-menu" onclick={() => mobileNav = !mobileNav} aria-label="切换导航菜单">☰</button><span>我的博客</span><span>/</span><strong>{pageTitle}</strong></div><div class="top-actions"><span class:pending={status?.dirty} class="save-status"><i></i>{publishing ? "发布中" : status?.dirty ? "有待发布内容" : "已同步"}</span><a href="/" target="_blank" rel="noreferrer" class="visit-link">访问博客 ↗</a><button class="primary" disabled={working || publishing || dirty} onclick={publish}>{publishing ? "正在发布…" : "发布网站 ↗"}</button></div></header>
	<main class="main-content" aria-busy={working}><div class="page-heading"><div><span class="eyebrow">FIREFLY STUDIO</span><h1>{pageTitle}</h1><p>{view === "overview" ? "把值得留住的故事，写在自己的地方。" : view === "config" ? configs[configId]?.[1] : view === "posts" ? "记录想法，也让每一篇文章都有自己的位置。" : view === "dynamic" ? "分享一段日常，或是转瞬即逝的灵感。" : view === "publish" ? "把已保存的修改，发布到你的博客。" : "在这里整理和维护你的博客内容。"}</p></div>{#if ["posts", "dynamic"].includes(view) && !contentDoc}<button class="primary" onclick={() => newContent(view)} disabled={working || publishing}>＋ {view === "posts" ? "写文章" : "发动态"}</button>{/if}</div>
	{#if error}<div class="message error" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onclick={() => error = ""}>×</button></div>{/if}{#if notice}<div class="message success" role="status"><span>{notice}</span><button aria-label="关闭成功提示" onclick={() => notice = ""}>×</button></div>{/if}
	{#if view === "overview"}
		<div class="welcome-banner"><div><span class="eyebrow">MAKE SOMETHING WORTH KEEPING</span><h2>今天，想记录些什么？</h2><p>写一篇文章，分享几张照片，<br />或给来访的朋友留一句话。</p><div class="inline-actions"><button class="primary" onclick={async () => { await navigate("posts"); await newContent("posts"); }}>开始写作 →</button><button onclick={() => navigate("galleryConfig")}>整理相册</button></div></div><div class="banner-art" aria-hidden="true"><span>✦</span><i></i><i></i><i></i></div></div>
		<div class="stats-grid"><button onclick={() => navigate("posts")}><span>文章</span><strong>{allPosts.length}</strong><small>{allPosts.filter((post) => post.draft).length} 篇草稿，等待下一次灵感</small></button><button onclick={() => navigate("dynamic")}><span>生活动态</span><strong>{allDynamic.length}</strong><small>细小日常，也值得被记录</small></button><button onclick={() => navigate("publish")}><span>发布状态</span><strong class="status-word">{publishing ? "发布中" : status?.dirty ? "待发布" : "已同步"}</strong><small>{status?.active ? `上次发布 ${dateLabel(status.active.at)}` : "还没有通过后台发布网站"}</small></button></div>
		<div class="overview-columns"><section class="panel"><div class="panel-heading"><h2>最近的文章</h2><button class="text-button" onclick={() => navigate("posts")}>查看全部 →</button></div>{#each allPosts.slice(0, 5) as post}<button class="recent-post" onclick={async () => { await navigate("posts"); await openContent(post.file); }}><span class="post-symbol">▤</span><span><strong>{post.title}</strong><small>{dateLabel(post.published)}</small></span><span class:badge-draft={post.draft} class="badge">{post.draft ? "草稿" : "公开"}</span></button>{/each}{#if !allPosts.length}<p class="empty-inline">还没有文章，开始写第一篇吧。</p>{/if}</section><section class="panel shortcuts"><h2>常用入口</h2>{#each [["announcementConfig", "更新公告", "给来访的朋友留一句话"], ["assets", "上传文件", "照片、音乐与分享的附件"], ["profileConfig", "个人资料", "让大家更了解你"], ["history", "修改历史", "找回之前保存的内容"]] as [key, title, description]}<button onclick={() => navigate(key)}><span><strong>{title}</strong><small>{description}</small></span><span>↗</span></button>{/each}</section></div>
	{:else if configDoc}
		{#if configId === "galleryConfig"}<div class="section-note"><p>先添加并保存相册信息，再进入照片管理上传图片。移除相册信息会下架相册；原图片仍可在文件库中管理。</p><button onclick={() => navigate("photos")} disabled={working}>管理相册照片 →</button></div>{/if}
		{#if configId === "commentConfig" || configId === "analyticsConfig" || configId === "dynamicConfig"}<div class="section-note"><p>{configId === "commentConfig" ? "这里只管理评论服务连接。审核、回复和删除评论，请进入你使用的评论服务管理页面。" : configId === "analyticsConfig" ? "访问报表保存在对应统计服务中，本页配置服务的接入参数。" : "启用 Memos 后，前台将显示 Memos 的动态。Memos 内容请在对应实例中管理；本地动态在左侧“动态”中编辑。"}</p></div>{/if}
		<fieldset disabled={working || publishing} class="editor-fields">{#each configDoc.blocks as block (block.id)}<section class="panel config-panel"><Field name={block.id} value={block.value} schema={block.schema} onchange={(value) => { block.value = value; }} onpick={chooseFile} /></section>{/each}</fieldset><div class="save-bar"><span>{dirty ? "有未保存的修改" : "内容已保存"}</span><button class="primary" disabled={working || publishing || !dirty} onclick={save}>{working ? "正在保存…" : "保存修改"}</button></div>
	{:else if contentDoc}
		<div class="editor-heading"><button onclick={() => { if (!dirty || confirm("放弃当前未保存的修改？")) { contentDoc = null; preview = ""; } }}>← 返回列表</button><span class="muted">{contentDoc.revision ? "编辑内容" : "新建内容"}</span></div><fieldset class="editor-fields" disabled={working || publishing}><section class="panel content-editor">{#if contentDoc.revision === null}<label for="content-file">网址标识</label><input id="content-file" value={contentDoc.file.replace(/^src\/content\/(posts|dynamic)\//, "").replace(/\.md$/, "")} oninput={(event) => { contentDoc!.file = `src/content/${contentDoc!.kind}/${event.currentTarget.value}.md`; }} /><p class="field-help">默认使用时间编号，也可改为有意义的英文名称。文件标识用于生成文章网址。</p>{/if}{#if Object.keys(contentDoc.schema.fields || {}).length}<Field name="内容信息" value={contentDoc.meta} schema={contentDoc.schema} onchange={(value) => { contentDoc!.meta = value as Record<string, Value>; }} onpick={chooseFile} />{/if}
			{#if contentDoc.mdx}<div class="section-note"><p>这篇内容包含 MDX 组件，可以直接修改上方信息。转换为普通 Markdown 后可编辑正文，组件表达式将作为普通文字保留，原文件可从历史恢复。</p><button onclick={() => { if (confirm("转换为普通 Markdown？转换后请检查正文显示。")) void perform(async () => { const result = await api<{ file: string }>("convert", { file: contentDoc!.file, revision: contentDoc!.revision }); contentDoc = await api<ContentDocument>(`content?file=${encodeURIComponent(result.file)}`); savedValue = JSON.stringify(contentDoc); notice = "已转换，可以编辑正文。"; }); }}>转换为 Markdown</button></div>{/if}
			<div class="editor-toolbar"><strong>正文</strong><div class="toolbar-actions"><button title="粗体" onclick={() => insert("**", "**")} disabled={contentDoc.mdx}>B</button><button title="斜体" onclick={() => insert("*", "*")} disabled={contentDoc.mdx}><em>I</em></button><button title="二级标题" onclick={() => insert("\n## ")} disabled={contentDoc.mdx}>H₂</button><button title="引用" onclick={() => insert("\n> ")} disabled={contentDoc.mdx}>❞</button><button onclick={() => chooseFile((url) => insert(`\n![图片](${encodeURI(url)})\n`))} disabled={contentDoc.mdx}>插入图片</button><button onclick={() => chooseFile((url) => insert(`\n[下载文件](${encodeURI(url)})\n`))} disabled={contentDoc.mdx}>插入附件</button><button onclick={renderPreview}>预览</button></div></div><label class="sr-only" for="body">正文内容</label><textarea id="body" class="body-editor" bind:this={editor} bind:value={contentDoc.body} readonly={contentDoc.mdx} placeholder={contentDoc.kind === "photos" ? "每行填写一个远程照片地址…" : "从一句话开始，写下你的故事…"} spellcheck="false"></textarea><div class="editor-footer"><span>{contentDoc.body.length.toLocaleString()} 字符</span><span>{contentDoc.kind === "footer" ? "页脚支持 HTML，启用开关后显示" : contentDoc.kind === "photos" ? "支持 HTTP / HTTPS 图片地址，每行一张" : "支持 Markdown 排版，可使用上方工具插入图片和附件"}</span></div></section></fieldset>
		{#if previewing && preview}<section class="panel"><div class="panel-heading"><h2>正文预览</h2><button class="text-button" onclick={() => previewing = false}>收起</button></div><p class="muted">基础排版预览；主题扩展语法以发布后的页面为准。</p><div class="prose-preview">{@html preview}</div></section>{/if}<div class="save-bar"><span>{dirty ? "有未保存的修改" : "内容已保存"}</span><button class="primary" disabled={working || publishing || !dirty} onclick={save}>保存内容</button></div>
	{:else if ["posts", "dynamic", "spec"].includes(view)}
		{#if view === "spec"}<div class="section-note"><p>关于我、留言板和友链附加内容，都可以在这里更新。</p><button onclick={() => openContent("src/config/FooterConfig.html")}>编辑页脚内容</button></div>{/if}
		<section class="panel list-panel"><div class="list-toolbar"><input type="search" placeholder="搜索标题或文件…" aria-label="搜索内容" bind:value={search} /><span class="muted">{filteredItems.length} 条内容</span></div><div class="content-table"><div class="table-header"><span>标题</span><span>状态</span><span>发布时间</span><span>操作</span></div>{#each filteredItems as item (item.file)}<div class="table-row"><button class="title-button" onclick={() => openContent(item.file)}><strong>{item.title}</strong><small>{item.file.replace(/^src\/content\//, "")}</small></button><span><span class:badge-draft={item.draft} class="badge">{item.draft ? "草稿" : "公开"}</span>{#if item.pinned}<small class="pinned-label">置顶</small>{/if}</span><span class="table-date">{dateLabel(item.published)}</span><div class="inline-actions"><button class="text-button" onclick={() => openContent(item.file)}>编辑</button>{#if view !== "spec"}<button class="text-button danger-text" disabled={working || publishing} onclick={() => deleteContent(item)}>删除</button>{/if}</div></div>{/each}</div>{#if !filteredItems.length}<div class="empty-state"><span>▤</span><h3>还没有找到内容</h3><p>换一个关键词，或创建新的内容。</p></div>{/if}</section>
	{:else if view === "assets" || view === "photos"}
		{#if view === "photos"}<div class="section-note"><p>选择一个相册后上传图片。封面、标签与相册名称在相册设置中维护。</p><div class="inline-actions"><button onclick={() => navigate("galleryConfig")}>相册设置</button>{#if album}<button onclick={() => openContent(`public/gallery/${album}/urls.txt`)}>管理远程照片</button>{/if}</div></div>{/if}<section class="panel">{@render assetPanel()}</section>
	{:else if view === "settings"}
		<div class="settings-grid">{#each Object.entries(configs) as [key, [title, description]]}<button class="setting-card" onclick={() => navigate(key)}><span class="setting-icon">{key === "siteConfig" ? "◈" : "◇"}</span><strong>{title}</strong><p>{description}</p><span class="setting-arrow">↗</span></button>{/each}</div><section class="panel external-panel"><h2>外部平台内容</h2><p>评论与留言的审核、Memos 动态、追番收藏、访问统计由对应平台保存。后台可修改连接与展示配置，内容本身请前往原平台管理。</p><div class="inline-actions"><a class="button" href="https://space.bilibili.com/" target="_blank" rel="noreferrer">哔哩哔哩 ↗</a><a class="button" href="https://bgm.tv/" target="_blank" rel="noreferrer">Bangumi ↗</a><a class="button" href="https://vndb.org/" target="_blank" rel="noreferrer">VNDB ↗</a><a class="button" href="https://myanimelist.net/" target="_blank" rel="noreferrer">MyAnimeList ↗</a></div></section>
	{:else if view === "publish"}
		<section class="panel publish-panel"><span class:failed={status?.phase === "failed"} class="publish-symbol">{publishing ? "◌" : status?.phase === "failed" ? "!" : "↗"}</span><h2>{publishing ? "正在准备新版本" : status?.phase === "failed" ? "这次发布没有完成" : status?.dirty ? "内容已就绪，等待发布" : "网站已同步"}</h2><p>{publishing ? "正在检查内容、生成页面和更新搜索。完成后会自动切换版本。" : status?.phase === "failed" ? "当前线上版本继续运行。请查看下方日志，修正问题后重新发布。" : "发布会包含所有已保存的内容、配置和文件。构建成功后，访客会看到新的版本。"}</p><div class="inline-actions"><button class="primary" onclick={publish} disabled={working || publishing}>{publishing ? "正在发布…" : "发布网站"}</button>{#if status?.previous}<button disabled={working || publishing} onclick={() => { if (confirm("将线上网站切回上一个正常版本？已保存的编辑内容会保留。")) void perform(async () => { status = await api<PublishStatus>("rollback", {}); notice = "线上网站已切回上一版本。"; }); }}>回退上一版</button>{/if}</div><div class="release-details"><span>当前内容版本 <strong>#{status?.version || 0}</strong></span><span>线上版本 <strong>{status?.active ? `#${status.active.version}` : "尚未发布"}</strong></span><span>上次发布 <strong>{status?.active ? dateLabel(status.active.at) : "—"}</strong></span></div></section><section class="panel"><div class="panel-heading"><h2>发布日志</h2><span class="muted">自动更新</span></div><pre class="build-log" aria-label="发布日志">{status?.log || "发布任务开始后，检查和构建结果会显示在这里。"}</pre></section>
	{:else if view === "history"}
		<section class="panel"><div class="panel-heading"><h2>最近的修改</h2><span class="muted">保留原文件，支持撤销</span></div>{#each history as item (item.id)}<div class="history-row"><span class="history-dot"></span><div><strong>{item.action}</strong><p>{item.file}</p><small>{dateLabel(item.at)}</small></div><button disabled={working || publishing} onclick={() => { if (confirm(`将 ${item.file} 恢复到这次修改之前？若此后已修改，会阻止覆盖。`)) void perform(async () => { await api("restore", { id: item.id }); history = await api<HistoryItem[]>("history"); await refreshStatus(); notice = "已恢复历史内容，请发布网站使其生效。"; }); }}>撤销修改</button></div>{/each}{#if !history.length}<div class="empty-state"><span>↶</span><h3>还没有修改记录</h3><p>通过后台保存或删除的内容，会自动记录在这里。</p></div>{/if}</section>
	{/if}
	<footer class="workspace-footer"><span>Firefly Studio</span><span>慢慢写，慢慢记录。</span></footer></main></div></div>
{/if}

{#if pick}
	<dialog class="asset-dialog" use:openDialog oncancel={() => pick = null}><div class="dialog-heading"><div><span class="eyebrow">MEDIA LIBRARY</span><h2>选择一个文件</h2></div><button onclick={() => pick = null} aria-label="关闭文件选择">×</button></div>{#if error}<div class="message error" role="alert">{error}</div>{/if}{@render assetPanel(true)}</dialog>
{/if}
