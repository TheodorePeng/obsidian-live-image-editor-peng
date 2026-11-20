# Image Caption Peng

Write Markdown captions under images in Obsidian. Author them in Live Preview, read them in Reading View. The first release targets Obsidian 1.15.1 on macOS.

## Features

- Hover an image in Live Preview and click the **+** in its lower-left corner to create an HTML-marked caption directly below the image, with the cursor already on the caption line. Click the caption text or its blank area to edit an existing caption.
- The button draws an 11 px monochrome cross inside a 24 px transparent hit area. It steps aside when native image tools or overlays occupy the lower-left corner, and it stays hidden on images that already have a caption.
- A matched caption renders as a tinted strip attached under the image in both Live Preview and Reading View. It wraps to the image's actual displayed width and keeps following the image when the width changes.
- Captions support multiple paragraphs, emphasis, internal and external links, lists, and inline or block formulas. A formula wider than the image scrolls horizontally inside the formula area.
- Wiki images, native size parameters, and local or remote Markdown images are supported. Paragraph and list-item boundaries stop the match, so unrelated text is never captured.
- Empty captions show a placeholder in Live Preview and disappear in Reading View. An unpaired caption retains its text.
- Adding and editing integrate with Obsidian's undo and redo. To delete a caption, remove its two markers and the text between them. For a legacy caption, remove its entire fence.

## Install with BRAT

