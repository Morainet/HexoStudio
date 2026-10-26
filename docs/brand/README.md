# HexoStudio Logo

![HexoStudio Icon](hexostudio-icon-black.png)

- 当前应用与网站图标：`hexostudio-icon-black.png`；原始配色保留在 `hexostudio-logo.png`。
- 格式：透明背景 PNG
- 设计：原始六边形 H 造型，柔光黑色。页面内部保留深色圆角底与白色 H 字母。
- 生成方式：内置 image_gen 工具（imagegen 技能）。
- 原始图为位图；favicon、macOS 和 Windows 图标已接入。

## 图标资源更新

当前源图为 `hexostudio-icon-black.png`，仅用于网站 favicon、主屏幕快捷方式和桌面图标；页面内部的 H 字母标记单独保留。

在 macOS 上运行 `npm run icons`，通过系统 `sips` 和 `iconutil` 更新：

- `public/favicon.svg`：支持系统深浅色的标签页图标；`favicon.ico`、`favicon-32.png` 为兼容格式。
- `public/icon-192.png`：高分辨率网站图标。
- `public/apple-touch-icon.png`：iOS 主屏幕快捷方式。
- `desktop/icons/icon.png`、`icon.ico`、`icon.icns`：桌面运行窗口、Dock 和安装包。

生成文件已提交，Windows 和 CI 打包无需运行转换命令。修改桌面图标后需要重新打包、安装应用才能更新系统中的图标。

## 当前版本

采用用户选定的柔光黑色图稿（内置 image_gen 生成），保持原始六边形 H 结构。此前的 Studio 双带交错方案保留为设计档案，不用于当前应用。

## 原始生成提示词

```text
Use case: logo-brand
Asset type: Primary brand symbol for HexoStudio, a modern Hexo blog writing and management application for web and desktop.
Primary request: Design one finished, distinctive minimalist logo symbol. Combine a clearly legible capital H with a compact hexagonal silhouette, using negative space to suggest two facing pages of a writing notebook. A confident mature software product identity, editorial, precise and calm.
Style/medium: Flat geometric vector-like logo, crisp edges, balanced optical weight, a small number of bold shapes with subtly softened corners. One unified mark, not multiple disconnected icons.
Color palette: Rich cobalt blue #4169E1 with a restrained violet #7467DF accent on a small portion of the mark. Use solid colors, no gradients. The colored silhouette must read on both white and charcoal backgrounds.
Composition: Square canvas, exactly one centered symbol, occupying approximately 75 percent of the width and height, generous even transparent margins.
Scene/backdrop: Genuinely transparent background with alpha, including negative spaces. No background plate.
Text: No wordmark, captions, slogans or other text. Only the integrated geometric H monogram.
Constraints: Recognizable at small application icon sizes. No tiny internal strokes. No 3D, shadows, glow, bevel, textures, mockup scene, perspective, decorative sparkles, pencil clip art, watermark, presentation board, variants or guides. Original mark rather than a copy of the Hexo logo.
```
