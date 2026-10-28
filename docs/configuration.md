# 部署与配置

[返回首页](../README.md) · [使用指南](guide.md) · [开发与发布](development.md)

本文介绍本地 / 桌面模式。Vercel、Netlify、Render、Railway、Docker 和通用 Node.js 云端部署请看 **[云端部署指南](cloud-deployment.md)**；云端使用数据库共享状态，无需本机设置文件或持久磁盘。

[数据与账号](#数据存放与账号管理) · [环境变量](#环境变量) · [服务器部署](#在服务器上运行)

## 数据存放与账号管理

| 数据 | 默认存放位置 |
| --- | --- |
| 文章、草稿、页面、主题配置 | Hexo 项目目录 |
| 上传图片 | 博客的 `source/images/hexostudio/` |
| 远端仓库工作副本 | 运行机器的 `~/.hexostudio/repositories/` |
| 项目路径、仓库 Token、数据库连接信息 | 当前系统用户的 `~/.hexostudio.json` |
| 管理员用户名、随机盐、scrypt 密码哈希 | 用户配置的数据库 |
| 未保存的文章备份、显示偏好 | 当前浏览器或桌面程序的本机存储 |
| 登录会话 | 服务端内存，服务重启后需要重新登录 |

账号数据库不存储博客正文。仓库 Token 和数据库密码不返回给前端，Token 也不会写入 Git 远端 URL。设置文件在 macOS / Linux 上设为仅当前用户可读写，Windows 下使用系统账户权限保护。

登录后可以在「账号存储」迁移到另一数据库。迁移会复制账号哈希、验证目标记录，并使全部会话退出；原数据库中的账号记录会保留。

<details>
<summary>旧版本的本机账号存储</summary>

新建与迁移入口仅提供 PostgreSQL、MySQL、MongoDB。旧版本存放在 SQLite 或本机设置文件中的管理员账号仍可登录，并迁移到上述数据库。

### MongoDB Atlas 与代理

在数据库连接表单展开「代理设置（可选）」，填写代理软件实际启用的 SOCKS5 / mixed 端口，例如 `socks5://127.0.0.1:7890`（端口以软件配置为准）。留空使用统一网络设置；未配置统一代理时为直连。系统 HTTP 代理不会自动用于 MongoDB。代理认证可使用 `socks5://用户名:密码@主机:端口`，特殊字符需 URL 编码。代理配置随数据库连接保存，不返回给浏览器。

Atlas 的 IP 访问列表应允许数据库流量的实际出口 IP，使用节点代理时可能与本机公网 IP 不同。SOCKS5 负责数据库 TCP 连接，`mongodb+srv://` 的 SRV/TXT 查询仍由系统 DNS 完成；DNS 报错时检查系统 DNS，或改用 Atlas 生成的标准 `mongodb://` 地址，保留全部节点、TLS、replicaSet 和 authSource 等参数。

应用等待 MongoDB 服务器选择最多 20 秒，单次 TCP 连接最多 10 秒。连接失败会区分 DNS、TLS、代理、网络、认证和权限问题，提示不会包含原始连接字符串。不要通过关闭 TLS 校验解决连接问题。数据库用户名应来自 Atlas Database Access，不是 Atlas 网站的登录账号。

### 统一网络设置

登录后打开侧栏「网络设置」。支持 GitHub / GitLab API、AI 请求、更新检查、应用内 Git 操作，以及 PostgreSQL、MySQL、MongoDB 连接：

| 模式 | 行为 |
| --- | --- |
| 保持现有配置 | 保留原有行为及系统 Git 自己的配置，不自动读取 Windows 系统代理。 |
| 直连 | 应用 HTTP 请求与数据库使用直连，应用内 Git 操作忽略环境代理及 GitHub / GitLab 的代理设置。数据库单独填写的代理仍优先。 |
| 手动 SOCKS5 | 填入实际 SOCKS5 / mixed 端口，统一代理以上连接。数据库可单独指定另一 SOCKS5 代理。 |

保存后对新连接生效，无需重启。切换为直连或保持现有配置会清除已保存的统一代理凭据。代理地址只在服务端保存；浏览器只会看到主机和端口，留空输入可保留已保存地址。设置接口要求管理员登录及跨站校验，配置版本冲突会拒绝覆盖。

CLI 或桌面程序启动前也可设置 `HEXOSTUDIO_PROXY_URL=socks5://127.0.0.1:7890`。该环境变量优先于界面配置，界面会显示为只读。云端部署同样使用这个环境变量，代理必须是部署服务器能够访问的服务，云端 `127.0.0.1` 不代表你的 Windows 电脑。

AI 始终先通过系统 DNS 验证所有目标地址为公网地址，再让代理连接已验证的 IP；HTTPS 仍校验证书，不会将密钥发送到未验证的服务器。AI DNS 与 Atlas 的 SRV/TXT 查询需要可用的系统 DNS。外部浏览器、Hexo 构建插件和部署插件使用各自的网络配置。

应用内 Git 代理适用于 HTTP / HTTPS 远端。已有本地仓库若使用 SSH 地址，仍需在系统 SSH 配置中设置代理。手动代理连接失败时不会自动回退为直连。

</details>

## 命令行启动

安装 npm 包后使用 `hs start`（无参数的 `hs` 同样启动服务）。源码开发可使用 `npm run web -- <选项>`。

```bash
hs start --port 4546 --root /path/to/blog
hs start --settings ./studio-settings.json
hs --help
hs --version
hs doctor
hs doctor --settings ./studio-settings.json --json
hs start -d --port 4546
hs status --json
hs open
hs restart
hs logs --lines 100
hs stop
hs config path
hs help start
```

| 参数 | 作用 |
| --- | --- |
| `--port` / `-p` | 监听端口，默认 4545；设为 0 自动分配 |
| `--host` | 监听 IP 或 localhost，默认 127.0.0.1 |
| `--root` | 固定 Hexo 源码目录；省略时可在界面中选择本机或远端项目 |
| `--settings` | 设置文件位置，默认 `~/.hexostudio.json` |
| `--background` / `-d` | 本机模式下后台启动，由 `hs stop` 管理 |
| `--open` | `start` / `restart` 成功后打开默认浏览器 |
| `--help` / `-h` | 显示帮助 |
| `--version` / `-v` | 显示版本 |

命令行参数优先于对应环境变量；相对路径以运行命令时的目录为基准。端口占用时会报错，可指定其他端口。按 Ctrl+C 停止服务。博客、管理员配置和凭据不会写入 npm 安装目录，更新 npm 包会保留这些外部数据。

启动时会显示访问地址、版本和设置文件位置。设置文件损坏或不是 JSON 对象时会直接退出，修复后再启动；不会自动覆盖现有配置。路径支持 `~`，例如 `--settings "~/studio/settings.json"`。

### 后台服务管理

`hs start -d` 启动后可关闭终端。`hs status` 查看地址、进程、版本与日志位置，`hs open` 打开工作台，`hs restart` 按原来的主机地址、端口参数和博客目录重启，`hs stop` 停止。重复启动同一实例会返回现有服务；需要更改端口或博客目录时，先停止，再带新参数启动。

这些命令按 `--settings` 选择实例。使用自定义设置文件启动后，后续管理命令也要指定相同文件，例如：

```bash
hs start -d --settings ./studio.json --port 4546
hs status --settings ./studio.json
hs stop --settings ./studio.json
```

只管理 `hs start -d` 创建的后台服务；前台 `hs start` 使用 Ctrl+C 停止。后台模式不提供开机自启或异常自动拉起。云端服务继续使用平台或进程管理器运行前台命令。

运行记录与日志位于设置文件所在目录的 `.hexostudio-runtime/` 下，各实例独立。macOS / Linux 的运行目录限制为当前用户访问，控制凭据文件权限为 `0600`。停止时通过本机专用接口验证服务身份，不会根据磁盘记录的 PID 直接结束其他程序。

`hs logs --lines 100` 查看最近日志，默认 50 行，最多 1000 行 / 256 KB。`hs config path` 只输出设置文件路径，账号、数据库与 AI 配置仍在网页中管理。

`hs status --json` 供脚本读取；退出码为 `0`（运行）、`1`（未运行）、`2`（记录中的服务无法验证或连接）。`hs stop` 在服务已停止时也会成功。运行 `hs <命令> --help` 查看该命令的参数，不支持的参数会直接报错。

### 环境诊断

`hs doctor` 检查 Git、设置文件格式、数据库连接信息格式和 Hexo 源码目录，并提示博客依赖是否安装。它不会修改文件、连接数据库或启动服务，也不会输出 Token、密码和完整连接字符串。数据库连通性仍需通过网页中的验证操作检查。

输出中的 `PASS` 表示检查通过，`WARN` 表示尚未配置或缺少可选能力，`FAIL` 表示需要处理的错误。有 `FAIL` 时退出码为 1，否则为 0；`--json` 可供脚本读取，仅适用于 `doctor`。诊断不检测端口占用，也不代表完整安全审计通过。

Token 只通过环境变量配置，不提供命令行 Token 参数。使用 `--host 0.0.0.0` 等非本机地址仍需设置 `HEXOSTUDIO_TOKEN`，并按下文配置公网入口。

## 环境变量

以下变量用于启动 HexoStudio 服务：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HEXOSTUDIO_BRANDING` | 内置品牌 | 公开品牌 JSON 配置，见 [OEM 品牌化](branding.md) |
| `HEXO_ROOT` | 已保存的项目目录 | 指定 Hexo 源码路径；设置后不能通过界面切换项目 |
| `HEXOSTUDIO_PORT` | `4545` | 网页服务端口；桌面版使用自动分配的端口 |
| `HEXOSTUDIO_HOST` | `127.0.0.1` | 网页服务监听地址 |
| `HEXOSTUDIO_SETTINGS` | `~/.hexostudio.json` | 指定设置文件路径 |
| `HEXOSTUDIO_TOKEN` | 未设置 | 服务 API 的 Bearer Token；监听非本机地址时必须设置，与仓库访问 Token 不同 |
| `HEXOSTUDIO_COOKIE_SECURE` | 未设置 | 设为 `1` 时启用 Secure 会话 Cookie，适用于 HTTPS 入口 |

指定博客目录启动，macOS / Linux：

```bash
HEXO_ROOT=/path/to/your/blog npm run web
```

Windows PowerShell：

```powershell
$env:HEXO_ROOT = 'C:\path\to\blog'
npm run web
```

### 在服务器上运行

当前默认使用方式是在本机运行。自行部署到服务器时，需要准备 Node.js、Git、账号数据库，以及可写的项目和设置文件目录。

首次设置限制为本机访问，应先通过服务器本机入口完成初始化。对外提供网页时，使用 HTTPS 反向代理，并配置 `HEXOSTUDIO_COOKIE_SECURE=1`。若调整为监听非本机地址，还必须设置 `HEXOSTUDIO_TOKEN`；浏览器仍通过管理员账号登录。

以上为使用本地文件模式的服务器部署方式。使用云端仓库模式可选择项目提供的部署配置，详见[云端部署指南](cloud-deployment.md)。数据库服务仍需单独准备。

### 安全边界

- 登录按连接来源地址限流：15 分钟内最多 5 次失败或进行中的尝试，全进程最多同时处理 8 次登录。成功登录仅移除本次计数；限流状态保存在内存中，重启后清空。
- 使用反向代理时，来源地址可能是代理地址，多位访问者会共享限流。服务不直接信任客户端传入的转发地址头；公网入口应另外配置访问限制和限流，并使用 HTTPS。
- 站点与主题配置文件及其项目内父目录禁止使用符号链接。请将需要编辑的配置存放为博客目录中的普通文件。
- Git Token 和数据库连接信息仍保存在仅当前系统用户可读写的设置文件中；这不防护已经控制系统账户的攻击者。使用低权限运行账号、限定仓库权限的 Token，并保留独立备份。
- Hexo 构建会执行博客自身的插件与脚本，只连接并构建可信仓库。当前未提供双因素认证或构建沙箱。