[BRAT](https://github.com/TfTHacker/obsidian42-brat) is the distribution channel for this plugin: it installs from this repository's GitHub Releases and delivers later versions to the same vault.

1. Install **BRAT** from Obsidian's Community Plugins and enable it.
2. Open the command palette and run **BRAT: Add a beta plugin for testing**.
3. Enter the repository `TheodorePeng/obsidian-image-caption-peng` and click **Add Plugin**.
4. Open Settings → Community plugins, refresh the list, and enable **Image Caption Peng**.

To update, run **BRAT: Check for updates to all beta plugins and UPDATE** from the command palette.

Every release ships three assets — `main.js`, `manifest.json`, and `styles.css` — and BRAT downloads all three. BRAT's own behavior can change over time, so confirm the current procedure in the [official BRAT repository](https://github.com/TfTHacker/obsidian42-brat) and the [BRAT developer guide](https://tfthacker.com/brat-developers).

## Manual installation

Copy `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/TheodorePeng/obsidian-image-caption-peng/releases/latest) into `<vault>/.obsidian/plugins/image-caption-peng/`, using the matching `plugins/` directory for a vault with a custom config folder. Then enable **Image Caption Peng** under **Settings → Community plugins**. If the plugin list does not show the new folder, refresh the list or reopen the vault.

## Syntax

````markdown
![[beam.png|300]]
<!-- image-caption:start -->
**Figure 1: Simply supported beam under load**

See [[Structural Mechanics]]. The mid-span moment is $M_{\max}=FL/4$.

<!-- image-caption:end -->
````

Inside a list, keep the image, both markers, and the caption text in the same list item. Indent the markers and text to the list item's continuation column.

````markdown
- First-level topic
  - Second-level topic

    ![[beam.png]]
    <!-- image-caption:start -->
    **Figure 2: Free-body diagram**

    $$
    M_{\max}=\frac{FL}{4}
    $$

    <!-- image-caption:end -->
````

One image occupies its own line. The plus inserts the opening marker immediately after the image and focuses the caption line. Leave a blank line before the closing marker, especially after a list inside the caption. Text between the comments is native Markdown, so Obsidian indexes its internal links. Existing `image-caption` code fences remain editable and keep their original syntax. When moving an image manually, move its caption with it.

## Lists and indentation

In **Live Preview**, put the cursor on the line of a single image, or select that image reference. Press **Tab** to indent and **Shift+Tab** to outdent. When the image has a closed caption in either format, the caption follows the image to its new list position and keeps its paragraphs, list indentation, formulas, and links. Each move is one step for **⌘Z** and one step for **⇧⌘Z**.

This works both for an image that owns its bullet and for an image on a continuation line of a bullet. If a keypress would detach the image from the unordered list, turn it into indented code, or break the pairing between image and caption, the image and its caption stay where they are. Ordered lists, multi-line or multi-cursor selections, images without a caption, unclosed captions, and Source mode keep Obsidian's native key behavior.

## Compatibility

The scope of this release is plain body text and lists. Tables, callouts, embedded notes, and multiple images on one line use their own native or third-party interaction. A third-party caption plugin can coexist with this plugin, in which case one image may show two captions. Mobile, older Obsidian versions, and third-party Markdown extensions have not been verified.

## Development

Use Node.js 22. Run `npm ci` to install dependencies and `npm run build` to produce `main.js`. Run `npm run typecheck`, `npm run lint`, and `npm test` to check the source. The bundle embeds the MIT license of the Markdown parser it uses.

## Version history

See [CHANGELOG.md](CHANGELOG.md).

---

# Image Caption Peng 中文说明

在 Obsidian 的图片下方写 Markdown 图注。使用 Live Preview 添加和编辑，使用 Reading View 阅读。首版适配 macOS Obsidian 1.15.1。

## 功能

- 在 Live Preview 中把鼠标移到还没有图注的图片上，点击图片内左下角的 **+**，直接输入图注。两条 HTML 注释标出图注的范围。已有图注的图片，点击图注正文或空白处即可编辑。
- 按钮使用 11 px 的单色十字和 24 px 的透明点击区。图片工具或浮层占用左下角时，按钮在图片内避让。图片太小、没有安全空位时，优先保留现有控件的操作空间。已有图注时加号隐藏。
- 已匹配的图注以主题浅底色条贴在图片下方，Live Preview 和 Reading View 一致。底色条随图片的实际显示宽度换行，图片宽度变化时继续跟随。
- 图注支持多段落、强调、内外部链接、列表与行内／块级公式。宽公式可以在公式区域横向滚动。
- 支持 Wiki 图片、原生尺寸参数以及本地和远程 Markdown 图片。段落和列表项边界会中断匹配，不会误收无关文本。
- 空图注在 Live Preview 中显示「添加图注内容」，在 Reading View 中隐藏。图注失联后仍保留正文。
- 添加和编辑可以使用 Obsidian 的撤销／重做。删除图注时，移除两条标记和其中的正文。旧格式请移除整个围栏。

## 通过 BRAT 安装

[BRAT](https://github.com/TfTHacker/obsidian42-brat) 是本插件的分发渠道：它从本仓库的 GitHub Releases 安装，并把后续版本更新到同一个 Vault。

1. 在 Obsidian 社区插件市场安装并启用 **BRAT**。
2. 打开命令面板，运行 **BRAT: Add a beta plugin for testing**。
3. 输入仓库地址 `TheodorePeng/obsidian-image-caption-peng`，点击 **Add Plugin**。
4. 打开 **设置 → 第三方插件**，刷新列表后启用 **Image Caption Peng**。

更新时在命令面板运行 **BRAT: Check for updates to all beta plugins and UPDATE**。

每个 Release 提供 `main.js`、`manifest.json` 和 `styles.css` 三个资产，BRAT 会一并下载。BRAT 的行为会随版本变化，请以 [BRAT 官方仓库](https://github.com/TfTHacker/obsidian42-brat) 和 [BRAT 开发者指南](https://tfthacker.com/brat-developers) 为准。

## 手动安装

从 [最新版本](https://github.com/TheodorePeng/obsidian-image-caption-peng/releases/latest) 下载 `main.js`、`manifest.json` 和 `styles.css`，复制到 Vault 的 `.obsidian/plugins/image-caption-peng/`。自定义配置目录的 Vault 使用对应的 `plugins/` 目录。然后在 **设置 → 第三方插件** 启用 **Image Caption Peng**。如果插件列表还未发现新目录，刷新插件列表或重新打开 Vault。

## 语法

````markdown
![[beam.png|300]]
<!-- image-caption:start -->
**图 1：简支梁受力分析**

详见 [[结构力学]]。跨中弯矩为 $M_{\max}=FL/4$。

<!-- image-caption:end -->
````

在列表内，让图片、标记和正文都归属同一个列表项。标记和正文使用该列表项的续行缩进。

````markdown
- 一级知识点
  - 二级知识点

    ![[beam.png]]
    <!-- image-caption:start -->
    **图 2：受力图**

    $$
    M_{\max}=\frac{FL}{4}
    $$

    <!-- image-caption:end -->
````

一张图片独占一行。点击加号后，开始标记紧接图片下一行，光标落在图注输入行。结束标记前留一空行，图注以列表结尾时尤其需要。标记之间是原生 Markdown，Obsidian 会索引其中的内部链接。旧 `image-caption` 代码围栏仍可显示和编辑，编辑时保留原格式。手工移动图片时，请一并移动图注。

## 列表与缩进

在 **Live Preview** 中，将光标放在单张图片所在行，或选中该图片引用。按 **Tab** 缩进，按 **Shift+Tab** 反缩进。图片已关联完整的图注时，图注会跟随新的列表归属，保留图注内的段落、列表缩进、公式和链接。每次移动可用 **⌘Z** 一次撤销、用 **⇧⌘Z** 一次重做。

独占 Bullet 的图片和位于 Bullet 续行的图片都适用。续行按键如果会让图片脱离无序列表、变成缩进代码，或无法保持原图和原图注的对应，图片和图注留在原位。有序列表、多行或多光标选区、无图注图片、未闭合图注和源码模式继续使用 Obsidian 的原生按键行为。

## 兼容性

本版本的适用范围是普通正文和列表。表格、Callout、嵌入笔记以及多图同在一行时，使用各自的原生或第三方交互。第三方图注插件可以与本插件并存，同一张图可能显示两条图注。移动端、较旧的 Obsidian 版本和第三方 Markdown 扩展的渲染效果尚未验收。

## 开发与验证

使用 Node.js 22。运行 `npm ci` 安装依赖，`npm run build` 生成 `main.js`。运行 `npm run typecheck`、`npm run lint` 和 `npm test` 检查源码。构建产物内含所用 Markdown 解析器的 MIT 许可证。

## 版本记录

见 [CHANGELOG.md](CHANGELOG.md)。
