export type Value =
	| string
	| number
	| boolean
	| null
	| Value[]
	| { [key: string]: Value };
export type Schema = {
	kind: string;
	fields?: Record<string, Schema>;
	item?: Schema;
	variants?: Schema[];
	options?: (string | number)[];
	optional?: boolean;
	help?: string;
};
export type ConfigDocument = {
	file: string;
	revision: string | null;
	blocks: { id: string; value: Value; schema: Schema }[];
};
export type ContentDocument = {
	file: string;
	revision: string | null;
	kind: string;
	body: string;
	meta: Record<string, Value>;
	schema: Schema;
	mdx?: boolean;
};
export type ContentItem = {
	file: string;
	revision: string;
	title: string;
	published: string;
	draft: boolean;
	pinned: boolean;
};
export type Asset = {
	file: string;
	url: string;
	name: string;
	size: number;
	modified: string;
	image: boolean;
};
export type Release = { directory: string; version: number; at: string };
export type PublishStatus = {
	phase: string;
	log: string;
	dirty: boolean;
	version: number;
	active: Release | null;
	previous: Release | null;
	startedAt: string | null;
	finishedAt: string | null;
};
export type HistoryItem = {
	id: string;
	file: string;
	action: string;
	at: string;
	before: string | null;
	after: string | null;
};
export type Session = {
	authenticated: boolean;
	username?: string;
	csrf?: string;
};

export function defaultValue(schema: Schema): Value {
	if (schema.options) return schema.options[0];
	if (schema.kind === "union")
		return defaultValue(schema.variants?.[0] || { kind: "string" });
	if (schema.kind === "array") return [];
	if (schema.kind === "object")
		return Object.fromEntries(
			Object.entries(schema.fields || {})
				.filter(([, field]) => !field.optional && field.kind !== "readonly")
				.map(([key, field]) => [key, defaultValue(field)]),
		);
	if (schema.kind === "boolean") return false;
	if (schema.kind === "number") return 0;
	if (schema.kind === "null") return null;
	return "";
}

