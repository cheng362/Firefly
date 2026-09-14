# 部署后的内容维护盘点

当前项目是 Astro 静态站点，没有数据库或原生管理 API。运营数据来自内容集合、配置常量、本地文件，以及少量外部平台。以下按实际路由、配置导入和文件扫描逻辑整理。

| 内容 | 当前来源 | 后台入口及操作 |
| --- | --- | --- |
| 博客文章、草稿 | `src/content/posts/**/*.{md,mdx}` | 文章：新建、编辑、删除、草稿开关、置顶、日期、分类、标签、系列、封面、作者、版权、访问密码 |
| 动态/说说 | `src/content/dynamic/**/*.md` | 动态：新建、编辑、删除、置顶、地点、正文图片；外部 Memos 模式除外 |
| 公告 | `src/config/announcementConfig.ts` | 公告：标题、正文、关闭开关与跳转链接；是否显示组件在侧边栏配置中调整 |
| 相册信息 | `src/config/galleryConfig.ts` | 相册：增删相册、名称、标识、说明、日期、地点、标签、封面、密码、列宽 |
| 相册照片 | `public/gallery/<id>/*`、`urls.txt` | 相册照片：直接上传、删除、远程照片列表；复制素材地址后可指定封面 |
| 图片、视频、音乐及附件 | `public/assets`、`public/uploads`、`public/favicon`、`src/assets/images`、文章目录内图片 | 文件库：列出受支持的素材、上传、预览/下载、复制链接、引用检查与删除 |
| 友链 | `src/config/friendsConfig.ts` | 友情链接：增删友链、头像、介绍、网址、标签、权重、启用开关及页面信息 |
| 书签导航 | `src/config/booknavConfig.ts` | 书签导航：增删分类和书签、排序、图标、介绍、favicon 配置 |
| 音乐播放器 | `src/config/musicConfig.ts` | 音乐：本地歌单条目、封面、歌词、平台歌单、音量与播放模式；音频由文件库上传 |
| 赞助页及名单 | `src/config/sponsorConfig.ts` | 赞助：收款方式、二维码、链接、用途、赞助者、金额、日期和显示设置 |
| 个人资料 | `src/config/profileConfig.ts` | 个人资料：头像、名称、签名、社交链接 |
| 关于、留言板、友链附加文案 | `src/content/spec/about.md`、`guestbook.md`、`friends.mdx` | 页面内容：编辑固定页面；MDX 有显式转换入口 |
| 页脚与备案文案 | `src/config/FooterConfig.html`、`footerConfig.ts` | 页面内容中的页脚编辑；页脚配置中的显示开关 |
| 网站名称、SEO 信息、建站时间、语言 | `src/config/siteConfig.ts` | 站点设置：可编辑常量及语言、页面开关；部分值继续服从环境变量覆盖 |
| 追番平台用户及展示设置 | `siteConfig.ts` 中 Bilibili/Bangumi/VNDB/MAL 设置 | 站点设置：账号标识、展示模式、分类、接口、NSFW 等原主题可配置项 |
| 导航菜单及搜索 | `src/config/navBarConfig.ts` | 导航菜单：原链接预设，以及新增的可视化自定义菜单列表，支持增删和上下移动子菜单 |
| 壁纸、背景视频、首页标题和副标题 | `src/config/backgroundWallpaper.ts` | 壁纸与横幅：图像/视频选择、轮播、首页文案、链接及显示效果 |
| 侧边栏及广告 | `src/config/sidebarConfig.ts` | 侧边栏：左右组件列表、顺序、开关、位置和组件专属内容 |
| 文章封面策略 | `src/config/coverImageConfig.ts` | 文章封面：默认图片、随机图片、显示策略 |
| 动态页面设置 | `src/config/dynamicConfig.ts` | 动态设置：标题、介绍、分页、评论、头像链接及 Memos 接入 |
| 评论服务设置 | `src/config/commentConfig.ts` | 评论服务：Twikoo/Waline/Artalk/Giscus/Disqus 等的已有连接参数 |
| 访问统计接入 | `src/config/analyticsConfig.ts` | 访问统计：Google Analytics、Umami、Clarity、51la 等原主题接入参数 |
| 字体与排版 | `src/config/fontConfig.ts` | 字体：字体列表、来源、字重、字体选择和分区域设置；可通过文件库上传本地字体 |
| 版权协议 | `src/config/licenseConfig.ts` | 版权协议：名称、链接、显示开关 |
| 访客显示设置面板 | `src/config/displaySettingsConfig.ts` | 访客设置面板：控制允许访客修改的外观选项 |
| 樱花等特效 | `src/config/effectsConfig.ts` | 动画特效：开关与效果参数 |
| 看板娘 | `src/config/pioConfig.ts` | 看板娘：模型地址、展示参数；模型程序及整套模型资源属于主题开发资产，不开放任意源码上传 |
| 代码和图表展示 | `expressiveCodeConfig.ts`、`mermaidConfig.ts`、`plantumlConfig.ts` | 对应高级配置表单：主题、代码折叠、徽章、图表服务与渲染参数 |

## 不在本地保存的运营数据

| 内容 | 实际保存位置 | 处理方式 |
| --- | --- | --- |
| 评论、留言、反应、评论审核 | 配置的评论服务 | 在对应服务管理，不伪造本地评论管理能力 |
| Memos 模式动态 | Memos 实例 | 在 Memos 发布/编辑；本地动态入口仍可维护本地集合 |
| 追番、书籍、游戏收藏与进度 | Bilibili、Bangumi、VNDB、MyAnimeList | 在原平台增删收藏，通过前台动态请求或重新构建更新 |
| 在线歌单及平台歌词 | Meting 对应平台 | 在音乐平台编辑歌单，本后台调整歌单连接和播放器设置 |
| 访客统计报表 | 已配置的统计平台 | 在原平台查看，本后台编辑接入配置 |

## 自动生成与主题开发文件

`dist`、`.astro`、Pagefind 索引、RSS、站点地图、OG 图片、LQIP 常量、GitHub 卡片缓存、VNDB 封面属于生成产物，由发布流程更新，不提供直接编辑入口。分类、标签、系列和归档由文章元信息自动派生。

Astro/Svelte 组件、布局、CSS、插件、脚本、图标库、看板娘运行库以及环境密钥属于开发或部署配置。后台不开放任意源码、服务器命令或环境变量编辑。现有 `public/anime-list.json` 为遗留空数据文件，当前前台路由没有读取它，不作为运营入口。
