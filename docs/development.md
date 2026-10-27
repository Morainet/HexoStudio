# 开发与发布

[返回首页](../README.md) · [使用指南](guide.md) · [部署与配置](configuration.md)

[常用命令](#常用命令) · [GitHub Actions](#github-actions-自动化) · [项目结构](#项目结构)

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁文件安装依赖 |
| `npm run web` | 启动网页服务 |
| `npm run desktop` | 启动 Electron 桌面程序 |
| `npm run check` | 检查前端、后端、桌面入口及测试的 JavaScript 语法 |
| `npm test` | 运行测试 |
| `npm run test:package` | 打包、检查文件白名单、在干净目录安装并验证 CLI 与 HTTP 服务 |
| `npm run package:mac` | 构建 macOS 的 DMG / ZIP |
| `npm run package:win` | 构建 Windows x64 的安装包 / 便携版 |

构建产物位于 `dist/`。正式分发前需准备签名证书，Windows 安装及运行仍需在 Windows 机器上验证。

## GitHub Actions 自动化

在仓库的 [Actions 页面](https://github.com/Morainet/HexoStudio/actions) 查看运行结果。

| 工作流 | 触发方式 | 执行内容 |
| --- | --- | --- |
| CI | 分支推送、Pull Request、手动运行 | Node.js 22 / 24 检查与测试、依赖扫描；Linux / Windows npm 包安装验证 |
| Release builds | 推送 `v*` 标签、手动运行 | 先检查与测试，再构建 macOS Apple Silicon / Intel、Windows x64 安装包 |

**下载测试安装包：** 选择 `Release builds` → `Run workflow`。完成后，在该次运行的 Artifacts 中下载对应平台的文件，保留 14 天。手动运行只生成构建产物。

**创建版本发布：** 先更新 `package.json` 与 `package-lock.json` 的版本并提交，确保检查通过，再推送对应标签。例如当前 `1.0.0` 版本：

```bash
git tag v1.0.0
git push origin v1.0.0
```

标签必须与 `package.json` 的版本一致。所有平台构建成功后，工作流会创建 GitHub Release **草稿**，上传 DMG、ZIP、Windows 安装版、便携版、已验证的 npm `.tgz` 和 `SHA256SUMS.txt`。检查产物与发布说明后，在 Releases 页面手动发布。重新运行可以更新草稿附件，已发布的 Release 不会被覆盖。

工作流使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需配置个人 Token 或博客数据库凭据；只有创建 Release 的任务拥有仓库内容写权限。如果仓库禁用了 Actions，需要先在仓库设置中启用。

当前构建未配置开发者签名或 macOS 公证，系统可能提示无法验证开发者。工作流验证代码和打包过程，安装及启动仍需在目标系统上验收。

开发与构建需要 Node.js 22.12 或更新版本。CI 和发布检查使用 `npm audit --audit-level=high`，包含 Electron 等开发依赖；检测到已知高危或严重漏洞时会失败，阻止发布任务继续。漏洞扫描不能代替代码审查和目标系统验收。

## npm 包验证与发布

npm 包名为 `hexostudio`，安装后的命令为 `hs`，许可证为 MIT。包中仅包含 CLI、网页后端、静态界面、文字文档及许可证；安装它不会安装 Electron 和桌面打包工具。桌面版继续通过 GitHub Releases 分发。

```bash
npm ci
npm run check
npm test
npm run test:package
```

最后一步会在临时目录安装真实 `.tgz`，验证命令入口、从其他目录启动、页面资源、未登录接口保护和服务退出。验证通过的文件保存在 `dist/npm/hexostudio-<版本>.tgz`；GitHub CI 也会保存它供下载。

首次发布需要维护者的 npm 账号和该包名的发布权限。查询时包名尚未注册，并不代表已预留。确认版本、许可证、CI 结果以及发布清单后，可手动执行：

```bash
npm login
npm publish --dry-run
npm publish
```

`prepublishOnly` 会依次检查语法、测试、验证安装包及扫描依赖漏洞。源码工作区必须包含完整开发依赖与测试。当前工作流不会自动发布到 npm，也不需要配置 npm Token。

发布成功后，再移除 README 中「尚未首次发布」的提示。后续升级需先更新 `package.json` 与锁文件的版本，已发布的同一版本不能重复使用。

## 项目结构

```text
HexoStudio/
├── .github/workflows/  # 持续检查与桌面构建、Release 草稿
├── bin/                # npm 命令入口
├── scripts/            # 语法检查与发布版本验证
├── public/             # 共享网页界面、样式、翻译与显示偏好
├── server/             # HTTP API、Hexo 文件操作、Git、认证与数据库适配
├── desktop/            # Electron 主进程与预加载脚本
├── test/               # 功能与回归测试
└── docs/               # 使用、部署、开发文档与品牌素材
```

翻译文案集中在 `public/i18n.js`，两套外观使用 `public/style.css` 中的颜色变量。
