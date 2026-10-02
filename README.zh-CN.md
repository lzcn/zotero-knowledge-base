# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[English](README.md)

[![Built with ChatGPT](https://img.shields.io/badge/Built_with-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![Built with DeepSeek](https://img.shields.io/badge/Built_with-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

在 Zotero 中管理相互连接的想法卡片：用自己的话写下一个想法，保留出处，并链接相关想法。

## 功能

- 链接已有 Zotero 文献和笔记，不复制原内容。
- 用 Markdown 或可视编辑器写卡片，支持图片、链接、表格和代码。
- 支持数学公式：`$…$` 为行内公式，`$$…$$` 为独立公式；在可视编辑器中点击公式可修改 LaTeX。
- 正文通过 `[[ID]]` 引用卡片，只显示编号链接；关系面板显示编号和标题。
- 关联 Zotero 文献，在文献侧栏查看卡片。
- 每张卡片最多一个父卡片，子卡片自动派生，构建知识脉络。
- 默认从无父卡片的“入口点”开始浏览。
- 图谱分别展示父子层级和卡片双链，通过右键图谱或点击设置按钮控制；隐藏文献来源时同时隐藏来源节点和连线。
- 从 PDF 高亮创建卡片，支持批量操作。
- 自动清理不再被卡片或打开的草稿使用的图片。

## 安装

需要 Zotero 7–10。

从 [Releases](https://github.com/lzcn/zotero-knowledge-base/releases) 下载 `.xpi` 文件。在 Zotero 的“工具 → 插件”中，点击齿轮菜单，选择“从文件安装插件”，选择 `.xpi` 文件后重启。

## 使用

通过“工具 → 知识库”打开卡片库。每张卡片写一个想法，选择来源，再链接相关卡片。`Ctrl/Cmd+S` 保存，`Ctrl/Cmd+K` 搜索要链接的卡片。

从入口卡片开始，沿父子关系浏览。点击“新建子卡片”，在当前卡片下创建子卡片。选择父节点建立知识脉络，正文中的 `[[ID]]` 建立独立的引用关系。关系列表显示标题、固定 ID 和数量，可以折叠。引用候选可用方向键选择、回车插入。

编辑时点击 ➕ 选择插入内容，或在 Markdown 行首输入 `/` 搜索命令。方向键选择、回车执行，Esc 取消。点击父节点按钮展开选择。关系图按标题和子树宽度安排间距，使用曲线连接；切换关系显示时保留位置和缩放。

## 数据与备份

卡片保存在 Zotero 数据目录中的 `knowledge-base.sqlite`，图片保存在 `knowledge-base/assets/`。退出 Zotero 后，同时备份数据库和图片目录。

卡片目前不通过 Zotero 同步，不支持 Markdown 文件导入或导出。

## 开发

需要 Node.js 22.13+（22.x）或 24+。在插件目录中执行：

```sh
npm ci             # 安装锁定依赖
npm run build      # 类型检查并生成 XPI
npm run check      # 格式、静态检查、测试与构建
npm run release    # 完整检查并准备本地发布文件
```

本地调试：安装 `dist/zotero-knowledge-base.xpi`，重启 Zotero 并检查插件功能。修改后重新构建并安装。

`npm run test:host` 使用临时配置和数据目录，测试真实 Zotero 的启动、保存，以及管理、编辑和关系图窗口打开时的退出。默认使用 macOS 应用路径，也可以通过 `ZOTERO_BINARY` 指定其他路径。

`npm run release` 在 `release/` 下准备安装包、校验文件和更新信息，不创建 Git tag，也不发布 GitHub Release。

配置本机 `.env` 中的 Zotero 路径和开发 profile 后，可用 `npm start` 启动开发调试。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。第三方库保留各自的许可证。
