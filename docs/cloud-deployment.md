# 云端部署

[返回首页](../README.md) · [本地与桌面配置](configuration.md)

云端模式通过 **GitHub / GitLab API** 管理博客，不需要克隆仓库、安装 Git 或挂载持久磁盘。管理员、会话、限流状态和仓库凭据存入你提供的数据库，适用于 Serverless 和常驻 Node.js 服务。

## 选择平台

| 平台 | 仓库内配置 | 运行方式 |
| --- | --- | --- |
| Vercel | `vercel.json`、`api/entry.js` | Node.js Function |
| Netlify | `netlify.toml`、`netlify/functions/entry.mjs` | Node.js Function |
| Render | `render.yaml`、`Dockerfile` | Docker Web Service |
| Railway | `railway.json`、`Dockerfile` | Docker Service |
| 自建服务器 / 其他容器平台 | `Dockerfile`、`compose.yaml` | Docker |
| 其他 Node.js 平台 | `npm start` | Node.js 22.12+ 常驻服务 |

这些配置部署的是 **HexoStudio 后台**。博客站点由博客源码仓库自己的 GitHub Actions、GitLab CI 或托管平台构建。纯静态托管（如 GitHub Pages）不能运行后台；Cloudflare Workers 尚未适配。

## 1. 准备数据库与密钥

创建专用于 HexoStudio 的 PostgreSQL、MySQL 或 MongoDB 数据库。数据库需要允许应用连接，并授予创建表 / 集合及读写权限。建议与应用选择邻近区域，按数据库供应商要求开启 TLS。

在部署平台的 **Environment Variables / Secrets** 中填写以下变量，参考根目录 `.env.cloud.example`：

| 变量 | 必填 | 内容 |
| --- | --- | --- |
| `HEXOSTUDIO_MODE` | 是 | `cloud`；仓库提供的函数入口和 Docker 镜像已设置 |
| `HEXOSTUDIO_DATABASE_URL` | 是，或使用下方 MongoDB 集成变量 | 数据库连接 URI，需包含数据库名称；优先于 `MONGODB_URI` |
| `MONGODB_URI` | MongoDB 集成可用 | Vercel MongoDB Atlas 原生集成自动注入；未设置 `HEXOSTUDIO_DATABASE_URL` 时读取 |
| `HEXOSTUDIO_ORIGIN` | 是 | 后台固定访问地址，例如 `https://studio.example.com`，不带路径 |
| `HEXOSTUDIO_SECRET` | 是 | 64 位十六进制随机密钥，用于加密数据库内容 |
| `HEXOSTUDIO_SETUP_KEY` | 是 | 至少 32 字符的独立随机密钥，用于首次创建管理员 |
| `HEXOSTUDIO_DATABASE_NAME` | 否 | MongoDB 数据库名；默认从 URI 读取 |
| `HEXOSTUDIO_HOST` | 常驻服务 | 设为 `0.0.0.0`；Docker 已设置，函数入口无需设置 |
| `PORT` | 常驻服务 | 使用平台分配的端口；`HEXOSTUDIO_PORT` 和 `--port` 优先级更高 |

连接 URI 格式：

```text
postgresql://username:password@host:5432/hexostudio?sslmode=require
mysql://username:password@host:3306/hexostudio
mongodb+srv://username:password@cluster.example/hexostudio
```

以上密码均为占位符；特殊字符需 URL 编码。MySQL TLS 参数使用供应商提供的连接方式，例如 URI 中 URL 编码的 `ssl` 配置；不要为了连接成功而关闭证书校验。MongoDB 连接串必须指向具体数据库，或单独填写数据库名。

分别执行两次下面的命令，生成 `HEXOSTUDIO_SECRET` 与 `HEXOSTUDIO_SETUP_KEY`，不要使用相同值：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

**备份数据库时同时妥善备份 `HEXOSTUDIO_SECRET`。** 后续重新部署或迁移平台必须保持它不变；丢失后无法解密原有账号、会话和仓库凭据。初始化密钥也需保留在部署环境中，但已有管理员时不能用它覆盖账号。

