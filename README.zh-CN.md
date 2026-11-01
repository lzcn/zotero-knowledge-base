# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[English](README.md) | **简体中文**

在 Zotero 中管理可相互连接的笔记。

## 安装

支持 Zotero 7–10。从 [Releases](https://github.com/lzcn/zotero-knowledge-base/releases/latest) 下载 XPI，通过 **工具 → 插件 → 从文件安装插件** 安装，然后重启 Zotero。

## 使用

通过 **工具 → 知识库**，或文献库、PDF 阅读器工具栏中的按钮打开。

- 统一**新建笔记**，用可编辑的标签分类。使用 Zotero 原生编辑器或 Markdown，修改自动保存。
- 条目侧栏分开展示唯一的文献笔记与相关 Zettel，点 **＋** 新建 Zettel。工作台顶部仅切换**笔记／回收站**，不再提供标签筛选。
- 普通编辑和阅读模式下，标题旁显示淡色的 H1–H6 层级标记，不写入笔记正文。
- 用 `[[ID]]` 连接笔记，`[[ID|文字]]` 自定义链接文字，`[@CitationKey]` 引用文献。输入 `[[` 可选择笔记。
- 按标题、正文或 ID 搜索，浏览上级、子笔记、反向链接和局部／全局图谱。右键笔记可复制链接、编辑标签、新建子笔记及操作回收站。
- 单击笔记 ID 复制引用，在 **… → 修改笔记 ID** 中重命名。来源按所选引用格式显示完整引文，单击打开论文。
- 点击编辑器工具栏的**整理格式**（Tt）直接整理公式分隔符。独立的搜索图标用于查找替换；**⌘/Ctrl+F** 查找，**⌘⌥F**（macOS）或 **Ctrl+H**（Windows/Linux）替换。有选区时只整理选区，否则整理全文，可撤销；原生和 Markdown 模式均可使用，也适用于普通 Zotero 笔记。

在**设置 → Knowledge Base → 笔记模板**中新增、命名、编辑或删除自己的 Markdown 模板，并选择用于新建笔记的模板。不预置模板，默认“不使用模板”；修改或删除模板不改动已有笔记。

在设置中调整工作台窗口、引用格式、标签继承和图谱外观。实验性 AI 联系建议默认关闭，启用时需配置服务；核对并勾选建议后才会应用。

已有笔记类型会一次性转换为普通的 **Literature Note**、**Zettel** 或 **Thinking Note** 标签。删除这些标签不影响正文、来源和链接。

在设置中选择 **Minimal**（默认）或 **Bear**，三个插件使用统一的轻量配色与系统字体控件，Bear 排版只用于 Knowledge Base 正文；设置页保持 Zotero 原生外观。

## 数据与备份

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
