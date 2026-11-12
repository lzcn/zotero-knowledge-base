# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[English](README.md) | **简体中文**

在 Zotero 中管理笔记、整理标签、发现相似条目。

## 安装

需要 Zotero 10。从 [Releases](https://github.com/lzcn/zotero-knowledge-base/releases/latest) 下载 XPI。在**工具**菜单中打开**插件**，选择**从文件安装插件**，然后重启 Zotero。

## 使用

在**工具**菜单、文献库或 PDF 工具栏中打开**知识库**。

- **笔记：** Zotero 笔记会连同来源和上级一起显示。右键**在知识库中打开**，或在设置中启用**原生笔记使用知识库编辑器**，即可在此编辑。支持富文本和 Markdown，修改自动保存。heading 支持公式。**增强 → 数学预览**在 Zotero 笔记卡片和 PDF 批注评论中显示公式。点击评论可编辑 LaTeX，保存内容保持原样。类型可选文献、原子、思考或实体。用 `[[ID]]` 连接笔记，并在图谱中浏览。笔记继承来源和上级的标签。模板在设置中管理。
- **推荐标签：** 复用相关文献中的主题，并补充支持的新主题。推荐结合元数据、全文特征和共享语义模型，按相关性和覆盖程度排序。已有标签保留原拼写。新标签遵循大小写和可选 # 前缀设置。
- **标签管理：** **整理相近标签**按名称变体、别名和语义匹配分组，显示原标签与匹配依据。**整理这组**选中该组并预填常用名称。合并前核对保留名称和涉及条目。重命名、合并和删除是独立操作。**格式化**在标签列表中预览重命名，保留固定拼写和结构。名称冲突会跳过，需单独合并。**排除标签**支持名称、`*` 通配、`@colored` 和 `@auto`，用逗号或换行分隔。`@auto` 隐藏笔记中的自动标签。`@colored, 待读*` 隐藏彩色标签和以“待读”开头的标签。规则作用于推荐、标签管理和笔记展示。
- **相似条目：** 在本地查找相似文献，包括没有全文的条目，滚动时自动加载更多结果。macOS 上的语义检索会自动下载所需文件。

各切换页共用本地索引。新增或变化的文献在后台更新。

图谱按类型展示笔记。**结构**按父子关系连接，**引用**按正文中的引用连接。结构分支保持上下级相邻并使用实线。引用使用虚线。切换类型或关系筛选后会重新布局并适配视野。节点采用最相似标签的颜色。手动分组的标签优先，无标签节点保持中性色。设置中可直接输入 Group 标签，或选择已有标签，分组用于控制图谱颜色。

来源、上级和标签直接显示在笔记上方。来源只接受 Zotero 条目。上级决定层级。点击上级标题跳转，点击铅笔可根据相同的本地上下文查找候选并预览正文。输入后在整个笔记库搜索，滚动或继续向下选择可加载后续结果。用 ↑/↓ 和 Enter 选择上级，Escape 取消。候选排除当前笔记及其后代；只有选中结果后才改变关系。底栏显示类型和可编辑、可复制的 ID。单击查看笔记，双击在独立窗口打开。

点击来源旁的**边读边记**，打开 PDF 并在 Zotero 侧栏选中当前笔记。**原生笔记使用知识库编辑器**控制侧栏、笔记标签页和笔记窗口。macOS 使用 Command-Shift-X（其他系统为 Ctrl-Shift-X）框选图片并复制到剪贴板，Escape 取消。无需先打开笔记，可自行粘贴到需要的位置。粘贴到 Zotero 笔记时保留 PDF 位置，不创建批注。知识库入口位于页码框左侧。有文献笔记时图标为彩色，点击跳到该笔记。没有时显示灰色，点击打开知识库。macOS 使用 Command＋点击（其他系统为 Ctrl＋点击）新建并打开这篇论文的文献笔记，已有笔记会复用。知识库标签页的**在文库中显示**定位并展开无论文来源笔记使用的“个人知识”父条目，尚未建立时才创建；重命名后仍复用同一个 Zotero 条目。

外观提供 Minimal、Bear 和备忘录，均支持浅色与深色。浅色界面统一使用白色背景。各风格共用标题大小、行距与布局，正文字号保留 Zotero 的笔记设置。Minimal 使用系统字体、单色正文与低饱和灰蓝色链接，Bear 使用 Avenir 风格正文、较轻的标题字重和柔和红色链接，备忘录使用系统字体和琥珀色链接。公式字形统一使用内置 KaTeX 字体。模板及各类型的默认模板在同一个窗口管理。

输入 `[[` 可在光标旁查找笔记。默认候选根据当前段落、标题、正文、直接标签和已有连接在本地排序；继续输入会在整个笔记库搜索标题、正文或引用编号；全局匹配按稳定顺序展示，滚动或按 ↓ 到最后一项会继续加载下一页。结果显示短正文预览，高亮匹配词，并在有上级笔记时显示其标题。用 ↑/↓ 选择，Enter 或 Tab 插入，Escape 关闭，焦点保持在正文。`[[ID|显示文字]]` 可保留自己的表述，选中文字后插入双链也会保留为显示文字。候选同时显示标题和稳定引用，便于区分同名笔记。反向链接按来源笔记合并，并显示引用所在段落的摘要。

修改会自动保存到 Zotero。关闭笔记时若仍有未保存内容，可选择保存、取消或丢弃修改。

## 备份

正文通过 Zotero 同步。ID、层级和链接保存在 Zotero 数据目录的 `knowledge-base.sqlite` 中。备份前请退出 Zotero。

```text
knowledge-base.sqlite
knowledge-base/
  assets/
  cache/
    similar-items/
    coreml/minilm-l6-v2/
  models/minilm-l6-v2/
  runtime/onnx/
```

图片使用 `assets/`。检索和模型缓存使用 `cache/`。下载的模型与运行时使用 `models/` 和 `runtime/`。

## 开发

知识库在各宿主中共用同一个编辑器文档和原生笔记存储。`src/modules/editor-views.ts` 负责编辑窗口和待保存的修改，`workbench.ts` 负责工作区导航。

固定拼写和别名维护在 `addon/content/library/tag-terms.json`。标签操作复用现有索引和向量。语义模型不可用时使用文字规则。设置 `SW_HOST_NATIVE_MODEL_DIR=/path/to/local/model` 后执行 `npm run test:tag-semantics`，可用已有模型运行离线质量样例。

需要 Node.js 22.13+（22.x）或 24+。

```sh
npm ci
npm run check
npm run build
```

产物：`dist/zotero-knowledge-base.xpi`。

原生推理支持 macOS。推理共享分词、切块、聚合和排序。`inference-backend.h` 运行 ONNX 并在失败时回退到 CPU，`coreml-backend.h` 提供 macOS 后端。`SW_NATIVE_MODEL_DIR=/path/to/model node scripts/test-native.mjs` 使用临时缓存核对 CPU 与 Core ML 的一致性。

交互式推理优先在输入块之间执行，后台文献随后继续，不重做已完成的块。macOS 使用线程 QoS 提供调度提示。Core ML 和 CPU 共用模型执行路径。

`npm run benchmark:reading` 测量 PDF 与笔记打开、笔记切换、摘图插入与保存，以及 24 篇临时文献索引期间的定时器延迟。设置 `KNOWLEDGE_BASE_READING_BENCHMARK_OUTPUT=build/performance/reading.json` 可保存测量结果。

`node scripts/benchmark-layout.mjs` 使用固定合成图测量后台布局耗时。

`node scripts/benchmark-search.mjs` 使用固定合成数据测量索引重建、指纹解码和检索，并输出排序摘要以便对比优化前后结果。耗时不含 Zotero 存储和原生推理。

## 许可证

Copyright 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。代码借助 ChatGPT 和 DeepSeek 开发。
