# 部署与配置

[返回首页](../README.md) · [使用指南](guide.md) · [开发与发布](development.md)

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

</details>

## 环境变量

以下变量用于启动 HexoStudio 服务：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
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

数据库服务需单独准备，项目目前未提供一键云部署或自动创建数据库服务的流程。
