<p align="center">
  <img src="https://raw.githubusercontent.com/Morainet/HexoStudio/main/docs/brand/hexostudio-logo.png" width="112" alt="HexoStudio Logo">
</p>

# HexoStudio

为 Hexo 博客打造的内容管理工作台。在网页或桌面程序中写文章、管理页面、调整主题配置，并通过 Git 同步源码。

**网页 · macOS · Windows** ｜ **本机目录 · GitHub · GitLab** ｜ **深浅色 · 中英文**

[快速开始](#快速开始) · [使用指南](https://github.com/Morainet/HexoStudio/blob/main/docs/guide.md) · [部署与配置](https://github.com/Morainet/HexoStudio/blob/main/docs/configuration.md) · [开发与发布](https://github.com/Morainet/HexoStudio/blob/main/docs/development.md)

![HexoStudio 深色工作台](https://raw.githubusercontent.com/Morainet/HexoStudio/main/docs/images/workspace-dark.png)

## 核心功能

- **内容管理**：文章、草稿、独立页面，支持搜索、筛选与分页。
- **Markdown 写作**：实时预览、快捷保存、图片粘贴与拖拽上传。
- **站点配置**：编辑 Hexo 与主题配置，保留注释和自定义字段。
- **Git 与部署**：查看差异、暂存、提交、拉取、推送，执行 Hexo 构建与部署。
- **账号与外观**：管理员登录，深色 / 浅色 / 跟随系统，简体中文 / English。

## 快速开始

准备 **Node.js 22.12+、npm、Git** 和一个 **Hexo 源码项目**，以及可连接的 **PostgreSQL、MySQL 或 MongoDB**。数据库用于保存管理员账号，本机运行也需要配置。

### 从源码启动

```bash
git clone https://github.com/Morainet/HexoStudio.git
cd HexoStudio
npm ci
npm run web
```

打开 [http://127.0.0.1:4545](http://127.0.0.1:4545)。启动桌面版则运行：

```bash
npm run desktop
```

### npm 命令行版

CLI 已实现，尚未首次发布到 npm。当前可从源码运行 `npm run web -- --port 4546`，或安装 [CI 构建产物](https://github.com/Morainet/HexoStudio/actions)中的 `.tgz`：

```bash
npm install -g ./hexostudio-0.8.0.tgz
hs start
```

正式发布后可使用 `npx --package hexostudio hs start`，或通过 `npm install -g hexostudio` 安装。运行 `hs --help` 查看端口、监听地址、博客目录和设置文件选项。

### 首次配置

按向导完成三步：

1. **连接数据库**：填写已有数据库的连接信息，账号需有创建表 / 集合及读写权限。
2. **设置管理员**：设置登录用户名和密码，密码至少 12 位。
3. **连接博客**：选择包含 `_config.yml` 的本机源码目录，或填写 GitHub / GitLab 仓库与访问 Token。

远端仓库会克隆到运行 HexoStudio 的机器上。保存内容后，可通过 Git 工作区提交和推送；线上博客更新还需执行自己的部署流程。

<details>
<summary>查看配置向导</summary>

![首次配置：连接数据库](https://raw.githubusercontent.com/Morainet/HexoStudio/main/docs/images/setup-database.png)

</details>

连接地址示例、Token 配置和常见问题见[使用指南](https://github.com/Morainet/HexoStudio/blob/main/docs/guide.md)。服务器部署见[部署与配置](https://github.com/Morainet/HexoStudio/blob/main/docs/configuration.md#在服务器上运行)。

## 开发与构建

| 命令 | 用途 |
| --- | --- |
| `npm run check` | JavaScript 语法检查 |
| `npm test` | 运行测试 |
| `npm run test:package` | 打包并在临时目录验证 npm 安装与启动 |
| `npm run package:mac` | 构建 macOS DMG / ZIP |
| `npm run package:win` | 构建 Windows x64 安装版 / 便携版 |

本机构建产物位于 `dist/`。GitHub Actions 提供：

- **CI**：运行 Node.js 22 / 24 检查、测试与漏洞扫描，在 Linux / Windows 验证 npm 安装包。
- **Desktop builds**：手动构建 macOS Apple Silicon / Intel、Windows x64 安装包；推送匹配版本的 `v*` 标签时创建 Release 草稿。

[查看 Actions](https://github.com/Morainet/HexoStudio/actions) · [构建与发布说明](https://github.com/Morainet/HexoStudio/blob/main/docs/development.md#github-actions-自动化)

当前安装包未配置签名和 macOS 公证，仍需在目标系统上验证安装与启动。

## 许可证

[MIT](https://github.com/Morainet/HexoStudio/blob/main/LICENSE)
