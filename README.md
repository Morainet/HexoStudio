# HexoStudio

一个管理本机或 GitHub / GitLab 仓库中 Hexo 源码的工作台。网页与 macOS / Windows 桌面版共用同一套界面和后端。

## 功能

- 连接现有 Hexo 项目，浏览、搜索、新建、编辑和删除 `source/_posts` 中的 Markdown 文章
- 在「页面管理」浏览、搜索、新建、编辑和删除 `source/` 下的独立 Markdown 页面；新建页面使用 `source/<页面路径>/index.md`，保留主题自定义 front matter
- 在草稿箱管理 `source/_drafts`，支持创建、编辑和发布草稿；同名文章发布时自动换名
- 编辑原始 front matter，保留主题使用的自定义字段；支持 Markdown、表格、代码块和图片预览
- 写作工具栏支持标题、加粗、斜体和链接；可选择、粘贴或拖入 PNG/JPEG/GIF/WebP 图片
- 在文章信息侧栏编辑标题、日期、标签和分类；未修改的 front matter 字段和主题自定义字段保持原样
- 图片库列出此前上传的图片，点击即可重新插入文章
- 未保存内容备份到当前浏览器或桌面程序的本机草稿，重新打开文章时可恢复
- 查看和编辑站点 `_config.yml`、根目录 `_config.<主题>.yml/json` 以及已安装主题的 `_config.yml`；离开未保存的配置时给出提醒
- 运行项目自身的 `hexo clean`、`hexo generate`、`hexo deploy`，实时查看日志
- 保存时检查外部修改，避免覆盖其他编辑器中的更改
- 通过 GitHub / GitLab 仓库地址和访问 Token 连接远端博客，支持指定分支和仓库内的博客子目录
- Git 工作区展示文件变更，可预览工作区和暂存区的差异、选择暂存、取消暂存、提交、检查远端、拉取和推送；本机 Git 仓库也可使用这些操作
- 首次在本机创建管理员账号，之后通过用户名和密码登录；支持退出及修改密码

## 网页版（本机运行）

需要 Node.js 20 或更新版本。首次运行先安装依赖：

```bash
npm install
npm run web
```

在浏览器打开 `http://127.0.0.1:4545`，首次访问先创建管理员账号（密码至少 12 个字符），再选择“本机目录”并输入 Hexo 项目绝对路径，或选择“GitHub / GitLab”填写仓库、Token、分支和博客路径。账号密码也适用于桌面版。也可以直接指定本机项目：

```bash
HEXO_ROOT=/path/to/your/blog npm run web
```

Windows PowerShell：

```powershell
$env:HEXO_ROOT='C:\path\to\blog'; npm run web
```

默认只监听本机。若自行设置 `HEXOSTUDIO_HOST` 为非本机地址，仍必须同时设置 `HEXOSTUDIO_TOKEN`，用于脚本通过 `Authorization: Bearer` 调用接口；浏览器则使用管理员登录。先在本机完成首次设置，再考虑开放其他地址。对外提供网页时应使用 HTTPS 反向代理，并设置 `HEXOSTUDIO_COOKIE_SECURE=1`；不要直接将 HTTP 服务暴露到公网。

## 桌面版

```bash
npm install
npm run desktop
```

打包：运行 `npm run package:mac` 生成 macOS 包，运行 `npm run package:win` 生成 Windows x64 包。安装包输出到 `dist/`。正式分发前需要用自己的证书签名；Windows 安装包仍应在 Windows 机器上进行安装和功能验证。

## 工作方式

HexoStudio 不维护独立文章数据库。文章和配置仍是博客源码中的文件。远端连接会将仓库克隆到用户主目录的 `.hexostudio/repositories/`，编辑后需在 Git 工作区暂存、提交并推送。一个文件若在暂存后又被修改，可分别预览暂存区与工作区差异；提交只包含已暂存的版本。检查远端只更新远端跟踪状态，拉取采用快进模式，且要求工作区没有未提交变更。Git 操作需要系统已安装 Git。运行构建或部署命令前，博客目录需要已执行 `npm install`，且其中存在 `node_modules/.bin/hexo`；刚克隆的仓库通常还没有安装依赖。

网页和桌面版共用用户主目录的 `.hexostudio.json` 保存项目路径、远端连接配置、管理员用户名及加盐 scrypt 密码哈希。文件在 macOS 上设置为仅当前用户可读写；Windows 下位于当前用户主目录。Git Token 不会写入 Git 远端 URL，也不会返回给前端。可用 `HEXOSTUDIO_SETTINGS` 覆盖设置文件位置。建议使用仅授权目标仓库内容读写的 Token。登录会话仅保存在服务器内存，服务重启后需重新登录；Cookie 设置为 HttpOnly、SameSite=Strict，写入接口还检查 CSRF 令牌。

上传图片保存在博客的 `source/images/hexostudio/`，每张最大 8 MB，文章中插入 `/images/hexostudio/...` 路径。草稿只保存在当前浏览器或桌面程序的本机存储，正式保存后才写入 Hexo 文章文件。

文章信息侧栏修改的字段会在保存时写回 front matter。已有的其他 YAML 字段和正文保持原样；复杂的主题字段仍可在 Markdown 原文里直接编辑。图片库只展示 HexoStudio 上传目录中的图片，不会删除图片，避免已有文章引用失效。

新建草稿默认不写入发布日期。发布时，若草稿没有日期，会补入当前本机时间，并从 `source/_drafts` 移到 `source/_posts`；已有日期保持原样。发布为文章后，仍需按博客原有流程构建和部署。Hexo 的草稿目录及发布行为见[官方写作说明](https://hexo.io/zh-cn/docs/writing)。

## 当前范围

远端模式目前支持 github.com 和 gitlab.com 的 HTTPS 仓库，不含自建 GitLab、SSH、自动解决合并冲突或云端托管后台。外部图床、友链和统计尚未实现。Markdown 预览为轻量预览，Hexo 标签插件和主题渲染以正式 `hexo generate` 结果为准。