export const fieldLabels: Record<string, string> = {
	title: "标题",
	name: "名称",
	content: "内容",
	description: "描述",
	desc: "简介",
	bio: "个人签名",
	url: "链接地址",
	link: "跳转链接",
	links: "链接列表",
	text: "显示文字",
	enable: "启用",
	enabled: "启用",
	closable: "允许访客关闭",
	external: "在新窗口打开",
	albums: "相册列表",
	columnWidth: "照片最小宽度（像素）",
	id: "唯一标识",
	cover: "封面图片",
	date: "日期",
	tags: "标签",
	location: "地点",
	password: "访问密码",
	passwordHint: "密码提示",
	avatar: "头像",
	imgurl: "头像图片",
	siteurl: "网站地址",
	weight: "排序权重",
	showName: "显示名称",
	icon: "图标",
	methods: "赞助方式",
	sponsors: "赞助者",
	qrCode: "收款二维码",
	usage: "赞助说明",
	amount: "金额",
	showSponsorsList: "显示赞助名单",
	showComment: "显示评论",
	showButtonInPost: "文章底部赞助按钮",
	playlist: "歌单",
	local: "本地音乐",
	meting: "在线音乐平台",
	artist: "歌手",
	lrc: "歌词或歌词文件地址",
	mode: "模式",
	volume: "默认音量（0–1）",
	playMode: "播放顺序",
	showLyrics: "显示歌词",
	showInNavbar: "显示在导航栏",
	showInSidebar: "显示在侧边栏",
	published: "发布时间",
	updated: "更新时间",
	draft: "设为草稿",
	pinned: "置顶",
	comment: "允许评论",
	image: "文章封面",
	category: "分类",
	author: "作者",
	lang: "语言",
	series: "所属系列",
	seriesOrder: "系列排序",
	slug: "自定义网址",
	sourceLink: "原文地址",
	licenseName: "版权协议名称",
	licenseUrl: "版权协议地址",
	site_url: "网站完整地址",
	subtitle: "副标题",
	keywords: "关键词",
	themeColor: "主题色",
	hue: "色相（0–360）",
	defaultMode: "默认外观",
	pageWidth: "页面宽度",
	card: "卡片外观",
	border: "显示边框",
	followTheme: "跟随主题色",
	favicon: "网站图标",
	navbar: "导航栏",
	logo: "站点标志",
	value: "内容",
	valueDark: "深色模式图片",
	alt: "替代文字",
	navbarMode: "导航栏行为",
	widthFull: "全宽显示",
	menuAlign: "菜单对齐",
	siteStartDate: "建站日期",
	timezone: "时区",
	pages: "页面开关",
	friends: "友情链接",
	guestbook: "留言板",
	dynamic: "动态",
	gallery: "相册",
	booknav: "书签导航",
	sponsor: "赞助",
	bilibili: "哔哩哔哩追番",
	bangumi: "番组计划",
	vndb: "VNDB",
	mal: "MyAnimeList",
	children: "子菜单",
	pageKey: "关联页面开关",
	src: "图片来源",
	desktop: "电脑端",
	mobile: "手机端",
	playerEnable: "启用背景视频",
	playerUrl: "视频地址",
	playerMode: "视频播放顺序",
	common: "通用设置",
	homeText: "首页文字",
	titleSize: "标题字号",
	subtitleSize: "副标题字号",
	typewriter: "打字效果",
	linksEnable: "显示链接",
	carousel: "壁纸轮播",
	interval: "切换间隔（毫秒）",
	transitionEffect: "切换效果",
	dimOpacity: "背景暗度",
	waves: "水波纹",
	gradient: "渐变过渡",
	banner: "横幅",
	fullscreen: "全屏壁纸",
	overlay: "透明效果",
	position: "位置",
	blur: "模糊度",
	cardOpacity: "卡片不透明度",
	opacity: "不透明度",
	layout: "布局",
	transparentMode: "透明模式",
	leftComponents: "左侧组件",
	rightComponents: "右侧组件",
	mobileComponents: "手机组件",
	type: "类型",
	specificConfig: "组件内容",
	showTitle: "显示标题",
	showOnPostPage: "在文章页显示",
	hideOnNonPostPage: "只在文章页显示",
	randomizeSort: "随机排序",
	showCustomContent: "显示页面附加内容",
	items: "条目",
	profileUrl: "个人主页地址",
	itemsPerPage: "每页数量",
	fallbackApis: "备用接口",
	api: "接口地址",
	apiUrl: "接口地址",
	server: "服务地址或平台",
	auth: "服务认证参数",
	parent: "用户标识",
	userId: "用户 ID",
	username: "用户名",
	selected: "使用的字体",
	fontsList: "字体列表",
	fontConfig: "字体设置",
	provider: "字体来源",
	weights: "字重",
	styles: "样式",
	subsets: "字符集",
	fallbacks: "后备字体",
	cssVariable: "字体标识",
	SITE_LANG: "网站语言",
	siteConfig: "网站配置",
	announcementConfig: "公告",
	galleryConfig: "相册设置",
	customNavBarConfig: "自定义菜单（启用后替换主题菜单）",
	LinkPresets: "主题菜单链接",
	navBarSearchConfig: "搜索设置",
	friendsPageConfig: "友链页面",
	friendsConfig: "友链列表",
	booknavPageConfig: "书签页面",
	booknavConfig: "书签分类",
	footerConfig: "页脚",
	profileConfig: "个人资料",
	sponsorConfig: "赞助设置",
	musicPlayerConfig: "音乐设置",
	dynamicConfig: "动态设置",
	backgroundWallpaper: "背景设置",
	sidebarLayoutConfig: "侧边栏设置",
};

export const labelFor = (key: string): string => fieldLabels[key] || key;
