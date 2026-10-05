# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[![AI-assisted development: ChatGPT](https://img.shields.io/badge/AI--assisted-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![AI-assisted development: DeepSeek](https://img.shields.io/badge/AI--assisted-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

本项目的代码几乎全部由 ChatGPT 和 DeepSeek 生成。

[English](README.md) | **简体中文**

在 Zotero 中统一管理文献笔记、想法卡片和自己的思考。

## 安装

manifest 支持 Zotero 7–10。从 [Releases](https://github.com/lzcn/zotero-knowledge-base/releases) 下载 XPI，通过 **工具 → 插件 → 从文件安装插件** 安装，然后重启 Zotero。

## 使用

打开 **工具 → 知识库**，按类型筛选和新建笔记。

- **文献笔记（Literature Note）**：每个文献条目一篇。从条目侧栏打开，首次使用时创建，再次打开复用同一篇；必须关联文献来源。
- **卡片（Zettel）**：记录一个想法，同一条目可有多张卡片。
- **思考笔记（Thinking Note）**：容纳 Ideas、Projects、综述、文章草稿和导航，来源可留空。

三类笔记共用原生编辑器、搜索、链接、层级和图谱。新建且尚未保存的笔记可以选择 Zettel 或 Thinking Note；已有笔记以纯文本显示类型，可在**更多（…）**中互转 Zettel 与 Thinking Note，保留原笔记身份和旧 Key 链接；Literature Note 只能从文献条目创建。**来源**标签标明关联的 Zotero 条目，元信息在 Zotero 中维护；**上级**用于组织笔记层级。来源与上级以紧凑、可点击的引用显示，在**更多（…）**中修改。来源使用 Zotero 原生 CSL 参考文献引擎，可在**设置 → Knowledge Base → 参考文献格式**中选择已安装的格式，打开的引用会立即刷新。作者、斜体、编号、DOI 和网址均遵循所选格式；在上级选择列表中选“无上级”即可解除关系。全宽编辑器上方显示上级导航；底部的关联区按需展开，纵向显示子笔记、引用和反向链接，以“key · 标题”显示并支持长标题换行，可直接点击打开笔记。

每张卡片写一个想法，选择来源，用 `[[ID]]` 连接相关卡片。每篇笔记保留唯一内部 ID。引用标识在列表、详情和编辑器中不加双括号；点击详情或编辑器中的标识，仍复制 `[[引用标识]]` 链接。Zettel 的 Key 自动生成且不可修改；Thinking Note 默认也自动生成 Key，可以在 **Key** 中自行修改，使用 `[[自定义-key]]` 链接同一笔记。改 Key 不改变内部 ID，旧链接仍然有效。Literature Note 使用 `[[@CitationKey]]`，引用键缺失或重复时使用 `[[ID]]`。`[[ID]]` 保持原样且可点击；用 `[[ID|自定文字]]` 或 `[自定文字](knowledge-base://card/ID)` 指定链接文字。用 `[@CitationKey]` 引用条目，阅读时显示可点击的作者年份；引用键来自 Zotero、Better BibTeX 或 Extra 中的 `Citation Key:`。Zotero 笔记用普通的 `[自定标题](zotero://select/…)` 超链接。卡片库默认显示全部卡片，可筛选入口点；列表摘要和前进／后退帮助返回之前的想法。编辑、在图谱中显示和删除位于顶部工具栏，右侧主要用于阅读；预览图片按原比例缩小以适应面板。每张卡片最多一个父卡片，图谱分别展示层级、引用和来源。图谱参考 [Better Notes](https://github.com/windingwind/zotero-better-notes/blob/master/addon/chrome/content/libraryGraph.html) 使用力导向布局：相互连接的笔记聚集在一起，连接较多的节点更大。悬停显示完整标题并高亮邻居；拖动节点调整位置。搜索高亮匹配的笔记；点击空白处或按 Escape 清除选择。直接在图谱中选择显示关系，选择会保存，并保留节点位置和缩放。拖动分隔线可调整列表和图谱详情栏宽度。层级、向外链接和反向链接分为三组，点击展开。

Knowledge Base 工作台在 Zotero 标签页中打开，选中列表中的笔记即可直接编辑。切换笔记前先保存当前改动；遇到冲突时保留当前编辑器。**更多（…）→ 在独立窗口中打开**提供专注编辑窗口。关闭工作台时保留尚未保存的恢复草稿。卡片使用 Zotero 原生笔记编辑器，保留原来的排版、字体和对齐方式。直接使用原生排版、表格、图片、引用和公式编辑；选中公式即可就地修改 LaTeX。第一个标题就是卡片标题。正文由 Zotero 自动保存，来源和卡片关系在停止操作片刻后保存。“保存”与 `Ctrl/Cmd+S` 保持窗口打开。`Ctrl/Cmd+K` 搜索要链接的卡片；工具栏中的笔记链接图标用于插入笔记链接。点击来源引用打开条目，在**更多（…）→ 更换来源**中搜索来源；Zettel 和 Thinking Note 也可选择**未关联来源**。

点击编辑器工具栏最左侧的 Markdown 图标切换，再点一次返回富文本。Zotero 自己的笔记侧栏、标签页和独立窗口也提供这个入口，无需 Better Notes。普通笔记不会因切换而自动纳入 Knowledge Base，只修改原笔记正文。Markdown 自动保存，`Ctrl/Cmd+S` 可立即保存；冲突或中断的草稿在再次打开 Markdown 时恢复。

Markdown 与富文本共用一个页面和工具栏，修改同一篇 Zotero 笔记。公式用 `$…$` 或 `$$…$$`，普通表格使用 Markdown。CodeMirror 编辑完整 Markdown 文档，标题也在正文中。参考 Better Notes，原生引用、标注和图片显示为简洁的小块，底层保留原始 HTML 和元数据；这些对象在原生编辑器中修改。保存时检测 Zotero 或 Better Notes 是否修改过内容，冲突时保留草稿并阻止覆盖。仅切换且不修改 Markdown 不会重写正文。

原生编辑器始终是所见即所得，不再提供单独的浏览模式。`Ctrl/Cmd+E` 切换 Markdown 与原生编辑。Ctrl/Cmd 点击链接跳转。`Ctrl/Cmd+W` 在卡片信息尚未保存时提供保存、取消、保留草稿；原生编辑器已经保存的正文会保留。恢复草稿先以只读预览显示，点击保存后应用到笔记。冲突草稿仍可恢复，**另存为新卡片** 保留两个版本，并复制嵌入图片。

来源可留空。有文献条目来源的笔记放在该条目下面；无来源的放在自身文献库的 **个人知识（Personal Knowledge）** 父条目下。这个条目用于收纳自己的笔记，不作为文献来源，名称可以修改。插件不为这个父条目添加标签或标签颜色，已有的用户标签和颜色保持不变。来源若是附属笔记，则放在它所属的文献条目下；独立来源笔记或其他文献库的来源仍保留链接，卡片笔记放在自身文献库的个人知识条目下。来源缺失或已在回收站时，笔记保留原来的位置。保存时将原笔记移到所选来源下，即使来源没有变化也会校正位置。清除来源后回到个人知识条目，保持笔记 ID。插件新建的笔记在启动时整理。

## 数据与备份

正文和嵌入图片使用 Zotero 原生存储和正常同步。卡片 ID、来源、层级、图谱链接和草稿仍位于 `knowledge-base.sqlite`，暂不通过 Zotero 同步。在 Zotero 中编辑关联笔记会刷新本机卡片。删除插件新建的笔记会将关联原生笔记移入 Zotero 回收站；此前关联的用户笔记从知识库移除时仍保留原笔记。原笔记被删除或不可用时保留内容缓存和关系；可在知识库恢复回收站中的原记录，永久删除的内容可从缓存另存为新笔记。来源缺失时保留原来的键，直到主动重新关联，不自动移动笔记。

退出 Zotero 后备份整个 Zotero 数据目录，包括 `knowledge-base.sqlite` 和 `knowledge-base/assets/`。插件从空知识库开始，只管理通过插件创建的笔记，不扫描或导入旧文献库内容；一次性文献库整理工具放在插件外部。原自建编辑器保留在 `src/ui/markdown-editor/`，仅供开发使用，没有界面入口，不参与构建或 XPI 打包。

在 Zotero Note 的原生标签中管理标签。Knowledge Base 显示原生标签，图谱优先采用原生标签的 Zotero 颜色，多个带颜色的标签遵循 Zotero 的颜色顺序；没有指定颜色时使用稳定的默认颜色。带空格的标签保持为一个完整标签。正文里的井号文字只作为正文，不再创建或修改标签；已有原生标签保持不变。

## 开发

需要 Node.js 22.13+（22.x）或 24+。依次运行 `npm ci`、`npm run check`。

- `npm run build`：输入未变化时复用有效产物。
- `npm run build:force`：强制重建。
- `npm run check`：格式、静态检查、测试和类型检查；复用有效 XPI。
- `npm run release`：完整检查后，在 `release/v<版本>/` 准备 XPI、`SHA256SUMS` 和 `updates.json`。

构建产物：`dist/zotero-knowledge-base.xpi`。安装后在 Zotero 中验证改动。`npm run test:host` 使用临时配置和数据目录检查启动、保存及退出；通过 `ZOTERO_BINARY` 指定其他宿主程序。在 `.env` 中配置本地路径后可用 `npm start` 开发。

本地发布准备不创建 tag 或上传文件。共同开发规范见工作区根目录 `AGENTS.md`。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。第三方库保留各自许可证。
