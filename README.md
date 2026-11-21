# Live Image Editor Peng

Crop local images and write Markdown captions in Obsidian. Edit in Live Preview and see the results in both views. Supports Obsidian 1.15.1 or later on desktop.

## Features

- In Live Preview, hover a local image and choose **Crop** or **Add Caption**. The first caption or crop wraps that image in a figure. The original attachment is preserved.
- A figure displays one image with its optional Markdown caption. Use the compact lower-left buttons or the image menu. Click a caption and type directly underneath the image. Obsidian handles Markdown, wikilink suggestions and undo in the same editor. For a figure with a caption, click its text or choose **Edit caption** from the image menu. The lower-right handle adjusts the displayed size.
- While editing a caption, Live Preview shows the opening and closing comments. Press **Enter** at the end of the closing comment to start a line outside the figure. Use **Edit Markdown** in the image menu to reach those markers directly.
- Select the image and press **Shift+Tab** to move the figure up one level. **Tab** moves it back to its previous position or into the preceding eligible bullet. These keys move the figure only. The image menu also offers the available moves. Each move is one undo step.

## Install with BRAT

The installation ID remains `image-caption-peng` for upgrades from Image Caption Peng.

[BRAT](https://github.com/TfTHacker/obsidian42-brat) is the distribution channel for this plugin: it installs from this repository's GitHub Releases and delivers later versions to the same vault.

1. Install **BRAT** from Obsidian's Community Plugins and enable it.
2. Open the command palette and run **BRAT: Add a beta plugin for testing**.
3. Enter the repository `TheodorePeng/live-image-editor-peng` and click **Add Plugin**.
4. Open Settings → Community plugins, refresh the list, and enable **Live Image Editor Peng**.

To update, run **BRAT: Check for updates to all beta plugins and UPDATE** from the command palette.

Every release ships three assets — `main.js`, `manifest.json`, and `styles.css` — and BRAT downloads all three. BRAT's own behavior can change over time, so confirm the current procedure in the [official BRAT repository](https://github.com/TfTHacker/obsidian42-brat) and the [BRAT developer guide](https://tfthacker.com/brat-developers).

## Manual installation

Copy `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/TheodorePeng/live-image-editor-peng/releases/latest) into `<vault>/.obsidian/plugins/image-caption-peng/`, using the matching `plugins/` directory for a vault with a custom config folder. Then enable **Live Image Editor Peng** under **Settings → Community plugins**. If the plugin list does not show the new folder, refresh the list or reopen the vault.

## Syntax

A figure starts with one versioned HTML comment and ends with a separate closing comment. Put exactly one Wiki or Markdown image on the next line. The caption is optional and uses ordinary Markdown. Crop coordinates are normalized to the original image.

```markdown
<!-- live-image-figure:v1 {"crop":{"x":0.25,"y":0.25,"width":0.5,"height":0.25}} -->
![[beam.png|320]]

**Beam under load.** See [[Structural Mechanics]].

<!-- /live-image-figure -->
```

If a figure has a caption and no crop, start it with `<!-- live-image-figure:v1 -->`. With the plugin disabled, Obsidian displays the original image and caption. Older caption and crop markers appear as ordinary Markdown.

### Unordered lists and Canvas

An image at the end of a titled bullet moves to the next line when first cropped or captioned. A continuation image stays under its item. A child bullet containing only an image becomes a continuation of its parent. Both figure comments start on their own lines. For an older misaligned figure, right-click the image and choose **Align list indentation** (对齐列表缩进) when available.

Choose **Select Figure Source** from the image menu or the command palette, then use the normal copy shortcut. To repair a figure, select everything from the opening comment to the closing comment and run **Repair Selected Figure Indentation**. The opening comment gives the indentation. An empty caption takes up no space in Live Preview or Reading View. Use **Add Caption** on the image or in its context menu to open the caption editor.

In Canvas, double-click a Markdown file or text card to edit it. File cards save to the source note. Text cards save to the card. Notes embedded in a text card show their figures and can be edited in the source note. Direct image-file cards, tables, quotes and Callouts use their native rendering.

## Development

Use Node.js 22. Run `npm ci` to install dependencies and `npm run build` to produce `main.js`. Run `npm run typecheck`, `npm run lint`, and `npm test` to check the source. The bundle embeds the MIT license of the Markdown parser it uses.

## Version history

See [CHANGELOG.md](CHANGELOG.md).

---

# Live Image Editor Peng 中文说明

在 Obsidian 中裁剪本地图片并编写 Markdown 图注。在 Live Preview 编辑，在两种视图查看结果。支持桌面端 Obsidian 1.15.1 或更新版本。

## 功能

- 在 Live Preview 悬停本地图片，点击左下角 **裁剪** 或 **Add Caption**。添加图注或首次确认裁剪时创建图块，原附件保留原样。
- 每个图块包含一张图和可选的 Markdown 图注。点击图片下方的图注即可原位编辑，可使用原生 Markdown、`[[` 链接建议和撤销。已有图注时可直接点击正文，也可在图片右键菜单选择 **编辑图注**。右下角手柄调整显示尺寸。窄图可用右键菜单打开裁剪和图注。
- 编辑图注时显示当前图块的首尾注释。在结束注释末尾按 **Enter**，在图块外新建一行。也可从图片菜单选择 **编辑 Markdown** 到达标记。
- 单击选中图片后按 **Shift+Tab**，将整块图文升一级。按 **Tab** 返回刚离开的原位置，或缩进到紧邻在前的合法 Bullet。图片菜单也提供当前可用的移动操作。每次移动可一步撤销。

## 通过 BRAT 安装

从 Image Caption Peng 升级时，安装 ID 仍为 `image-caption-peng`。

[BRAT](https://github.com/TfTHacker/obsidian42-brat) 是本插件的分发渠道：它从本仓库的 GitHub Releases 安装，并把后续版本更新到同一个 Vault。

1. 在 Obsidian 社区插件市场安装并启用 **BRAT**。
2. 打开命令面板，运行 **BRAT: Add a beta plugin for testing**。
3. 输入仓库地址 `TheodorePeng/live-image-editor-peng`，点击 **Add Plugin**。
4. 打开 **设置 → 第三方插件**，刷新列表后启用 **Live Image Editor Peng**。

更新时在命令面板运行 **BRAT: Check for updates to all beta plugins and UPDATE**。

每个 Release 提供 `main.js`、`manifest.json` 和 `styles.css` 三个资产，BRAT 会一并下载。BRAT 的行为会随版本变化，请以 [BRAT 官方仓库](https://github.com/TfTHacker/obsidian42-brat) 和 [BRAT 开发者指南](https://tfthacker.com/brat-developers) 为准。

## 手动安装

从 [最新版本](https://github.com/TheodorePeng/live-image-editor-peng/releases/latest) 下载 `main.js`、`manifest.json` 和 `styles.css`，复制到 Vault 的 `.obsidian/plugins/image-caption-peng/`。自定义配置目录的 Vault 使用对应的 `plugins/` 目录。然后在 **设置 → 第三方插件** 启用 **Live Image Editor Peng**。如果插件列表还未发现新目录，刷新插件列表或重新打开 Vault。

## 语法

开头和结尾分别是一条 HTML 注释。开头下一行放一张 Wiki 或 Markdown 图片，后面可以写 Markdown 图注。裁剪坐标是相对于原图的比例。

```markdown
<!-- live-image-figure:v1 {"crop":{"x":0.25,"y":0.25,"width":0.5,"height":0.25}} -->
![[beam.png|320]]

**简支梁受力图。** 详见 [[结构力学]]。

<!-- /live-image-figure -->
```

只有图注时，开头可写为 `<!-- live-image-figure:v1 -->`。停用插件后，Obsidian 显示原图和图注正文。旧裁剪、图注标记按普通 Markdown 显示。

### 列表和 Canvas

裁剪或添加图注时，列表标题末尾的单张图片移到下一行。独占续行的图片继续属于原列表项，仅含图片的子 Bullet 转成父项的续行。图块首尾注释各占一行。以前生成的图块如果缩进不齐，可以右击该图片，选择 **对齐列表缩进**。

从图片右键菜单或命令面板选择 **Select Figure Source**，然后使用原生复制快捷键。图块错位时，选中包括首尾注释的单个图块，运行 **Repair Selected Figure Indentation**。命令以开头注释所在列为准。空图注收起后只显示图片。点击图片上的加号或选择右键菜单中的 **Add Caption** 即可原位编辑。

双击 Canvas 中的 Markdown 文件卡片或文本卡片进入编辑。文件卡片写回源笔记，文本卡片写回自身。文本卡片内嵌入的笔记可显示图块，编辑时请打开源笔记。直接拖入的图片文件卡片、表格、引用与 Callout 使用原生渲染。

## 开发与验证

使用 Node.js 22。运行 `npm ci` 安装依赖，`npm run build` 生成 `main.js`。运行 `npm run typecheck`、`npm run lint` 和 `npm test` 检查源码。构建产物内含所用 Markdown 解析器的 MIT 许可证。

## 版本记录

见 [CHANGELOG.md](CHANGELOG.md)。
