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
| `npm run package:mac` | 构建 macOS 的 DMG / ZIP |
| `npm run package:win` | 构建 Windows x64 的安装包 / 便携版 |

构建产物位于 `dist/`。正式分发前需准备签名证书，Windows 安装及运行仍需在 Windows 机器上验证。

## GitHub Actions 自动化

在仓库的 [Actions 页面](https://github.com/Morainet/HexoStudio/actions) 查看运行结果。

| 工作流 | 触发方式 | 执行内容 |
| --- | --- | --- |
| CI | 分支推送、Pull Request、手动运行 | 在 Node.js 20 / 22 / 24 上安装锁定依赖、检查语法、运行测试 |
| Desktop builds | 推送 `v*` 标签、手动运行 | 先检查与测试，再构建 macOS Apple Silicon / Intel、Windows x64 安装包 |

**下载测试安装包：** 选择 `Desktop builds` → `Run workflow`。完成后，在该次运行的 Artifacts 中下载对应平台的文件，保留 14 天。手动运行只生成构建产物。

**创建版本发布：** 先更新 `package.json` 与 `package-lock.json` 的版本并提交，确保检查通过，再推送对应标签。例如当前 `0.8.0` 版本：

```bash
git tag v0.8.0
git push origin v0.8.0
```

标签必须与 `package.json` 的版本一致。所有平台构建成功后，工作流会创建 GitHub Release **草稿**，上传 DMG、ZIP、Windows 安装版、便携版和 `SHA256SUMS.txt`。检查产物与发布说明后，在 Releases 页面手动发布。重新运行可以更新草稿附件，已发布的 Release 不会被覆盖。

工作流使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需配置个人 Token 或博客数据库凭据；只有创建 Release 的任务拥有仓库内容写权限。如果仓库禁用了 Actions，需要先在仓库设置中启用。

当前构建未配置开发者签名或 macOS 公证，系统可能提示无法验证开发者。工作流验证代码和打包过程，安装及启动仍需在目标系统上验收。

## 项目结构

```text
HexoStudio/
├── .github/workflows/  # 持续检查与桌面构建、Release 草稿
├── scripts/            # 语法检查与发布版本验证
├── public/             # 共享网页界面、样式、翻译与显示偏好
├── server/             # HTTP API、Hexo 文件操作、Git、认证与数据库适配
├── desktop/            # Electron 主进程与预加载脚本
├── test/               # 功能与回归测试
└── docs/               # 使用、部署、开发文档与品牌素材
```

翻译文案集中在 `public/i18n.js`，两套外观使用 `public/style.css` 中的颜色变量。
