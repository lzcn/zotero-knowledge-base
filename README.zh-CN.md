# Knowledge Base

[English](README.md)

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

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

需要 Node.js 22.13+（22.x）或 24+。依次执行 `npm ci`、`npm run check`；`npm run build` 生成 `dist/<package.json 中的包名>.xpi`，`npm run release` 准备 `release/v<版本>/` 中的本地发布文件。

`npm run release` 生成 XPI、`SHA256SUMS` 和 `updates.json`。

无改动时 `npm run build` 直接复用现有产物；`npm run build:force` 强制重建。`check` 和 `release` 仍运行完整验证。

共同开发规范集中在插件工作区根目录的 `AGENTS.md`。修改后构建并安装 XPI，再验证 Zotero 中的实际交互；本地打包不会创建 tag 或发布远端 Release。

`npm run test:host` 使用临时配置与数据目录验证启动、保存和退出，可通过 `ZOTERO_BINARY` 指定宿主路径。本地 `.env` 配置开发路径后，可用 `npm start` 调试。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。第三方库保留各自的许可证。