每个独立实例使用独立数据库。生产与预览环境不要共用数据库和密钥；多个生产副本则使用完全相同的数据库、密钥与访问域名。不配置预览环境的密钥时，预览实例会返回 503，不会退回本地模式。

## 2. 部署后台

### Vercel

1. Fork 仓库，在 Vercel 导入 **HexoStudio 仓库**，根目录保持仓库根目录。
2. Framework Preset 选 **Other**，Node.js 选 **22.x 或 24.x**。安装、构建、输出目录及路由由 `vercel.json` 提供。
3. 填入上述环境变量。`HEXOSTUDIO_ORIGIN` 使用固定生产域名；尚未确定域名时，先创建项目取得域名，再填写变量并重新部署。
4. 部署完成后打开固定域名。不要直接访问 `/api/entry`，也不要用不同的预览域名执行写操作。

函数入口自动启用云端模式，静态资源与 API 都经同一个处理器返回。无需设置本机目录或 `HEXOSTUDIO_TOKEN`。

**MongoDB Atlas 原生集成：** 在 Vercel Marketplace 创建 Atlas 集群并连接到项目的 Production 环境，应用会直接读取自动注入的 `MONGODB_URI`。设置 `HEXOSTUDIO_DATABASE_NAME=hexostudio`，以及上文的固定域名、加密密钥和初始化密钥；无需另存一份数据库密码。若之前配置过其他数据库，应先备份其数据，再移除旧的 `HEXOSTUDIO_DATABASE_URL`，否则它仍会优先使用。切换连接不会自动迁移已有管理员和后台配置。

### Netlify

1. 导入 HexoStudio 仓库，使用仓库的 `netlify.toml`；不要覆盖 Functions directory、构建命令与发布目录。
2. 在项目环境变量中填写上述配置，并使其对 **Functions runtime** 生效。构建使用 Node.js 22，函数运行时选择 Node.js 22 或以上。
3. 将 `HEXOSTUDIO_ORIGIN` 设置为固定站点域名，部署后访问该地址。

这里使用普通 Node.js Functions，不使用 Edge Functions。静态资源会一起打包；不依赖函数实例中的可写磁盘。

### Render

在 Render 新建 **Blueprint**，选择仓库，导入 `render.yaml`。按提示填写数据库、固定域名和两项密钥；平台从 `Dockerfile` 构建服务。数据库单独创建或使用已有服务。本模板不会自动购买数据库或创建数据库服务。

### Railway

导入仓库后会使用 `railway.json` 和 `Dockerfile`。添加环境变量，生成服务域名，将它填入 `HEXOSTUDIO_ORIGIN` 后重新部署。应用自动读取 Railway 的 `PORT`。

### Docker / 自建服务器

```bash
cp .env.cloud.example .env.cloud
# 编辑 .env.cloud，填写真实数据库、域名和两项随机密钥
docker compose up -d --build
docker compose logs -f hexostudio
```

Compose 默认只将后台绑定到服务器的 `127.0.0.1:4545`，使用 Nginx / Caddy 将 HTTPS 域名反向代理到该端口。入口域名必须与 `HEXOSTUDIO_ORIGIN` 一致。容器以非 root 用户、只读文件系统运行，内容与账号都不依赖容器卷。

如需本机试运行，设置 `HEXOSTUDIO_ORIGIN=http://127.0.0.1:4545`，再用该地址访问。公网域名必须使用 HTTPS。

### 其他 Node.js 平台

```bash
npm ci --omit=dev --ignore-scripts
# 在平台设置 HEXOSTUDIO_MODE=cloud、HEXOSTUDIO_HOST=0.0.0.0
# 以及上面的数据库、域名和密钥变量
npm start
```

源码环境也可以用 Node.js 原生环境文件启动：

```bash
node --env-file=.env.cloud bin/hs.cjs start --host 0.0.0.0
```

`GET /api/health` 是进程存活检查，不检查数据库与仓库。`hs doctor` 在云端模式只验证环境变量格式，不连接数据库；实际数据库连通性由进入配置页面的请求验证。

