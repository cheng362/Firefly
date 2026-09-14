export const configCatalog = {
	announcementConfig: ["公告", "公告标题、内容与跳转链接"],
	galleryConfig: ["相册", "相册信息、封面、标签与访问密码"],
	friendsConfig: ["友情链接", "友链、权重、显示开关与页面设置"],
	booknavConfig: ["书签导航", "分类、书签与排序"],
	musicConfig: ["音乐", "本地歌单、歌词与音乐平台"],
	sponsorConfig: ["赞助", "收款方式、二维码与赞助者名单"],
	profileConfig: ["个人资料", "头像、昵称、签名与社交链接"],
	siteConfig: ["站点设置", "站点信息、页面开关、语言与文章展示"],
	backgroundWallpaper: ["壁纸与横幅", "桌面和手机壁纸、背景视频与首页文案"],
	navBarConfig: ["导航菜单", "菜单顺序、子菜单、链接预设与搜索"],
	sidebarConfig: ["侧边栏", "组件、公告显示开关、广告与布局"],
	dynamicConfig: ["动态设置", "本地动态 / Memos 数据源与展示设置"],
	commentConfig: ["评论服务", "评论服务连接配置；评论审核在对应服务中进行"],
	footerConfig: ["页脚设置", "自定义页脚开关；文案在页面内容中编辑"],
	coverImageConfig: ["文章封面", "默认封面、随机图片与展示规则"],
	displaySettingsConfig: ["访客设置面板", "访客可调整的外观选项"],
	fontConfig: ["字体", "字体库、字体选择与本地字体"],
	licenseConfig: ["版权协议", "文章版权名称与链接"],
	analyticsConfig: ["访问统计", "统计服务配置；统计报表在对应服务中查看"],
	effectsConfig: ["动画特效", "樱花等页面特效"],
	pioConfig: ["看板娘", "模型、位置与显示设置"],
	expressiveCodeConfig: ["代码展示", "代码主题、折叠与语言标识"],
	mermaidConfig: ["Mermaid 图表", "图表渲染配置"],
	plantumlConfig: ["PlantUML 图表", "图表服务与渲染配置"],
};

export const assetRoots = [
	"public/uploads",
	"public/gallery",
	"public/assets/images",
	"public/assets/music",
	"public/assets/videos",
	"public/assets/fonts",
	"public/favicon",
	"src/assets/images",
	"src/content/posts",
];
export const imageExtensions = [
	".jpg",
	".jpeg",
	".png",
	".webp",
	".avif",
	".gif",
];
export const assetExtensions = [
	...imageExtensions,
	".mp3",
	".wav",
	".ogg",
	".m4a",
	".mp4",
	".webm",
	".pdf",
	".zip",
	".txt",
	".lrc",
	".woff",
	".woff2",
	".ttf",
	".otf",
];

export function isEditablePath(file) {
	if (/^src\/content\/(posts|dynamic)\/.+\.mdx?$/.test(file)) return true;
	if (/^src\/content\/spec\/(about|friends|guestbook)\.mdx?$/.test(file))
		return true;
	if (
		file === "src/config/FooterConfig.html" ||
		file === "public/anime-list.json"
	)
		return true;
	if (Object.keys(configCatalog).some((id) => file === `src/config/${id}.ts`))
		return true;
	return (
		assetRoots.some((root) => file.startsWith(`${root}/`)) &&
		assetExtensions.some((ext) => file.toLowerCase().endsWith(ext))
	);
}
