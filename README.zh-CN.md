# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[English](README.md) | **简体中文**

在 Zotero 中管理笔记、整理标签、发现相似条目。

## 安装

需要 Zotero 10。从 [Releases](https://github.com/lzcn/zotero-knowledge-base/releases/latest) 下载 XPI，通过 **工具 → 插件 → 从文件安装插件** 安装，然后重启 Zotero。

## 使用

通过 **工具 → 知识库**，或文献库、PDF 阅读器工具栏中的按钮打开。
在 PDF 中点击按钮，有文献笔记时直接定位，没有则打开默认工作台。

- 统一**新建笔记**，用可编辑的标签分类。使用 Zotero 原生编辑器或 Markdown，切换笔记和重启后沿用最近的编辑方式，修改自动保存。
- 条目侧栏只保留一个 Knowledge Base 入口，内部切换**笔记、标签、相似条目**。笔记页展示唯一的文献笔记和相关 Zettel，点 **＋** 新建 Zettel。顶部四个图标按笔记自己的标签筛选**全部笔记**（默认）、**文献笔记**、**原子笔记**和**思考笔记**，**回收站**使用独立图标。
- 标题旁显示淡色的 H1–H6 层级标记，不写入笔记正文。
- 用 `[[ID]]` 连接笔记，`[[ID|文字]]` 自定义链接文字，`[@CitationKey]` 引用文献。输入 `[[` 可选择笔记。
- 按标题、正文或 ID 搜索，空格组合多个关键词，`"…"` 匹配完整短语。结果显示命中片段，也能定位长笔记深处的内容。可浏览上级、子笔记、反向链接和局部／全局图谱。
- 单击笔记 ID 复制引用，在 **… → 修改笔记 ID** 中重命名。来源按所选引用格式显示完整引文，单击打开论文。
- 点击编辑器工具栏的**整理格式**（Tt）直接整理公式分隔符。搜索图标展开或收起查找，需要时勾选**替换**；**⌘/Ctrl+F** 查找，**⌘⌥F**（macOS）或 **Ctrl+H**（Windows/Linux）替换。有选区时只整理选区，否则整理全文，可撤销；原生和 Markdown 模式均可使用，也适用于普通 Zotero 笔记。

在**设置 → Knowledge Base → 笔记模板**中新增、命名、编辑或删除自己的 Markdown 模板，并选择用于新建笔记的模板。不预置模板，默认“不使用模板”；修改或删除模板不改动已有笔记。

设置使用同一个原生页面，按**通用、笔记系统、标签管理、相似条目、索引状态**分节。下拉框使用 Zotero 原生长条布局。

使用 **Literature Note**、**Zettel** 或 **Thinking Note** 标签分类笔记。删除这些标签不影响正文、来源和链接。

在设置中选择 **Minimal**（默认）或 **Bear**，界面使用轻量配色与系统字体控件，Bear 排版只用于 Knowledge Base 正文；设置页保持 Zotero 原生外观。

## 相似条目

- 选择论文，在 Zotero 侧栏打开**相似条目**。点击结果继续浏览，点**来自**返回上一篇。在 Knowledge Base 笔记中，点击来源引文即可打开论文。
- **标签**页展示当前条目已有标签。点**管理标签**或通过**工具 → 标签管理器**重命名、合并、整理或删除 Zotero 原生标签，确认后应用。
- 在**设置 → Knowledge Base → 相似条目**中调整检索，在**标签管理**中调整标签命名与保护规则，控件保持 Zotero 原生风格。

相似条目推荐结合本地文本索引与 MiniLM 向量。推荐只是候选，不会自动连接笔记、修改上级或添加图谱边；笔记图谱继续展示手动链接、层级和文献来源关系。

笔记和界面优先可用。侧栏默认显示笔记，切换到相似条目时优先加载；后台准备在启动 30 秒后等待空闲机会，再依次加载文本索引、向量和文献扫描，小批处理并让出主线程，复用未变的文件和向量。macOS 会在后台准备本地语义检索，缺少时下载并校验模型权重（约 90 MB）、分词文件和 ONNX Runtime 压缩包（约 52 MiB）；有效文件与已有向量直接复用。MiniLM 主要适用于英文论文，Windows、Linux 目前使用文本检索，不将笔记交给生成式模型。

## 数据与备份

标签操作直接使用 Zotero 原生标签，不另建标签数据库。检索文件统一放在 Zotero 数据目录的 `knowledge-base/` 下：

| 内容                                       | 位置                    |
| ------------------------------------------ | ----------------------- |
| 可重建的文献索引与状态                     | `cache/related-papers/` |
| MiniLM 权重、分词器与已编译的 Core ML 缓存 | `models/minilm-l6-v2/`  |
| 推理程序与 ONNX Runtime                    | `runtime/onnx/`         |
| 笔记图片                                   | `assets/`               |

模型和运行时属于可复用下载资源，索引和状态属于可重建缓存。`knowledge-base.sqlite` 中的笔记结构和草稿，以及原生笔记、标签和模板属于用户数据，不能当缓存清理。

正文和图片使用 Zotero 存储与同步。卡片 ID、层级、链接和恢复草稿保存在本机 `knowledge-base.sqlite`，不通过 Zotero 同步。

在工作台选择**回收站**，可查看、恢复已删除笔记，永久删除所选笔记，或确认后清空 Knowledge Base 回收站。清空只删除知识库管理的笔记及其附件，保留来源文献和其他 Zotero 条目。普通删除先将原笔记移入 Zotero 回收站，永久删除前保留 ID、层级和链接。编辑冲突会保留恢复草稿。

退出 Zotero 后备份完整数据目录，包括 `knowledge-base.sqlite` 和 `knowledge-base/assets/`。插件从空知识库开始，不自动导入已有笔记；不支持的数据库格式会被拒绝，不改写数据。

## 开发

需要 Node.js 22.13+（22.x）或 24+。

```sh
npm ci
npm run check
npm run build
```

产物：`dist/zotero-knowledge-base.xpi`。`npm run test:host` 使用临时 Zotero 目录；`npm run release` 在 `release/v<版本>/` 准备本地文件，不上传。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。代码借助 ChatGPT 和 DeepSeek 开发。

共享文献引擎位于 `src/library/`，原生界面位于 `addon/content/library/`，对应测试位于 `tests/library/`。`src/library/storage.js` 统一定义笔记数据与检索路径，`src/modules/settings.ts` 统一注册设置页。`npm run test:library:host` 在临时配置中验证单页设置、共用状态、检索、原生标签操作和生命周期。
