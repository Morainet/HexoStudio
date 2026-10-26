# HexoStudio Logo

![HexoStudio Logo](hexostudio-logo-studio.png)

- 当前图标：`hexostudio-logo-studio.png`；原始配色保留在 `hexostudio-logo.png`。
- 格式：白底 PNG
- 设计：黑白双带交错结构，形成六边形轮廓与中央 H 留白。
- 生成方式：内置 image_gen 工具（imagegen 技能）。
- 原始图为位图；favicon、macOS 和 Windows 图标已接入。

## 图标资源更新

当前源图为 `hexostudio-logo-studio.png`，网站和桌面端共用同一 Logo。

在 macOS 上运行 `npm run icons`，通过系统 `sips` 和 `iconutil` 更新：

- `public/favicon.svg`：标签页图标；`favicon.ico`、`favicon-32.png` 为兼容格式。
- `public/icon-192.png`：网站及工作台 Logo。
- `public/apple-touch-icon.png`：iOS 主屏幕快捷方式。
- `desktop/icons/icon.png`、`icon.ico`、`icon.icns`：桌面运行窗口、Dock 和安装包。

生成文件已提交，Windows 和 CI 打包无需运行转换命令。修改桌面图标后需要重新打包、安装应用才能更新系统中的图标。

## Studio 版设计提示词

通过内置 image_gen 工具生成，提示词保存在 `studio-prompt.txt`。参考 Android Studio 的几何工具感及 ChatGPT 的连续结构，采用独立的双带交错标记。所有平台使用静态、平面黑白图标；网站内部 Logo 在深色主题下反色。

参考：[Android Studio](https://developer.android.com/studio)、[OpenAI 品牌设计](https://openai.com/brand/)。

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
