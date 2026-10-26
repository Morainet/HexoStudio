# OEM 品牌化

[返回首页](../README.md) · [部署指南](cloud-deployment.md)

## 部署后配置

管理员登录并连接博客后，打开侧栏「品牌设置」。默认保持 HexoStudio 原有外观；保存后在当前工作台立即生效，其他设备刷新后读取新配置。

- 产品名称、简介、登录标题和说明。
- 品牌 Logo、网站图标：HTTPS 图片地址或上传 PNG / JPEG / WebP，单张最多 256 KB。上传的图片直接随配置保存，不依赖服务器磁盘。
- 深浅色各自的主题色、页脚文字、帮助链接。
- GitHub 更新仓库：填公开仓库 `owner/repo` 使用自己发布的正式版本；留空关闭版本检查。网站的「部署已更新，刷新页面」检测仍保留。

主界面有品牌预览，更多字段默认折叠。登录文案仅影响登录，不会覆盖数据库、管理员等初始化步骤。自定义文本不会被界面语言自动翻译；恢复默认文案后会继续跟随中英文设置。

云端配置存入已有的共享数据库，本地与桌面配置保存到现有设置文件。读接口仅公开品牌字段，修改与恢复默认要求管理员登录及 CSRF 校验。两处同时修改时，后保存的一方会收到冲突提示，需要重新打开设置。

## 部署时指定默认品牌

所有部署方式均可设置 `HEXOSTUDIO_BRANDING`，内容为 **JSON 对象字符串**，只填写需要覆盖的字段：

```json
{"name":"Aurora Studio","tagline":"我的创作空间","accentLight":"#6d28d9","accentDark":"#c4b5fd","releaseRepository":""}
```

在 Vercel / Netlify / Render / Railway 的环境变量设置中直接粘贴 JSON，不额外添加外层引号，然后重新部署。Node.js 本机示例：

```bash
HEXOSTUDIO_BRANDING='{"name":"Aurora Studio","releaseRepository":""}' hs start
```

优先级：内置默认 → OEM 安装包默认 → 部署环境变量 → 管理界面已保存设置。「恢复部署默认」会清除界面覆盖值，重新使用部署默认值。

字段完整示例见仓库根目录 `oem.example.json` 的 `branding` 对象。**品牌配置为公开数据，不要填写数据库密码、Token 或其他凭据。** 图片地址由浏览器直接请求，不由服务端代下载。上传 SVG / HTML、脚本链接、非 HTTPS 外链会被拒绝。

环境变量改变后需重启或重新部署；运行期间通过管理界面修改无需重启。默认域名、数据库、初始化密钥继续按部署指南独立设置。

## 打包独立桌面应用

以下命令在项目源码仓库中执行，先安装开发依赖；npm 安装的 CLI 包不包含桌面打包工具。

页面内品牌可以即时修改。安装器名称、应用标识和 macOS / Windows 系统图标需要重新打包；修改网页品牌不会更换用户已经安装的程序图标。

1. 复制 `oem.example.json` 为自己的 `oem.json`，填写 `branding` 和唯一的 `desktop.appId`。`desktop.productName` 为安装包名称。
2. 如需替换原生图标，在 `desktop` 中加入以下对象，路径相对配置文件；三个格式须同时提供：

   ```json
   {"icons":{"mac":"./assets/icon.icns","win":"./assets/icon.ico","png":"./assets/icon.png"}}
   ```

3. 准备配置并在对应操作系统构建：

   ```bash
   npm run oem:prepare -- ./oem.json
   npm run package:mac -- --config dist/oem/electron-builder.json --publish never
   # Windows:
   npm run package:win -- --config dist/oem/electron-builder.json --publish never
   ```

生成的配置与品牌资源在 `dist/oem/`，安装包输出到 `dist/oem-build/`。OEM 包启动时使用自己的产品名和品牌默认值；本机设置放入该应用的 userData 目录，避免覆盖默认 HexoStudio 设置。不同 OEM 产品应使用不同名称、appId 以及独立数据库/部署配置。未提供原生图标时保留项目现有图标。

此命令准备打包配置，不负责代码签名、公证或发布。分发时保留项目的 MIT 许可证与版权声明。OEM 的正式版本检查要求其 GitHub Release 标签使用 `vX.Y.Z` 或 `X.Y.Z`，并在打包前更新项目 `package.json` / 锁文件版本；不应把上游安装包当作自己品牌的升级包。