## 3. 首次配置

1. 打开后台，输入部署时的 **初始化密钥**，创建用户名和至少 8 位的密码。数据库已由部署环境配置，网页无需重复填写。
2. 连接 GitHub 或 GitLab 仓库：填写仓库、Token，可选分支及博客子目录。留空分支会使用当前默认分支；子目录内应有 `_config.yml`。
3. 开始管理文章、草稿、页面、图片和配置。

GitHub Token 需要所选仓库的 **Contents: Read and write** 权限；GitLab Token 需要仓库访问及 `api` 权限。仅支持 `github.com`、`gitlab.com`，暂不支持自建实例。受保护分支需要允许该凭据直接提交，否则保存会失败；当前没有自动创建 PR / MR 的流程。

## 云端与本地的区别

| 行为 | 云端模式 | 本地 / 桌面模式 |
| --- | --- | --- |
| 博客来源 | 远端仓库 API | 本机目录或克隆的仓库 |
| 新建、保存、删除、图片上传 | 直接向所选分支创建提交 | 修改本机文件，由用户提交 / 推送 |
| 草稿发布 | 同一次提交中移动到 `_posts` | 移动本机文件 |
| 冲突处理 | 校验文件版本；GitHub 同时校验分支推进 | 检查本机文件版本与 Git 状态 |
| 构建 / 部署 | 打开仓库流水线，由自动化执行 | 执行已安装的 Hexo 命令 |
| 管理员、会话、仓库凭据 | 数据库共享状态，AES-256-GCM 加密 | 账号在数据库，设置在本机，会话在内存 |
| 数据库变更 | 平台环境变量及数据库备份迁移 | 界面中的「账号存储」迁移 |

云端单个文本文件上限 **1 MB**，图片上限 **3 MB**，每类内容最多加载 **500 篇**。文章列表需要访问仓库 API；文章较多、API 额度不足或 Serverless 请求超时时，可选择常驻容器并减少仓库内容。超时后先刷新确认提交结果，再重试；平台超时不等于远端提交一定失败。

目前沿用 Hexo 默认的 `source/_posts`、`source/_drafts` 路径；不跟随仓库符号链接或子模块。普通 YAML 配置按文本保存，JSON 会验证语法。

## 安全与维护

- 管理员密码使用随机盐和 scrypt 哈希；仓库 Token 不返回前端。整个共享状态再使用部署密钥加密后写入数据库的 `hexostudio_cloud` 表 / 集合。
- 写请求必须匹配固定 Origin；登录后写操作还需会话 CSRF Token。Cookie 使用 HttpOnly、SameSite=Strict，HTTPS 地址自动加 Secure。
- 登录会话有效期 12 小时，可跨实例使用；退出当前会话或修改密码会同步到全部实例，改密码会注销全部会话。
- 单管理员共享 15 分钟最多 5 次失败或进行中的登录 / 改密尝试，重启不会清空。公网入口可另外配置平台 WAF 限流，避免恶意请求持续占用这个额度。
- 数据库和加密密钥同时泄露仍会暴露仓库凭据。限定 Token 权限，定期更新依赖并保留仓库、数据库和密钥的独立备份。
- 本地模式的账号不会自动迁移到云端。新模式使用独立的表 / 集合；跨平台迁移整个云端实例应备份并还原数据库，保留原密钥，再更新访问域名。

部署模板及本地自动化验证不等于已在你的云账户完成上线。平台区域、数据库防火墙、分支权限与实际部署结果仍需在目标环境确认。

平台参考：[Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)、[Netlify Functions 配置](https://docs.netlify.com/build/functions/configuration/)、[Render Blueprint](https://render.com/docs/blueprint-spec)、[Railway 配置](https://docs.railway.com/config-as-code/reference)。

## OEM 品牌化

登录后使用侧栏「品牌设置」自定义名称、Logo、登录文案、主题色和更新仓库；配置保存到共享数据库。也可用 `HEXOSTUDIO_BRANDING` 环境变量指定部署默认值，详见 [OEM 品牌化](branding.md)。
